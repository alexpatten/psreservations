-- Event management: programs, socials, tournaments and clinics, built on the clinics from the
-- lessons migration (one or more dates, spots, waitlist, drop-ins). Adds categories,
-- restrictions (gender, age, rating), a disclosure to accept, custom registration fields, a
-- registration window, members-only or open to anyone signed in, and upfront online payment
-- (the spot is held for 15 minutes while they pay; stripe-webhook confirms it). Published
-- events can also be listed on a public page for the club's website (/events/<slug>).
--
-- Also members' details clubs need for restrictions and demographics (birth date, gender,
-- ZIP code), and in-app notifications (moving up from a waitlist, and later invoices and
-- door codes).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.event_categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#6A4FC8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0
);

alter table public.clinics
  add column category_id uuid references public.event_categories (id) on delete set null,
  add column gender text not null default 'any' check (gender in ('any', 'women', 'men')),
  add column min_age integer check (min_age between 0 and 120),
  add column max_age integer check (max_age between 0 and 120),
  add column min_rating numeric(4, 2),
  add column max_rating numeric(4, 2),
  -- Text players must accept to register (waiver, rules); null for none.
  add column disclosure text check (char_length(disclosure) <= 5000),
  -- Questions on the registration form: [{id, label, type, options, required}], like the club's.
  add column custom_fields jsonb not null default '[]' check (jsonb_typeof(custom_fields) = 'array'),
  -- Off: anyone signed in can register (and is added to the club).
  add column members_only boolean not null default true,
  add column registration_opens_at timestamptz,
  add column registration_closes_at timestamptz,
  -- Pay online when registering (needs Stripe connected); otherwise pay at the desk or on account.
  add column require_payment boolean not null default false;

alter table public.clinic_registrations
  add column answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  add column disclosure_accepted_at timestamptz,
  add column hold_expires_at timestamptz,
  add column stripe_session_id text unique,
  add column stripe_payment_intent text;

alter table public.clinic_registrations drop constraint clinic_registrations_status_check;
alter table public.clinic_registrations
  add constraint clinic_registrations_status_check check (status in ('registered', 'waitlisted', 'pending', 'cancelled'));

-- Details clubs keep about members (for restrictions and demographics).
alter table public.club_members
  add column birth_date date check (birth_date between '1900-01-01' and '2100-01-01'),
  add column gender text check (gender in ('woman', 'man', 'nonbinary', 'unspecified')),
  add column zip text check (char_length(zip) <= 12);

-- A public events page for the club's website.
alter table public.clubs add column public_events boolean not null default false;

create table public.res_notifications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text check (char_length(body) <= 500),
  -- Where tapping it goes in the app, e.g. /c/<slug>/events.
  link text check (char_length(link) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index res_notifications_user on public.res_notifications (user_id, created_at desc);

alter table public.event_categories enable row level security;
alter table public.res_notifications enable row level security;
revoke all on public.event_categories, public.res_notifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create function public.res_notify(p_club uuid, p_user uuid, p_title text, p_body text default null, p_link text default null)
returns void
language sql
set search_path = ''
as $$
  insert into public.res_notifications (club_id, user_id, title, body, link)
  values (p_club, p_user, left(p_title, 120), left(p_body, 500), left(p_link, 200))
$$;

/** Your notifications, newest first (up to 50), and how many are unread. */
create function public.res_my_notifications()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.res_notifications where user_id = (select auth.uid()) and read_at is null),
    'items', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
      select n.created_at, jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link,
        'read', n.read_at is not null, 'createdAt', public.epoch_ms(n.created_at),
        'clubName', (select k.name from public.clubs k where k.id = n.club_id)) j
      from public.res_notifications n where n.user_id = (select auth.uid()) order by n.created_at desc limit 50) x), '[]'::jsonb)
  )
$$;

create function public.res_read_notifications()
returns void
language sql security definer
set search_path = ''
as $$ update public.res_notifications set read_at = now() where user_id = (select auth.uid()) and read_at is null $$;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------

/** A player's rating for event restrictions: their Pickle Spots doubles rating (DUPR or self-rated). */
create function public.res_player_rating(p_club uuid, p_user uuid)
returns numeric
language sql stable
set search_path = ''
as $$ select u.doubles::numeric from public.profiles u where u.id = p_user $$;

