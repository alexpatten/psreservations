-- Public Booking: anyone can book a club's courts from a public link (/book/<slug>), with no
-- Pickle Spots account. They verify their phone by text, pay upfront (Stripe Checkout on the
-- club's own connected Stripe account), and get a link to see or cancel the booking.
--
-- Clubs choose what's public: which schedulers (and so courts and hours) and which
-- reservation types, each with a price per hour. Everything else (hours, slots, length
-- limits, prime time, closures, other reservations) works as it does for members.
--
-- A booking waiting for payment is 'held': it blocks the court for 15 minutes. Paying
-- confirms it ('booked'); not paying lets it lapse ('expired'). Payment that arrives after
-- someone else took the court is refunded by the stripe-webhook function.
--
-- Every public booking keeps a guest record per club and phone (public_players), so staff
-- can follow up with guests and turn regulars into members.
--
-- The public-booking, stripe-webhook and stripe-connect Edge Functions do the texting and
-- payments, and call the service-role-only functions below. The booking page itself only
-- reads through res_public_club, res_public_availability and res_public_reservation.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.clubs
  add column public_booking boolean not null default false,
  -- How far ahead the public can book (members have advance_days).
  add column public_advance_days integer not null default 7 check (public_advance_days between 0 and 365),
  -- Upcoming public bookings one phone number may hold at the club.
  add column public_max_upcoming integer not null default 2 check (public_max_upcoming between 1 and 20),
  add column currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  -- The club's Stripe account (Stripe Connect); payments go straight to it.
  add column stripe_account_id text unique,
  add column stripe_charges_enabled boolean not null default false;

alter table public.reservation_types
  add column public_can_book boolean not null default false,
  -- What the public pays per hour for the court (not per player).
  add column public_price_cents integer check (public_price_cents between 0 and 1000000);

alter table public.club_schedulers
  add column public_can_book boolean not null default false;

create table public.public_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- E.164, verified by text.
  phone text not null check (phone ~ '^\+[0-9]{8,15}$'),
  first_name text not null check (char_length(first_name) between 1 and 40),
  last_name text not null check (char_length(last_name) between 1 and 40),
  email text check (char_length(email) <= 254),
  bookings integer not null default 0,
  spent_cents integer not null default 0,
  first_booked_at timestamptz not null default now(),
  last_booked_at timestamptz not null default now(),
  unique (club_id, phone)
);