/** Why a player can't register for an event (gender, age, rating), or null. */
create function public.res_event_ineligible(cl public.clinics, p_user uuid)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  m public.club_members;
  first_day date;
  v_age integer;
  rating numeric;
  -- "3.5+", "up to 4", "3.5–4.5".
  range_text text := case
    when cl.min_rating is not null and cl.max_rating is not null then trim_scale(cl.min_rating)::text || '–' || trim_scale(cl.max_rating)::text
    when cl.min_rating is not null then trim_scale(cl.min_rating)::text || '+'
    else 'up to ' || trim_scale(cl.max_rating)::text end;
begin
  select * into m from public.club_members where club_id = cl.club_id and user_id = p_user;
  if cl.gender <> 'any' then
    if m.gender is null then
      return 'This event is for ' || cl.gender || '. Add your gender under My Details first.';
    end if;
    if (cl.gender = 'women' and m.gender <> 'woman') or (cl.gender = 'men' and m.gender <> 'man') then
      return 'This event is for ' || cl.gender || ' only.';
    end if;
  end if;
  if cl.min_age is not null or cl.max_age is not null then
    if m.birth_date is null then
      return 'This event has an age limit. Add your birth date under My Details first.';
    end if;
    -- Age on the event's first date, in the club's time zone.
    select (min(r.starts_at) at time zone (select k.timezone from public.clubs k where k.id = cl.club_id))::date into first_day
    from public.reservations r
    where r.clinic_id = cl.id and r.status = 'booked';
    v_age := extract(year from age(coalesce(first_day, current_date), m.birth_date))::integer;
    if cl.min_age is not null and v_age < cl.min_age then
      return 'This event is for ages ' || cl.min_age || coalesce('–' || cl.max_age, '+') || '.';
    end if;
    if cl.max_age is not null and v_age > cl.max_age then
      return 'This event is for ages ' || coalesce(cl.min_age || '–', 'up to ') || cl.max_age || '.';
    end if;
  end if;
  if cl.min_rating is not null or cl.max_rating is not null then
    rating := public.res_player_rating(cl.club_id, p_user);
    if rating is null then
      return 'This event is for players rated ' || range_text || '. Add your rating in Pickle Spots first.';
    end if;
    if (cl.min_rating is not null and rating < cl.min_rating) or (cl.max_rating is not null and rating > cl.max_rating) then
      return 'This event is for players rated ' || range_text || '.';
    end if;
  end if;
  return null;
end;
$$;