-- Proof that someone typed the code texted to a phone: the booking page sends the token
-- with the booking.
create table public.public_verifications (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  club_id uuid not null references public.clubs (id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

alter table public.reservations drop constraint reservations_status_check;
alter table public.reservations
  add constraint reservations_status_check check (status in ('booked', 'cancelled', 'held', 'expired')),
  -- A held booking blocks the court until then.
  add column hold_expires_at timestamptz,
  add column public_player_id uuid references public.public_players (id) on delete set null,
  -- The guest's link to see or cancel it (/book/<slug>/r/<token>).
  add column public_token text unique,
  add column amount_cents integer not null default 0,
  add column paid_cents integer not null default 0,
  add column refunded_cents integer not null default 0,
  add column stripe_session_id text unique,
  add column stripe_payment_intent text;

create index reservations_held on public.reservations (court_id, hold_expires_at) where status = 'held';

alter table public.public_players enable row level security;
alter table public.public_verifications enable row level security;
revoke all on public.public_players, public.public_verifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Held bookings block courts, and staff see guests and payments
-- ---------------------------------------------------------------------------

/** As before, but a booking waiting for payment also takes the court. */
create or replace function public.res_conflict(p_court uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_except uuid default null)
returns text
language sql stable
set search_path = ''
as $$
  with court as (select c.club_id, public.res_linked_courts(c.id) as linked from public.club_courts c where c.id = p_court)
  select coalesce(
    (
      select 'That time overlaps a closure' || coalesce(' (' || x.reason || ')', '') || '.'
      from public.closures x, court
      where x.club_id = court.club_id
        and x.starts_at < p_ends_at and x.ends_at > p_starts_at
        and (cardinality(x.court_ids) = 0 or x.court_ids && court.linked)
      limit 1
    ),
    (
      select case when r.court_id = p_court then 'That court is already booked then.'
                  else 'Part of that court is already booked then.' end
      from public.reservations r, court
      where r.court_id = any(court.linked)
        and (r.status = 'booked' or (r.status = 'held' and r.hold_expires_at > now()))
        and r.id is distinct from p_except
        and r.starts_at < p_ends_at and r.ends_at > p_starts_at
      limit 1
    )
  )
$$;

/** As before, plus (with p_detail) the public guest's contact details and the payment. */
create or replace function public.res_reservation_json(r public.reservations, p_detail boolean)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'clubId', r.club_id,
    'courtId', r.court_id,
    'typeId', r.type_id,
    'seriesId', r.series_id,
    'ownerId', r.owner_id,
    'title', r.title,
    'notes', case when p_detail then r.notes end,
    'startsAt', public.epoch_ms(r.starts_at),
    'endsAt', public.epoch_ms(r.ends_at),
    'isPrime', r.is_prime,
    'custom', case when p_detail then r.custom else '{}'::jsonb end,
    'status', r.status,
    'cancelReason', r.cancel_reason,
    'lateCancel', r.late_cancel,
    'isPublic', r.public_token is not null,
    'holdExpiresAt', public.epoch_ms(r.hold_expires_at),
    'amountCents', case when p_detail then r.amount_cents end,
    'paidCents', case when p_detail then r.paid_cents end,
    'refundedCents', case when p_detail then r.refunded_cents end,
    'publicGuest', case when p_detail and r.public_player_id is not null then (
      select jsonb_build_object('name', g.first_name || ' ' || g.last_name, 'phone', g.phone, 'email', g.email, 'bookings', g.bookings)
      from public.public_players g where g.id = r.public_player_id
    ) end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'userId', p.user_id,
        'name', public.res_player_name(p.user_id, p.guest_name),
        'guest', p.user_id is null,
        'playerCode', case when p_detail then u.player_code end,
        'checkedInAt', public.epoch_ms(p.checked_in_at),
        'noShow', p.no_show
      ) order by p.position, p.guest_name)
      from public.reservation_players p
      left join public.profiles u on u.id = p.user_id
      where p.reservation_id = r.id
    ), '[]'::jsonb)
  )
$$;