/** Lets go of registrations whose 15 minutes to pay ran out. */
create function public.res_release_expired_registrations(p_clinic uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  g public.clinic_registrations;
begin
  for g in select * from public.clinic_registrations where clinic_id = p_clinic and status = 'pending' and hold_expires_at <= now() loop
    update public.clinic_registrations set status = 'cancelled', cancelled_at = now() where id = g.id;
    delete from public.reservation_players p using public.reservations r
    where p.reservation_id = r.id and r.clinic_id = p_clinic and p.user_id = g.user_id and r.starts_at > now()
      and (g.reservation_id is null or r.id = g.reservation_id)
      and not exists (select 1 from public.clinic_registrations o where o.clinic_id = p_clinic and o.user_id = g.user_id
                      and o.status = 'registered' and (o.reservation_id is null or o.reservation_id = r.id));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Events: reading
-- ---------------------------------------------------------------------------

/** As before, plus category, restrictions, disclosure, questions, registration window, payment, and whether you can register. */
create or replace function public.res_clinic_json(cl public.clinics, p_full boolean)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', cl.id,
    'title', cl.title,
    'description', cl.description,
    'instructorId', cl.instructor_id,
    'typeId', cl.type_id,
    'categoryId', cl.category_id,
    'maxPlayers', cl.max_players,
    'priceCents', cl.price_cents,
    'dropInPriceCents', cl.drop_in_price_cents,
    'waitlist', cl.waitlist,
    'published', cl.published,
    'cancelled', cl.cancelled_at is not null,
    'gender', cl.gender,
    'minAge', cl.min_age,
    'maxAge', cl.max_age,
    'minRating', cl.min_rating,
    'maxRating', cl.max_rating,
    'disclosure', cl.disclosure,
    'customFields', cl.custom_fields,
    'membersOnly', cl.members_only,
    'registrationOpensAt', public.epoch_ms(cl.registration_opens_at),
    'registrationClosesAt', public.epoch_ms(cl.registration_closes_at),
    'requirePayment', cl.require_payment,
    'ineligible', case when (select auth.uid()) is not null then public.res_event_ineligible(cl, (select auth.uid())) end,
    'registered', (select count(*) from public.clinic_registrations g where g.clinic_id = cl.id and g.status in ('registered', 'pending') and g.reservation_id is null),
    'waitlisted', (select count(*) from public.clinic_registrations g where g.clinic_id = cl.id and g.status = 'waitlisted'),
    'myStatus', (
      select g.status from public.clinic_registrations g
      where g.clinic_id = cl.id and g.user_id = (select auth.uid()) and g.status <> 'cancelled' and g.reservation_id is null
      limit 1
    ),
    'myRegistrationId', (
      select g.id from public.clinic_registrations g
      where g.clinic_id = cl.id and g.user_id = (select auth.uid()) and g.status <> 'cancelled' and g.reservation_id is null
      limit 1
    ),
    'myWaitlistPosition', (
      select count(*) + 1 from public.clinic_registrations w
      join public.clinic_registrations me on me.clinic_id = cl.id and me.user_id = (select auth.uid()) and me.status = 'waitlisted'
      where w.clinic_id = cl.id and w.status = 'waitlisted' and w.created_at < me.created_at
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reservationId', r.id, 'courtId', r.court_id, 'startsAt', public.epoch_ms(r.starts_at), 'endsAt', public.epoch_ms(r.ends_at),
        'status', r.status,
        'spots', cl.max_players - (select count(*) from public.reservation_players p where p.reservation_id = r.id and p.user_id is not null),
        'iDropIn', exists (
          select 1 from public.clinic_registrations g
          where g.reservation_id = r.id and g.user_id = (select auth.uid()) and g.status in ('registered', 'pending')
        ),
        'checkedIn', case when p_full then (select count(*) from public.reservation_players p where p.reservation_id = r.id and p.checked_in_at is not null) end
      ) order by r.starts_at)
      from public.reservations r where r.clinic_id = cl.id and r.status <> 'cancelled'
    ), '[]'::jsonb)
  )
$$;

/** Event categories. */
create function public.res_event_categories(p_club uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'sortOrder', c.sort_order) order by c.sort_order, c.name), '[]'::jsonb)
  from public.event_categories c where c.club_id = p_club
$$;

/** For the club's website (no sign-in): published events with dates to come, if the club lists them publicly. */
create function public.res_public_events(p_slug text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'club', jsonb_build_object('name', k.name, 'slug', k.slug, 'address', k.address, 'timezone', k.timezone),
    'categories', public.res_event_categories(k.id),
    'events', coalesce((
      select jsonb_agg(public.res_clinic_json(cl, false) - 'myStatus' - 'myRegistrationId' - 'myWaitlistPosition' - 'ineligible'
                       order by (select min(r.starts_at) from public.reservations r where r.clinic_id = cl.id and r.status = 'booked'))
      from public.clinics cl
      where cl.club_id = k.id and cl.published and cl.cancelled_at is null
        and exists (select 1 from public.reservations r where r.clinic_id = cl.id and r.status = 'booked' and r.ends_at > now())
    ), '[]'::jsonb)
  )
  from public.clubs k where k.slug = lower(p_slug) and k.public_events
$$;

-- ---------------------------------------------------------------------------
-- Events: registering
-- ---------------------------------------------------------------------------

/**
 * Registers you (or, for staff, the player p_owner_code) for an event: the whole program, or
 * one date (p_reservation, when drop-ins are allowed). Checks the registration window,
 * restrictions, required questions (p_answers) and the disclosure (p_accept). A full event
 * puts you on the waitlist when it has one. When the event takes payment online and you're
 * registering yourself, your spot is held for 15 minutes ('pending') while you pay.
 */
create function public.res_register_event(
  p_clinic uuid, p_reservation uuid default null, p_owner_code text default null,
  p_answers jsonb default '{}', p_accept boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  cl public.clinics;
  k public.clubs;
  staff boolean;
  who uuid := uid;
  r public.reservations;
  v_status text;
  amount integer;
  answers jsonb;
  missing text;
  why text;
  online boolean;
  g public.clinic_registrations;
begin
  select * into cl from public.clinics where id = p_clinic and cancelled_at is null;
  if not found then
    raise exception 'Event not found.';
  end if;
  select * into k from public.clubs where id = cl.club_id;
  staff := public.res_is_staff(cl.club_id);
  if not cl.published and not staff then
    raise exception 'Event not found.';
  end if;
  if nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    perform public.res_require_staff(cl.club_id);
    select id into who from public.profiles where player_code = upper(btrim(p_owner_code));
    if who is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
    insert into public.club_members (club_id, user_id) values (cl.club_id, who) on conflict do nothing;
  else
    if public.res_role(cl.club_id) is null then
      if cl.members_only then
        raise exception 'This event is for % members. Join the club to register.', k.name;
      end if;
      insert into public.club_members (club_id, user_id) values (cl.club_id, uid) on conflict do nothing;
    end if;
    if public.res_suspended_until(cl.club_id, uid) is not null then
      raise exception 'Registration is paused because of late cancellations or no-shows.';
    end if;
    if cl.registration_opens_at is not null and now() < cl.registration_opens_at then
      raise exception 'Registration opens %.', to_char(cl.registration_opens_at at time zone k.timezone, 'Mon FMDD "at" FMHH12:MI AM');
    end if;
    if cl.registration_closes_at is not null and now() > cl.registration_closes_at then
      raise exception 'Registration has closed.';
    end if;
    why := public.res_event_ineligible(cl, uid);
    if why is not null then
      raise exception '%', why;
    end if;
    if cl.disclosure is not null and not coalesce(p_accept, false) then
      raise exception 'Please read and accept the event’s terms.';
    end if;
  end if;

  select coalesce(jsonb_object_agg(f ->> 'id', p_answers -> (f ->> 'id')), '{}') into answers
  from jsonb_array_elements(cl.custom_fields) f where coalesce(p_answers, '{}') ? (f ->> 'id');
  if who = uid and not staff then
    select string_agg(f ->> 'label', ', ') into missing
    from jsonb_array_elements(cl.custom_fields) f
    where coalesce((f ->> 'required')::boolean, false)
      and (answers -> (f ->> 'id') is null or btrim(answers ->> (f ->> 'id')) = ''
           or (f ->> 'type' = 'checkbox' and answers ->> (f ->> 'id') <> 'true'));
    if missing is not null then
      raise exception 'Please fill in: %.', missing;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(cl.club_id::text, 0));
  perform public.res_release_expired_registrations(cl.id);

  -- Paying online holds the spot; staff registering someone, or free events, don't.
  online := cl.require_payment and who = uid and k.stripe_account_id is not null and k.stripe_charges_enabled;

  if p_reservation is not null then
    if cl.drop_in_price_cents is null then
      raise exception 'This event is for the whole program only.';
    end if;
    select * into r from public.reservations where id = p_reservation and clinic_id = cl.id and status = 'booked' and starts_at > now();
    if not found then
      raise exception 'That date isn''t available.';
    end if;
    if exists (select 1 from public.reservation_players where reservation_id = r.id and user_id = who) then
      raise exception 'You''re already on that date.';
    end if;
    if (select count(*) from public.reservation_players p where p.reservation_id = r.id and p.user_id is not null) >= cl.max_players then
      raise exception 'That date is full.';
    end if;
    amount := cl.drop_in_price_cents;
    v_status := case when online and amount > 0 then 'pending' else 'registered' end;
    insert into public.clinic_registrations (clinic_id, user_id, reservation_id, status, amount_cents, answers, disclosure_accepted_at, hold_expires_at)
    values (cl.id, who, r.id, v_status, amount, answers, case when p_accept then now() end,
            case when v_status = 'pending' then now() + interval '15 minutes' end)
    returning * into g;
    insert into public.reservation_players (reservation_id, user_id, position) values (r.id, who, 1);
    return jsonb_build_object('status', v_status, 'amountCents', amount, 'registrationId', g.id);
  end if;

  if exists (select 1 from public.clinic_registrations where clinic_id = cl.id and user_id = who and reservation_id is null and status <> 'cancelled') then
    raise exception 'You''re already signed up.';
  end if;
  if public.res_clinic_has_room(cl.id) then
    v_status := case when online and cl.price_cents > 0 then 'pending' else 'registered' end;
  elsif cl.waitlist then
    v_status := 'waitlisted';
  else
    raise exception 'This event is full.';
  end if;
  amount := case when v_status = 'waitlisted' then 0 else cl.price_cents end;
  insert into public.clinic_registrations (clinic_id, user_id, status, amount_cents, answers, disclosure_accepted_at, hold_expires_at)
  values (cl.id, who, v_status, amount, answers, case when p_accept then now() end,
          case when v_status = 'pending' then now() + interval '15 minutes' end)
  returning * into g;
  if v_status in ('registered', 'pending') then
    perform public.res_clinic_add_player(cl.id, who);
  end if;
  return jsonb_build_object('status', v_status, 'amountCents', amount, 'registrationId', g.id);