/** As before, plus bookings waiting for payment (they hold the court). */
create or replace function public.res_schedule(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  staff boolean := public.res_is_staff(p_club);
  member boolean := public.res_role(p_club) is not null;
begin
  perform public.res_require_user();
  if p_to <= p_from or p_to - p_from > interval '8 days' then
    raise exception 'Choose up to 8 days.';
  end if;
  return jsonb_build_object(
    'reservations', coalesce((
      select jsonb_agg(
        case when member then public.res_reservation_json(r, staff or public.res_on_reservation(r))
             else public.res_reservation_json(r, false) - 'players' - 'title' || '{"players": []}'::jsonb end
        order by r.starts_at)
      from public.reservations r
      where r.club_id = p_club and r.starts_at < p_to and r.ends_at > p_from
        and (r.status = 'booked'
             or (r.status = 'held' and r.hold_expires_at > now())
             or (staff and r.status = 'cancelled'))
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'courtIds', to_jsonb(x.court_ids), 'startsAt', public.epoch_ms(x.starts_at),
        'endsAt', public.epoch_ms(x.ends_at), 'reason', x.reason
      ) order by x.starts_at)
      from public.closures x
      where x.club_id = p_club and x.starts_at < p_to and x.ends_at > p_from
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The public booking page (no sign-in)
-- ---------------------------------------------------------------------------

/** A court this club offers the public at a time: in a public scheduler that fits, free, and within length limits. */
create function public.res_public_court_fits(k public.clubs, c public.club_courts, p_starts_at timestamptz, p_minutes integer)
returns boolean
language sql stable
set search_path = ''
as $$
  select c.active and c.kind = 'court' and c.members_can_book and c.club_id = k.id
    and p_minutes between coalesce(c.min_minutes, k.min_minutes) and coalesce(c.max_minutes, k.max_minutes)
    and exists (
      select 1 from public.club_schedulers s
      cross join lateral (select p_starts_at at time zone k.timezone as local_start) l
      where s.club_id = k.id and s.public_can_book and c.id = any(s.court_ids)
        and extract(dow from l.local_start)::integer = any(s.days)
        and public.res_minutes(l.local_start) >= public.res_time_minutes(s.opens)
        and public.res_minutes(l.local_start) + p_minutes <= public.res_time_minutes(s.closes)
        and (public.res_minutes(l.local_start) - public.res_time_minutes(s.opens)) % s.slot_minutes = 0
        and p_minutes % s.slot_minutes = 0
    )
    -- Prime time's length limit applies to the public too.
    and not exists (
      select 1 from public.prime_times p
      cross join lateral (select p_starts_at at time zone k.timezone as local_start) l
      where p.club_id = k.id and p.max_minutes is not null and p_minutes > p.max_minutes
        and (cardinality(p.court_ids) = 0 or p.court_ids && public.res_linked_courts(c.id))
        and extract(dow from l.local_start)::integer = any(p.days)
        and public.res_minutes(l.local_start) < public.res_time_minutes(p.ends)
        and public.res_minutes(l.local_start) + p_minutes > public.res_time_minutes(p.starts)
    )
    and public.res_conflict(c.id, p_starts_at, p_starts_at + make_interval(mins => p_minutes)) is null
$$;

/** What the booking page needs, or null when the club isn't taking public bookings. */
create function public.res_public_club(p_slug text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', k.id,
    'name', k.name,
    'slug', k.slug,
    'address', k.address,
    'timezone', k.timezone,
    'currency', k.currency,
    'paymentsReady', k.stripe_account_id is not null and k.stripe_charges_enabled,
    'advanceDays', k.public_advance_days,
    'cancelCutoffHours', k.cancel_cutoff_hours,
    'minMinutes', k.min_minutes,
    'maxMinutes', k.max_minutes,
    'slotMinutes', coalesce((select min(s.slot_minutes) from public.club_schedulers s where s.club_id = k.id and s.public_can_book), 30),
    'sports', coalesce((
      select jsonb_agg(distinct c.sport)
      from public.club_courts c
      join public.club_schedulers s on s.club_id = k.id and s.public_can_book and c.id = any(s.court_ids)
      where c.club_id = k.id and c.active and c.kind = 'court' and c.members_can_book
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'color', t.color, 'minPlayers', greatest(t.min_players, 1),
        'maxPlayers', t.max_players, 'priceCents', coalesce(t.public_price_cents, 0)
      ) order by t.sort_order, t.name)
      from public.reservation_types t
      where t.club_id = k.id and t.active and t.public_can_book
    ), '[]'::jsonb)
  )
  from public.clubs k
  where k.slug = lower(p_slug) and k.public_booking
$$;

/** Start times on a day with how many courts of a sport are free for that long, soonest first. */
create function public.res_public_availability(p_slug text, p_day date, p_sport text, p_minutes integer)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with k as (select * from public.clubs where slug = lower(p_slug) and public_booking),
  starts as (
    select distinct ((p_day + make_interval(mins => m)) at time zone k.timezone) as starts_at
    from k
    join public.club_schedulers s on s.club_id = k.id and s.public_can_book
    cross join lateral generate_series(public.res_time_minutes(s.opens), public.res_time_minutes(s.closes) - p_minutes, s.slot_minutes) m
    where extract(dow from p_day)::integer = any(s.days) and p_minutes between 15 and 1440
  ),
  free as (
    select st.starts_at, count(*) as courts
    from starts st, k
    join public.club_courts c on c.club_id = k.id and c.sport = p_sport
    where st.starts_at > now() + interval '5 minutes'
      and st.starts_at <= now() + make_interval(days => k.public_advance_days)
      and public.res_public_court_fits(k, c, st.starts_at, p_minutes)
    group by st.starts_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('startsAt', public.epoch_ms(starts_at), 'courts', courts) order by starts_at), '[]'::jsonb)
  from free
$$;