end;
$$;

/** The lessons migration's clinic registration, now with the event rules. */
create or replace function public.res_register_clinic(p_clinic uuid, p_reservation uuid default null, p_owner_code text default null)
returns jsonb
language sql security definer
set search_path = ''
as $$ select public.res_register_event(p_clinic, p_reservation, p_owner_code, '{}', false) $$;

/** As before; the player moved up from the waitlist gets a notification. */
create or replace function public.res_unregister_clinic(p_clinic uuid, p_reservation uuid default null, p_user uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  cl public.clinics;
  who uuid := coalesce(p_user, uid);
  next_up public.clinic_registrations;
begin
  select * into cl from public.clinics where id = p_clinic;
  if not found then
    raise exception 'Event not found.';
  end if;
  if who <> uid then
    perform public.res_require_staff(cl.club_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(cl.club_id::text, 0));

  update public.clinic_registrations set status = 'cancelled', cancelled_at = now()
  where clinic_id = cl.id and user_id = who and status <> 'cancelled'
    and (reservation_id = p_reservation or (p_reservation is null and reservation_id is null));
  if not found then
    raise exception 'You''re not signed up.';
  end if;

  delete from public.reservation_players p
  using public.reservations r
  where p.reservation_id = r.id and r.clinic_id = cl.id and p.user_id = who and r.starts_at > now()
    and (p_reservation is null or r.id = p_reservation)
    and not exists (
      select 1 from public.clinic_registrations g
      where g.clinic_id = cl.id and g.user_id = who and g.status in ('registered', 'pending')
        and (g.reservation_id is null or g.reservation_id = r.id)
    );

  perform public.res_release_expired_registrations(cl.id);
  select * into next_up from public.clinic_registrations
  where clinic_id = cl.id and status = 'waitlisted' order by created_at limit 1;
  if found and public.res_clinic_has_room(cl.id) then
    update public.clinic_registrations set status = 'registered', amount_cents = cl.price_cents where id = next_up.id;
    perform public.res_clinic_add_player(cl.id, next_up.user_id);
    perform public.res_notify(cl.club_id, next_up.user_id, 'A spot opened up: you''re in ' || cl.title,
      case when cl.price_cents > 0 then 'You moved up from the waitlist. ' || to_char(cl.price_cents / 100.0, 'FM$999,990.00') || ' is due.' else 'You moved up from the waitlist.' end,
      '/c/' || (select slug from public.clubs where id = cl.club_id) || '/events');
  end if;
end;
$$;

/** Paid online: confirms a pending registration (or, if its hold ran out and the spot's gone, says to refund). */
create function public.res_event_confirm(p_session text, p_payment_intent text, p_paid_cents integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  g public.clinic_registrations;
  cl public.clinics;
  refund boolean := false;
begin
  select * into g from public.clinic_registrations where stripe_session_id = p_session for update;
  if not found then
    return null;
  end if;
  select * into cl from public.clinics where id = g.clinic_id;
  if g.status = 'pending' then
    update public.clinic_registrations set status = 'registered', hold_expires_at = null, paid_cents = p_paid_cents, stripe_payment_intent = p_payment_intent
    where id = g.id returning * into g;
  elsif g.status = 'cancelled' and g.paid_cents = 0 then
    -- The hold ran out first: take them back if there's still room, otherwise refund.
    perform pg_advisory_xact_lock(hashtextextended(cl.club_id::text, 0));
    if cl.cancelled_at is null and public.res_clinic_has_room(cl.id) then
      update public.clinic_registrations set status = 'registered', cancelled_at = null, hold_expires_at = null,
        paid_cents = p_paid_cents, stripe_payment_intent = p_payment_intent where id = g.id returning * into g;
      perform public.res_clinic_add_player(cl.id, g.user_id);
    else
      refund := true;
      update public.clinic_registrations set paid_cents = p_paid_cents, stripe_payment_intent = p_payment_intent where id = g.id;
    end if;
  end if;
  return jsonb_build_object('registrationId', g.id, 'status', g.status, 'refund', refund, 'paidCents', p_paid_cents,
    'paymentIntent', p_payment_intent, 'stripeAccount', (select stripe_account_id from public.clubs where id = cl.club_id),
    'userId', g.user_id, 'clubId', cl.club_id, 'title', cl.title);
end;
$$;

create function public.res_event_attach_session(p_registration uuid, p_session text)
returns void
language sql security definer
set search_path = ''
as $$ update public.clinic_registrations set stripe_session_id = p_session where id = p_registration $$;

/** What the payment function needs to charge a pending registration (only its own player). */
create function public.res_event_checkout_info(p_registration uuid, p_user uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('registrationId', g.id, 'amountCents', g.amount_cents, 'title', cl.title, 'clubName', k.name,
    'slug', k.slug, 'currency', k.currency, 'stripeAccount', k.stripe_account_id, 'holdExpiresAt', public.epoch_ms(g.hold_expires_at),
    'email', (select email from auth.users where id = g.user_id))
  from public.clinic_registrations g join public.clinics cl on cl.id = g.clinic_id join public.clubs k on k.id = cl.club_id
  where g.id = p_registration and g.user_id = p_user and g.status = 'pending' and g.hold_expires_at > now()
$$;

-- ---------------------------------------------------------------------------
-- Events: setting up (staff)
-- ---------------------------------------------------------------------------

/** As before, plus category, restrictions, disclosure, questions, members-only, registration window and online payment. */
create or replace function public.res_update_clinic(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  cl public.clinics;
begin
  select * into cl from public.clinics where id = p_id;
  if not found then
    raise exception 'Event not found.';
  end if;
  perform public.res_require_staff(cl.club_id);
  if p ? 'categoryId' and nullif(p ->> 'categoryId', '') is not null
     and not exists (select 1 from public.event_categories where id = (p ->> 'categoryId')::uuid and club_id = cl.club_id) then
    raise exception 'Category not found.';
  end if;
  update public.clinics set
    title = case when p ? 'title' then btrim(p ->> 'title') else title end,
    description = case when p ? 'description' then nullif(btrim(coalesce(p ->> 'description', '')), '') else description end,
    instructor_id = case when p ? 'instructorId' then nullif(p ->> 'instructorId', '')::uuid else instructor_id end,
    category_id = case when p ? 'categoryId' then nullif(p ->> 'categoryId', '')::uuid else category_id end,
    max_players = coalesce((p ->> 'maxPlayers')::integer, max_players),
    price_cents = coalesce((p ->> 'priceCents')::integer, price_cents),
    drop_in_price_cents = case when p ? 'dropInPriceCents' then (p ->> 'dropInPriceCents')::integer else drop_in_price_cents end,
    waitlist = coalesce((p ->> 'waitlist')::boolean, waitlist),
    published = coalesce((p ->> 'published')::boolean, published),
    gender = coalesce(p ->> 'gender', gender),
    min_age = case when p ? 'minAge' then (p ->> 'minAge')::integer else min_age end,
    max_age = case when p ? 'maxAge' then (p ->> 'maxAge')::integer else max_age end,
    min_rating = case when p ? 'minRating' then (p ->> 'minRating')::numeric else min_rating end,
    max_rating = case when p ? 'maxRating' then (p ->> 'maxRating')::numeric else max_rating end,
    disclosure = case when p ? 'disclosure' then nullif(btrim(coalesce(p ->> 'disclosure', '')), '') else disclosure end,
    custom_fields = coalesce(p -> 'customFields', custom_fields),
    members_only = coalesce((p ->> 'membersOnly')::boolean, members_only),
    registration_opens_at = case when p ? 'registrationOpensAt' then to_timestamp((p ->> 'registrationOpensAt')::double precision / 1000) else registration_opens_at end,
    registration_closes_at = case when p ? 'registrationClosesAt' then to_timestamp((p ->> 'registrationClosesAt')::double precision / 1000) else registration_closes_at end,
    require_payment = coalesce((p ->> 'requirePayment')::boolean, require_payment)
  where id = p_id
  returning * into cl;
  if p ? 'title' or p ? 'instructorId' then
    update public.reservations set title = cl.title, instructor_id = cl.instructor_id
    where clinic_id = cl.id and status = 'booked' and starts_at > now();
  end if;
  return public.res_clinic_json(cl, true);
exception
  when check_violation then
    raise exception 'Check the title, spots, prices, ages and gender.';
end;
$$;

create function public.res_save_event_category(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
    raise exception 'Name the category.';
  end if;
  if p ? 'id' then
    update public.event_categories set name = btrim(p ->> 'name'), color = coalesce(p ->> 'color', color)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.event_categories (club_id, name, color, sort_order)
    values (p_club, btrim(p ->> 'name'), coalesce(p ->> 'color', '#6A4FC8'),
            (select coalesce(max(sort_order), 0) + 1 from public.event_categories where club_id = p_club));
  end if;
  return public.res_event_categories(p_club);
end;
$$;

create function public.res_delete_event_category(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.event_categories where id = p_id;
  if club is null then
    raise exception 'Category not found.';
  end if;
  perform public.res_require_staff(club);
  delete from public.event_categories where id = p_id;
  return public.res_event_categories(club);
end;
$$;

/** Admins: lists the club's published events on its public page (/events/<slug>) or not. */
create function public.res_set_public_events(p_club uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  update public.clubs set public_events = p_on where id = p_club;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members' details
-- ---------------------------------------------------------------------------

/** Your details at a club (or, for staff, a member's): birth date, gender, ZIP code. */
create function public.res_member_details(p_club uuid, p_user uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  who uuid := coalesce(p_user, uid);
begin
  if who <> uid then
    perform public.res_require_staff(p_club);
  end if;
  return (select jsonb_build_object('birthDate', to_char(m.birth_date, 'YYYY-MM-DD'), 'gender', m.gender, 'zip', m.zip)
          from public.club_members m where m.club_id = p_club and m.user_id = who);
end;
$$;

create function public.res_save_member_details(p_club uuid, p jsonb, p_user uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  who uuid := coalesce(p_user, uid);
begin
  if who <> uid then
    perform public.res_require_staff(p_club);
  elsif not exists (select 1 from public.clubs where id = p_club) then
    raise exception 'Club not found.';
  else
    -- Filling in your details (say, for an event open to everyone) adds you to the club.
    insert into public.club_members (club_id, user_id) values (p_club, uid) on conflict do nothing;
  end if;
  update public.club_members set
    birth_date = case when p ? 'birthDate' then nullif(p ->> 'birthDate', '')::date else birth_date end,
    gender = case when p ? 'gender' then nullif(p ->> 'gender', '') else gender end,
    zip = case when p ? 'zip' then nullif(left(btrim(coalesce(p ->> 'zip', '')), 12), '') else zip end
  where club_id = p_club and user_id = who;
  if not found then
    raise exception 'Join the club first.';
  end if;
  return public.res_member_details(p_club, p_user);
exception
  when check_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Check the birth date and gender.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_notify(uuid, uuid, text, text, text), public.res_my_notifications(), public.res_read_notifications(),
  public.res_player_rating(uuid, uuid), public.res_event_ineligible(public.clinics, uuid), public.res_release_expired_registrations(uuid),
  public.res_event_categories(uuid), public.res_public_events(text), public.res_register_event(uuid, uuid, text, jsonb, boolean),
  public.res_event_confirm(text, text, integer), public.res_event_attach_session(uuid, text), public.res_event_checkout_info(uuid, uuid),
  public.res_save_event_category(uuid, jsonb), public.res_delete_event_category(uuid), public.res_set_public_events(uuid, boolean),
  public.res_member_details(uuid, uuid), public.res_save_member_details(uuid, jsonb, uuid)
from public, anon, authenticated;

grant execute on function
  public.res_my_notifications(), public.res_read_notifications(), public.res_event_categories(uuid),
  public.res_register_event(uuid, uuid, text, jsonb, boolean), public.res_save_event_category(uuid, jsonb),
  public.res_delete_event_category(uuid), public.res_set_public_events(uuid, boolean),
  public.res_member_details(uuid, uuid), public.res_save_member_details(uuid, jsonb, uuid), public.res_public_events(text)
to authenticated;
grant execute on function public.res_public_events(text) to anon;
grant execute on function
  public.res_event_confirm(text, text, integer), public.res_event_attach_session(uuid, text), public.res_event_checkout_info(uuid, uuid),
  public.res_notify(uuid, uuid, text, text, text)
to service_role;