/** A public booking by its link: what the guest sees on their confirmation page. */
create function public.res_public_reservation(p_token text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'token', r.public_token,
    'status', case when r.status = 'held' and r.hold_expires_at <= now() then 'expired' else r.status end,
    'club', jsonb_build_object('name', k.name, 'slug', k.slug, 'address', k.address, 'timezone', k.timezone, 'currency', k.currency),
    'courtName', c.name,
    'typeName', t.name,
    'color', t.color,
    'startsAt', public.epoch_ms(r.starts_at),
    'endsAt', public.epoch_ms(r.ends_at),
    'players', (select count(*) from public.reservation_players p where p.reservation_id = r.id),
    'guestName', g.first_name || ' ' || g.last_name,
    'amountCents', r.amount_cents,
    'paidCents', r.paid_cents,
    'refundedCents', r.refunded_cents,
    'holdExpiresAt', public.epoch_ms(r.hold_expires_at),
    'cancelCutoffHours', k.cancel_cutoff_hours,
    'cancelReason', r.cancel_reason,
    -- Cancelling now refunds the payment.
    'refundable', r.status = 'booked' and r.starts_at - now() >= make_interval(hours => k.cancel_cutoff_hours)
  )
  from public.reservations r
  join public.clubs k on k.id = r.club_id
  join public.club_courts c on c.id = r.court_id
  join public.reservation_types t on t.id = r.type_id
  left join public.public_players g on g.id = r.public_player_id
  where r.public_token = p_token
$$;

-- ---------------------------------------------------------------------------
-- Booking, paying and cancelling (the Edge Functions call these with the secret key)
-- ---------------------------------------------------------------------------

/**
 * Books the first free court of a sport for a verified phone. With a price it's held for 15
 * minutes while the guest pays; free bookings are confirmed right away. Returns what the
 * Edge Function needs to start Stripe Checkout and text the guest.
 */
create function public.res_public_hold(
  p_slug text, p_verification text, p_type uuid, p_sport text, p_starts_at timestamptz, p_minutes integer,
  p_players integer, p_first_name text, p_last_name text, p_email text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.clubs;
  rtype public.reservation_types;
  v_phone text;
  court public.club_courts;
  guest public.public_players;
  amount integer;
  r public.reservations;
  i integer;
begin
  select * into k from public.clubs where slug = lower(p_slug) and public_booking;
  if not found then
    raise exception 'This club isn''t taking public bookings right now.';
  end if;
  select v.phone into v_phone from public.public_verifications v
  where v.token = p_verification and v.club_id = k.id and v.expires_at > now();
  if v_phone is null then
    raise exception 'Please verify your phone number again.';
  end if;
  if char_length(btrim(coalesce(p_first_name, ''))) not between 1 and 40 or char_length(btrim(coalesce(p_last_name, ''))) not between 1 and 40 then
    raise exception 'Enter your first and last name.';
  end if;
  if p_email is not null and btrim(p_email) <> '' and btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Check your email address.';
  end if;
  select * into rtype from public.reservation_types where id = p_type and club_id = k.id and active and public_can_book;
  if not found then
    raise exception 'Choose a reservation type.';
  end if;
  if coalesce(p_players, 0) < greatest(rtype.min_players, 1) or p_players > rtype.max_players then
    raise exception '% is for % to % players.', rtype.name, greatest(rtype.min_players, 1), rtype.max_players;
  end if;
  if p_starts_at <= now() then
    raise exception 'That time has already passed. Pick another.';
  end if;
  if p_starts_at > now() + make_interval(days => k.public_advance_days) then
    raise exception 'You can book up to % days ahead.', k.public_advance_days;
  end if;

  amount := round(coalesce(rtype.public_price_cents, 0) * p_minutes / 60.0)::integer;
  if amount > 0 and not (k.stripe_account_id is not null and k.stripe_charges_enabled) then
    raise exception '% isn''t taking online payments yet. Please call the club.', k.name;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(k.id::text, 0));

  if (
    select count(*) from public.reservations x
    join public.public_players g on g.id = x.public_player_id
    where x.club_id = k.id and g.phone = v_phone and x.ends_at > now()
      and (x.status = 'booked' or (x.status = 'held' and x.hold_expires_at > now()))
  ) >= k.public_max_upcoming then
    raise exception 'You already have % upcoming booking(s) at %. Cancel one, or come play first!', k.public_max_upcoming, k.name;
  end if;

  select c.* into court from public.club_courts c
  where c.club_id = k.id and c.sport = p_sport and public.res_public_court_fits(k, c, p_starts_at, p_minutes)
  order by c.sort_order, c.name
  limit 1;
  if not found then
    raise exception 'Someone just booked that time. Pick another.';
  end if;

  insert into public.public_players as g (club_id, phone, first_name, last_name, email)
  values (k.id, v_phone, btrim(p_first_name), btrim(p_last_name), nullif(lower(btrim(coalesce(p_email, ''))), ''))
  on conflict (club_id, phone) do update set
    first_name = excluded.first_name, last_name = excluded.last_name, email = coalesce(excluded.email, g.email)
  returning * into guest;

  insert into public.reservations (
    club_id, court_id, type_id, starts_at, ends_at, is_prime, status, hold_expires_at,
    public_player_id, public_token, amount_cents, notes
  ) values (
    k.id, court.id, rtype.id, p_starts_at, p_starts_at + make_interval(mins => p_minutes),
    public.res_is_prime(court.id, p_starts_at, p_starts_at + make_interval(mins => p_minutes)),
    case when amount > 0 then 'held' else 'booked' end,
    case when amount > 0 then now() + interval '15 minutes' end,
    guest.id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), amount,
    'Booked online'
  ) returning * into r;

  insert into public.reservation_players (reservation_id, guest_name, position)
  values (r.id, guest.first_name || ' ' || left(guest.last_name, 1) || '.', 0);
  for i in 2..p_players loop
    insert into public.reservation_players (reservation_id, guest_name, position)
    values (r.id, 'Guest ' || i, i);
  end loop;

  if amount = 0 then
    update public.public_players set bookings = bookings + 1, last_booked_at = now() where id = guest.id;
  end if;

  return jsonb_build_object(
    'reservationId', r.id, 'token', r.public_token, 'status', r.status, 'amountCents', amount,
    'currency', k.currency, 'stripeAccount', k.stripe_account_id, 'holdExpiresAt', public.epoch_ms(r.hold_expires_at),
    'clubName', k.name, 'slug', k.slug, 'timezone', k.timezone, 'courtName', court.name, 'typeName', rtype.name,
    'startsAt', public.epoch_ms(r.starts_at), 'endsAt', public.epoch_ms(r.ends_at),
    'phone', v_phone, 'email', guest.email, 'firstName', guest.first_name
  );
end;
$$;

create function public.res_public_attach_session(p_reservation uuid, p_session text)
returns void
language sql security definer
set search_path = ''
as $$ update public.reservations set stripe_session_id = p_session where id = p_reservation $$;

/**
 * Payment arrived for a Checkout session: confirms the booking, unless the court was taken
 * after its hold lapsed (then it's cancelled and `refund` tells the caller to refund).
 * Safe to call twice for the same session.
 */
create function public.res_public_confirm(p_session text, p_payment_intent text, p_paid_cents integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reservations;
  k public.clubs;
  refund boolean := false;
begin
  select * into r from public.reservations where stripe_session_id = p_session for update;
  if not found then
    return null;
  end if;
  select * into k from public.clubs where id = r.club_id;
  if r.status in ('held', 'expired') then
    perform pg_advisory_xact_lock(hashtextextended(k.id::text, 0));
    refund := public.res_conflict(r.court_id, r.starts_at, r.ends_at, r.id) is not null or r.ends_at <= now();
    update public.reservations set
      status = case when refund then 'cancelled' else 'booked' end,
      cancel_reason = case when refund then 'Paid after the hold ran out; the court was taken' end,
      cancelled_at = case when refund then now() end,
      hold_expires_at = null,
      paid_cents = p_paid_cents,
      stripe_payment_intent = p_payment_intent
    where id = r.id
    returning * into r;
    if not refund then
      update public.public_players
      set bookings = bookings + 1, spent_cents = spent_cents + p_paid_cents, last_booked_at = now()
      where id = r.public_player_id;
    end if;
  end if;
  return jsonb_build_object(
    'reservationId', r.id, 'status', r.status, 'refund', refund, 'paidCents', r.paid_cents,
    'paymentIntent', r.stripe_payment_intent, 'stripeAccount', k.stripe_account_id,
    'token', r.public_token, 'slug', k.slug, 'clubName', k.name, 'timezone', k.timezone,
    'courtName', (select name from public.club_courts where id = r.court_id),
    'startsAt', public.epoch_ms(r.starts_at), 'endsAt', public.epoch_ms(r.ends_at),
    'phone', (select phone from public.public_players where id = r.public_player_id)
  );
end;
$$;

/** Lets a held booking go (Checkout expired, or the guest backed out). Returns its Checkout session, if any. */
create function public.res_public_release(p_session text default null, p_token text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reservations;
begin
  update public.reservations
  set status = 'expired', hold_expires_at = null
  where status = 'held' and ((p_session is not null and stripe_session_id = p_session) or (p_token is not null and public_token = p_token))
  returning * into r;
  return case when r.id is null then null else jsonb_build_object('session', r.stripe_session_id, 'stripeAccount', (select stripe_account_id from public.clubs where id = r.club_id)) end;
end;
$$;

/**
 * Cancels a public booking: by its guest (p_token; refunded if before the club's cutoff) or by
 * staff (p_reservation; always refunded). Returns how much to refund and where.
 */
create function public.res_public_cancel(p_token text default null, p_reservation uuid default null, p_by uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reservations;
  k public.clubs;
  refund integer;
begin
  select * into r from public.reservations
  where (p_token is not null and public_token = p_token) or (p_reservation is not null and id = p_reservation)
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;
  select * into k from public.clubs where id = r.club_id;
  if r.status = 'held' then
    update public.reservations set status = 'expired', hold_expires_at = null where id = r.id;
    return jsonb_build_object('refundCents', 0, 'session', r.stripe_session_id, 'stripeAccount', k.stripe_account_id);
  end if;
  if r.status <> 'booked' then
    raise exception 'This booking is already cancelled.';
  end if;
  if p_reservation is null and r.starts_at <= now() then
    raise exception 'This booking has already started. Please call the club.';
  end if;

  refund := case
    when p_reservation is not null then r.paid_cents - r.refunded_cents
    when r.starts_at - now() >= make_interval(hours => k.cancel_cutoff_hours) then r.paid_cents - r.refunded_cents
    else 0 end;

  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by,
      cancel_reason = case when p_reservation is null then 'Cancelled by the guest' else 'Cancelled by the club' end,
      late_cancel = p_reservation is null and refund = 0 and r.paid_cents > 0
  where id = r.id;

  return jsonb_build_object(
    'reservationId', r.id, 'refundCents', refund, 'paymentIntent', r.stripe_payment_intent,
    'stripeAccount', k.stripe_account_id, 'phone', (select phone from public.public_players where id = r.public_player_id),
    'clubName', k.name, 'timezone', k.timezone, 'startsAt', public.epoch_ms(r.starts_at), 'currency', k.currency
  );
end;
$$;

create function public.res_public_refunded(p_reservation uuid, p_cents integer)
returns void
language sql security definer
set search_path = ''
as $$
  update public.reservations set refunded_cents = refunded_cents + p_cents where id = p_reservation;
  update public.public_players g set spent_cents = greatest(0, g.spent_cents - p_cents)
  from public.reservations r where r.id = p_reservation and g.id = r.public_player_id;
$$;

-- ---------------------------------------------------------------------------
-- Staff: settings and guests
-- ---------------------------------------------------------------------------

/** Staff: the club's public booking settings, Stripe status, and what's public. */
create function public.res_public_settings(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return (
    select jsonb_build_object(
      'enabled', k.public_booking,
      'advanceDays', k.public_advance_days,
      'maxUpcoming', k.public_max_upcoming,
      'currency', k.currency,
      'stripeConnected', k.stripe_account_id is not null,
      'chargesEnabled', k.stripe_charges_enabled,
      'schedulers', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'public', s.public_can_book) order by s.sort_order, s.name)
        from public.club_schedulers s where s.club_id = k.id
      ), '[]'::jsonb),
      'types', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'color', t.color, 'public', t.public_can_book, 'priceCents', t.public_price_cents
        ) order by t.sort_order, t.name)
        from public.reservation_types t where t.club_id = k.id and t.active
      ), '[]'::jsonb)
    )
    from public.clubs k where k.id = p_club
  );
end;
$$;

/**
 * Admins: turns public booking on or off and sets its limits, which schedulers are public,
 * and each type's public price (types: [{id, public, priceCents}]). Only the keys given.
 */
create function public.res_save_public_settings(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t jsonb;
begin
  perform public.res_require_manager(p_club);
  update public.clubs set
    public_booking = coalesce((p ->> 'enabled')::boolean, public_booking),
    public_advance_days = coalesce((p ->> 'advanceDays')::integer, public_advance_days),
    public_max_upcoming = coalesce((p ->> 'maxUpcoming')::integer, public_max_upcoming)
  where id = p_club;
  if p ? 'schedulerIds' then
    update public.club_schedulers
    set public_can_book = id = any(public.res_uuids(p -> 'schedulerIds'))
    where club_id = p_club;
  end if;
  for t in select * from jsonb_array_elements(coalesce(p -> 'types', '[]')) loop
    update public.reservation_types set
      public_can_book = coalesce((t ->> 'public')::boolean, public_can_book),
      public_price_cents = case when t ? 'priceCents' then (t ->> 'priceCents')::integer else public_price_cents end
    where id = (t ->> 'id')::uuid and club_id = p_club;
  end loop;
  return public.res_public_settings(p_club);
exception
  when check_violation then
    raise exception 'One of those numbers is out of range. Check them and try again.';
end;
$$;

/**
 * Staff: guests who booked publicly (leads), most recent first, up to 500. Marks the ones
 * whose phone matches a club member's Pickle Spots profile.
 */
create function public.res_public_players(p_club uuid, p_query text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return coalesce((
    select jsonb_agg(x.item order by x.last_booked_at desc)
    from (
      select g.last_booked_at, jsonb_build_object(
        'id', g.id,
        'name', g.first_name || ' ' || g.last_name,
        'phone', g.phone,
        'email', g.email,
        'bookings', g.bookings,
        'spentCents', g.spent_cents,
        'firstBookedAt', public.epoch_ms(g.first_booked_at),
        'lastBookedAt', public.epoch_ms(g.last_booked_at),
        'isMember', exists (
          select 1 from public.club_members m join public.profiles u on u.id = m.user_id
          where m.club_id = p_club and u.phone = g.phone
        )
      ) as item
      from public.public_players g
      where g.club_id = p_club
        and (btrim(coalesce(p_query, '')) = ''
             or (g.first_name || ' ' || g.last_name) ilike '%' || btrim(p_query) || '%'
             or g.email ilike '%' || btrim(p_query) || '%'
             or g.phone like '%' || regexp_replace(p_query, '[^0-9]', '', 'g') || '%')
      order by g.last_booked_at desc
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_public_court_fits(public.clubs, public.club_courts, timestamptz, integer),
  public.res_public_club(text), public.res_public_availability(text, date, text, integer), public.res_public_reservation(text),
  public.res_public_hold(text, text, uuid, text, timestamptz, integer, integer, text, text, text),
  public.res_public_attach_session(uuid, text), public.res_public_confirm(text, text, integer),
  public.res_public_release(text, text), public.res_public_cancel(text, uuid, uuid), public.res_public_refunded(uuid, integer),
  public.res_public_settings(uuid), public.res_save_public_settings(uuid, jsonb), public.res_public_players(uuid, text)
from public, anon, authenticated;

-- The booking page, signed in or not.
grant execute on function
  public.res_public_club(text), public.res_public_availability(text, date, text, integer), public.res_public_reservation(text)
to anon, authenticated;

-- Staff screens.
grant execute on function
  public.res_public_settings(uuid), public.res_save_public_settings(uuid, jsonb), public.res_public_players(uuid, text)
to authenticated;

-- Only the Edge Functions (secret key) book, confirm, release, cancel and refund.
grant execute on function
  public.res_public_hold(text, text, uuid, text, timestamptz, integer, integer, text, text, text),
  public.res_public_attach_session(uuid, text), public.res_public_confirm(text, text, integer),
  public.res_public_release(text, text), public.res_public_cancel(text, uuid, uuid), public.res_public_refunded(uuid, integer)
to service_role;
