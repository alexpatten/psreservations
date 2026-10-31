-- Lessons: teaching pros, private lessons and clinics, for Pickle Spots Reservations.
--
-- Instructors (pros) belong to a club, have a type (Head Pro, Teaching Pro, Coach…) for
-- reporting, weekly availability and time off, and can be linked to a Pickle Spots account so
-- they can sign in, see their schedule and take attendance. Pro pricing is a table of hourly
-- rates: for one instructor, an instructor type or the whole club, for some days and hours,
-- and up to a number of players (private, semi-private, small group). The most specific rate
-- that fits wins.
--
-- A private lesson is a reservation with an instructor: members pick a pro, a length and one
-- of the pro's open times, and get the next free court. A clinic is a group program on one
-- or more dates, each date a reservation; players register for the whole program (or drop
-- in for one date when the club allows), and a full clinic has a waitlist whose first player
-- moves up automatically when someone drops. Registered players are on each date's
-- reservation, so check-in (attendance) works as it does for courts, and instructors can
-- check in their own students.
--
-- Prices are recorded with each lesson and registration (amount and paid) for staff to collect
-- at the desk now and for invoicing later.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.instructor_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 0
);

create index instructor_types_club on public.instructor_types (club_id, sort_order);

create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- Their Pickle Spots account, so they can see their schedule and take attendance.
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 60),
  type_id uuid references public.instructor_types (id) on delete set null,
  bio text check (char_length(bio) <= 500),
  color text not null default '#F2711C' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Members can book private lessons with them online.
  members_can_book boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (club_id, user_id)
);

create index instructors_club on public.instructors (club_id, sort_order);

-- When they teach, week to week, in the club's time zone.
create table public.instructor_availability (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  days integer[] not null check (days <@ '{0,1,2,3,4,5,6}' and cardinality(days) > 0),
  starts time not null,
  ends time not null,
  check (ends > starts)
);

create index instructor_availability_instructor on public.instructor_availability (instructor_id);

create table public.instructor_time_off (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (char_length(reason) <= 120),
  check (ends_at > starts_at)
);

create index instructor_time_off_instructor on public.instructor_time_off (instructor_id, ends_at);

-- Pro pricing: an hourly rate for an instructor, an instructor type, or the club (neither).
create table public.instructor_rates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  instructor_id uuid references public.instructors (id) on delete cascade,
  instructor_type_id uuid references public.instructor_types (id) on delete cascade,
  name text not null default 'Private' check (char_length(name) between 1 and 40),
  -- Covers lessons of up to this many players.
  max_players integer not null default 1 check (max_players between 1 and 50),
  days integer[] not null default '{0,1,2,3,4,5,6}' check (days <@ '{0,1,2,3,4,5,6}' and cardinality(days) > 0),
  starts time not null default '00:00',
  ends time not null default '24:00',
  price_cents integer not null check (price_cents between 0 and 1000000),
  check (ends > starts),
  check (instructor_id is null or instructor_type_id is null)
);

create index instructor_rates_club on public.instructor_rates (club_id);

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text check (char_length(description) <= 1000),
  instructor_id uuid references public.instructors (id) on delete set null,
  type_id uuid not null references public.reservation_types (id),
  max_players integer not null check (max_players between 1 and 200),
  -- The whole program, and one date (null: no drop-ins).
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  drop_in_price_cents integer check (drop_in_price_cents between 0 and 1000000),
  waitlist boolean not null default true,
  -- Draft clinics are visible to staff only.
  published boolean not null default true,
  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index clinics_club on public.clinics (club_id);

create table public.clinic_registrations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A drop-in for one date; null for the whole program.
  reservation_id uuid references public.reservations (id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'waitlisted', 'cancelled')),
  amount_cents integer not null default 0,
  paid_cents integer not null default 0,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index clinic_registrations_clinic on public.clinic_registrations (clinic_id, status, created_at);
create index clinic_registrations_user on public.clinic_registrations (user_id);
-- One live registration per player per clinic (or per drop-in date).
create unique index clinic_registrations_once on public.clinic_registrations
  (clinic_id, user_id, coalesce(reservation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'cancelled';

alter table public.reservation_types add column is_lesson boolean not null default false;
update public.reservation_types set is_lesson = true where name in ('Private Lesson', 'Clinic');

alter table public.reservations
  add column instructor_id uuid references public.instructors (id) on delete set null,
  add column clinic_id uuid references public.clinics (id) on delete set null;

create index reservations_instructor on public.reservations (instructor_id, starts_at) where instructor_id is not null;
create index reservations_clinic on public.reservations (clinic_id, starts_at) where clinic_id is not null;

alter table public.instructor_types enable row level security;
alter table public.instructors enable row level security;
alter table public.instructor_availability enable row level security;
alter table public.instructor_time_off enable row level security;
alter table public.instructor_rates enable row level security;
alter table public.clinics enable row level security;
alter table public.clinic_registrations enable row level security;
revoke all on
  public.instructor_types, public.instructors, public.instructor_availability, public.instructor_time_off,
  public.instructor_rates, public.clinics, public.clinic_registrations
from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Whether you're the instructor on a reservation (so you can take attendance). */
create function public.res_teaches(r public.reservations)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select r.instructor_id is not null and exists (
    select 1 from public.instructors i where i.id = r.instructor_id and i.user_id = (select auth.uid())
  )
$$;

/** Why an instructor can't teach then (another lesson or time off), or null. */
create function public.res_instructor_busy(p_instructor uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_except uuid default null)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select 'The instructor is off then' || coalesce(' (' || t.reason || ')', '') || '.'
     from public.instructor_time_off t
     where t.instructor_id = p_instructor and t.starts_at < p_ends_at and t.ends_at > p_starts_at limit 1),
    (select 'The instructor is already teaching then.'
     from public.reservations r
     where r.instructor_id = p_instructor and r.id is distinct from p_except
       and (r.status = 'booked' or (r.status = 'held' and r.hold_expires_at > now()))
       and r.starts_at < p_ends_at and r.ends_at > p_starts_at limit 1)
  )
$$;

/** Whether a lesson fits inside one of the instructor's weekly availability windows. */
create function public.res_instructor_available(p_instructor uuid, p_starts_at timestamptz, p_minutes integer)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.instructors i
    join public.clubs k on k.id = i.club_id
    join public.instructor_availability a on a.instructor_id = i.id
    cross join lateral (select p_starts_at at time zone k.timezone as local_start) l
    where i.id = p_instructor
      and extract(dow from l.local_start)::integer = any(a.days)
      and public.res_minutes(l.local_start) >= public.res_time_minutes(a.starts)
      and public.res_minutes(l.local_start) + p_minutes <= public.res_time_minutes(a.ends)
  )
$$;

/**
 * What a lesson costs, from pro pricing by the hour: the rate for the smallest group that fits,
 * and of those the most specific (the instructor's, their type's, then the club's). Null when
 * no rate fits.
 */
create function public.res_lesson_price(p_instructor uuid, p_starts_at timestamptz, p_minutes integer, p_players integer)
returns integer
language sql stable
set search_path = ''
as $$
  select round(x.price_cents * p_minutes / 60.0)::integer
  from public.instructors i
  join public.clubs k on k.id = i.club_id
  cross join lateral (select p_starts_at at time zone k.timezone as local_start) l
  join public.instructor_rates x on x.club_id = i.club_id
  where i.id = p_instructor
    and (x.instructor_id = i.id
         or (x.instructor_id is null and x.instructor_type_id = i.type_id)
         or (x.instructor_id is null and x.instructor_type_id is null))
    and extract(dow from l.local_start)::integer = any(x.days)
    and public.res_minutes(l.local_start) >= public.res_time_minutes(x.starts)
    and public.res_minutes(l.local_start) < public.res_time_minutes(x.ends)
    and x.max_players >= greatest(p_players, 1)
  -- The rate for the smallest group that fits (private before semi-private), then the most specific.
  order by x.max_players,
           case when x.instructor_id is not null then 0 when x.instructor_type_id is not null then 1 else 2 end,
           x.price_cents
  limit 1
$$;

/** The first free lesson court then: active, a court (not a ball machine), by the club's order. */
create function public.res_free_lesson_court(p_club uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns uuid
language sql stable
set search_path = ''
as $$
  select c.id from public.club_courts c
  where c.club_id = p_club and c.active and c.kind = 'court'
    and public.res_conflict(c.id, p_starts_at, p_ends_at) is null
  order by c.sort_order, c.name
  limit 1
$$;

/** As before, plus the instructor and clinic. */
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
    'instructorId', r.instructor_id,
    'clinicId', r.clinic_id,
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

/** An instructor for the app; p_full adds staff-only details (linked account, time off). */
create function public.res_instructor_json(i public.instructors, p_full boolean)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'typeId', i.type_id,
    'bio', i.bio,
    'color', i.color,
    'membersCanBook', i.members_can_book,
    'sortOrder', i.sort_order,
    'isMe', i.user_id = (select auth.uid()),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'days', to_jsonb(a.days), 'starts', to_char(a.starts, 'HH24:MI'), 'ends', to_char(a.ends, 'HH24:MI')) order by a.starts)
      from public.instructor_availability a where a.instructor_id = i.id
    ), '[]'::jsonb),
    'userId', case when p_full then i.user_id end,
    'account', case when p_full and i.user_id is not null then (
      select jsonb_build_object('name', u.first_name || ' ' || u.last_name, 'playerCode', u.player_code)
      from public.profiles u where u.id = i.user_id
    ) end,
    'timeOff', case when p_full then coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'startsAt', public.epoch_ms(t.starts_at), 'endsAt', public.epoch_ms(t.ends_at), 'reason', t.reason) order by t.starts_at)
      from public.instructor_time_off t where t.instructor_id = i.id and t.ends_at > now()
    ), '[]'::jsonb) end
  )
$$;

-- ---------------------------------------------------------------------------
-- Reading: pros, prices, open times, clinics
-- ---------------------------------------------------------------------------

/** The club's lesson setup: instructors, instructor types, pro pricing, and which reservation types are lessons. */
create function public.res_lessons(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  staff boolean := public.res_is_staff(p_club);
begin
  perform public.res_require_user();
  return jsonb_build_object(
    'instructors', coalesce((
      select jsonb_agg(public.res_instructor_json(i, staff) order by i.sort_order, i.name)
      from public.instructors i
      where i.club_id = p_club and i.active and (staff or i.members_can_book or i.user_id = (select auth.uid()))
    ), '[]'::jsonb),
    'instructorTypes', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'sortOrder', t.sort_order) order by t.sort_order, t.name)
      from public.instructor_types t where t.club_id = p_club
    ), '[]'::jsonb),
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'instructorId', x.instructor_id, 'instructorTypeId', x.instructor_type_id, 'name', x.name,
        'maxPlayers', x.max_players, 'days', to_jsonb(x.days), 'starts', to_char(x.starts, 'HH24:MI'),
        'ends', to_char(x.ends, 'HH24:MI'), 'priceCents', x.price_cents
      ) order by x.instructor_id nulls last, x.instructor_type_id nulls last, x.max_players, x.starts)
      from public.instructor_rates x where x.club_id = p_club
    ), '[]'::jsonb),
    'lessonTypeIds', coalesce((
      select jsonb_agg(t.id order by t.sort_order) from public.reservation_types t where t.club_id = p_club and t.active and t.is_lesson
    ), '[]'::jsonb),
    'myInstructorId', (select i.id from public.instructors i where i.club_id = p_club and i.active and i.user_id = (select auth.uid()))
  );
end;
$$;

/**
 * Start times on a day when an instructor can teach a lesson of that length with that many
 * players: inside their availability, not teaching or off, a court free, and (for members)
 * within the club's booking window. With the price of each.
 */
create function public.res_lesson_times(p_instructor uuid, p_day date, p_minutes integer, p_players integer default 1)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  i public.instructors;
  k public.clubs;
  staff boolean;
begin
  perform public.res_require_user();
  select * into i from public.instructors where id = p_instructor and active;
  if not found then
    raise exception 'Instructor not found.';
  end if;
  select * into k from public.clubs where id = i.club_id;
  staff := public.res_is_staff(k.id);
  if public.res_role(k.id) is null then
    raise exception 'Join % to book lessons.', k.name;
  end if;
  if not staff and not i.members_can_book then
    raise exception 'Lessons with % are booked through the front desk.', i.name;
  end if;
  if p_minutes is null or p_minutes not between 15 and 480 then
    raise exception 'Choose how long the lesson is.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('startsAt', public.epoch_ms(t.starts_at), 'priceCents', public.res_lesson_price(i.id, t.starts_at, p_minutes, p_players)) order by t.starts_at)
    from (
      select distinct (p_day + make_interval(mins => m)) at time zone k.timezone as starts_at
      from public.instructor_availability a
      cross join lateral generate_series(public.res_time_minutes(a.starts), public.res_time_minutes(a.ends) - p_minutes, 30) m
      where a.instructor_id = i.id and extract(dow from p_day)::integer = any(a.days)
    ) t
    where t.starts_at > now()
      and (staff or t.starts_at <= now() + make_interval(days => k.advance_days))
      and public.res_instructor_busy(i.id, t.starts_at, t.starts_at + make_interval(mins => p_minutes)) is null
      and public.res_free_lesson_court(k.id, t.starts_at, t.starts_at + make_interval(mins => p_minutes)) is not null
  ), '[]'::jsonb);
end;
$$;

/** Time off for the club's instructors between two moments (the instructor scheduler shades it). */
create function public.res_instructor_time_off(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_user();
  if public.res_role(p_club) is null then
    raise exception 'Join the club to see its instructors.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'instructorId', t.instructor_id, 'startsAt', public.epoch_ms(t.starts_at), 'endsAt', public.epoch_ms(t.ends_at),
      'reason', case when public.res_is_staff(p_club) then t.reason end
    ) order by t.starts_at)
    from public.instructor_time_off t
    join public.instructors i on i.id = t.instructor_id
    where i.club_id = p_club and t.starts_at < p_to and t.ends_at > p_from
  ), '[]'::jsonb);
end;
$$;

/** A clinic for the app, with its dates, how full it is and where you stand. */
create function public.res_clinic_json(cl public.clinics, p_full boolean)
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
    'maxPlayers', cl.max_players,
    'priceCents', cl.price_cents,
    'dropInPriceCents', cl.drop_in_price_cents,
    'waitlist', cl.waitlist,
    'published', cl.published,
    'cancelled', cl.cancelled_at is not null,
    'registered', (select count(*) from public.clinic_registrations g where g.clinic_id = cl.id and g.status = 'registered' and g.reservation_id is null),
    'waitlisted', (select count(*) from public.clinic_registrations g where g.clinic_id = cl.id and g.status = 'waitlisted'),
    'myStatus', (
      select g.status from public.clinic_registrations g
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
          where g.reservation_id = r.id and g.user_id = (select auth.uid()) and g.status = 'registered'
        ),
        'checkedIn', case when p_full then (select count(*) from public.reservation_players p where p.reservation_id = r.id and p.checked_in_at is not null) end
      ) order by r.starts_at)
      from public.reservations r where r.clinic_id = cl.id and r.status <> 'cancelled'
    ), '[]'::jsonb)
  )
$$;

/** Clinics with dates still to come (staff also see drafts), soonest first. */
create function public.res_clinics(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  staff boolean := public.res_is_staff(p_club);
begin
  perform public.res_require_user();
  return coalesce((
    select jsonb_agg(public.res_clinic_json(cl, staff or exists (select 1 from public.instructors i where i.id = cl.instructor_id and i.user_id = (select auth.uid())))
                     order by (select min(r.starts_at) from public.reservations r where r.clinic_id = cl.id and r.status = 'booked'))
    from public.clinics cl
    where cl.club_id = p_club and cl.cancelled_at is null and (cl.published or staff)
      and exists (select 1 from public.reservations r where r.clinic_id = cl.id and r.status = 'booked' and r.ends_at > now())
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Private lessons
-- ---------------------------------------------------------------------------

/**
 * Books a private lesson. Members book an instructor who takes online bookings, at one of
 * their open times, within the club's booking window; staff can book any time the instructor
 * isn't teaching or off, for anyone (p_owner_code), on a chosen court (p_court). The court
 * is otherwise the first free one. The price comes from pro pricing.
 */
create function public.res_book_lesson(
  p_instructor uuid,
  p_type uuid,
  p_starts_at timestamptz,
  p_minutes integer,
  p_player_codes text[] default '{}',
  p_guests text[] default '{}',
  p_notes text default null,
  p_owner_code text default null,
  p_court uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  i public.instructors;
  k public.clubs;
  rtype public.reservation_types;
  staff boolean;
  owner uuid := uid;
  players uuid[];
  guests text[];
  total integer;
  ends_at timestamptz := p_starts_at + make_interval(mins => p_minutes);
  court uuid;
  busy text;
  r public.reservations;
  n integer;
begin
  select * into i from public.instructors where id = p_instructor and active;
  if not found then
    raise exception 'Instructor not found.';
  end if;
  select * into k from public.clubs where id = i.club_id;
  staff := public.res_is_staff(k.id);
  if not staff and public.res_role(k.id) is null then
    raise exception 'Join % to book lessons.', k.name;
  end if;
  select * into rtype from public.reservation_types where id = p_type and club_id = k.id and active and is_lesson;
  if not found then
    raise exception 'Choose a lesson type.';
  end if;
  if p_minutes is null or p_minutes not between 15 and 480 then
    raise exception 'Choose how long the lesson is.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(k.id::text, 0));

  if staff and nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    select id into owner from public.profiles where player_code = upper(btrim(p_owner_code));
    if owner is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
    insert into public.club_members (club_id, user_id) values (k.id, owner) on conflict do nothing;
  end if;

  select coalesce(array_agg(distinct u.id), '{}') into players
  from unnest(coalesce(p_player_codes, '{}')) code
  join public.profiles u on u.player_code = upper(btrim(code))
  where u.id is distinct from owner;
  select coalesce(array_agg(left(btrim(g), 40)), '{}') into guests
  from unnest(coalesce(p_guests, '{}')) g where btrim(g) <> '';
  total := 1 + cardinality(players) + cardinality(guests);

  if not staff then
    if public.res_suspended_until(k.id, uid) is not null then
      raise exception 'Booking at % is paused because of late cancellations or no-shows.', k.name;
    end if;
    if not i.members_can_book then
      raise exception 'Lessons with % are booked through the front desk.', i.name;
    end if;
    if p_starts_at <= now() then
      raise exception 'That time has already passed.';
    end if;
    if p_starts_at > now() + make_interval(days => k.advance_days) then
      raise exception 'You can book up to % days ahead.', k.advance_days;
    end if;
    if not public.res_instructor_available(i.id, p_starts_at, p_minutes) then
      raise exception '% doesn''t teach then. Pick one of the open times.', i.name;
    end if;
    if total > rtype.max_players then
      raise exception '% is for up to % players.', rtype.name, rtype.max_players;
    end if;
  end if;

  busy := public.res_instructor_busy(i.id, p_starts_at, ends_at);
  if busy is not null then
    raise exception '%', busy;
  end if;

  if p_court is not null and staff then
    if not exists (select 1 from public.club_courts where id = p_court and club_id = k.id and active) then
      raise exception 'Court not found.';
    end if;
    busy := public.res_conflict(p_court, p_starts_at, ends_at);
    if busy is not null then
      raise exception '%', busy;
    end if;
    court := p_court;
  else
    court := public.res_free_lesson_court(k.id, p_starts_at, ends_at);
    if court is null then
      raise exception 'Every court is taken then. Pick another time.';
    end if;
  end if;

  insert into public.reservations (
    club_id, court_id, type_id, instructor_id, owner_id, title, notes, starts_at, ends_at, is_prime, amount_cents, created_by
  ) values (
    k.id, court, rtype.id, i.id, owner, rtype.name || ' with ' || i.name,
    nullif(left(btrim(coalesce(p_notes, '')), 500), ''), p_starts_at, ends_at,
    public.res_is_prime(court, p_starts_at, ends_at),
    coalesce(public.res_lesson_price(i.id, p_starts_at, p_minutes, total), 0), uid
  ) returning * into r;

  insert into public.reservation_players (reservation_id, user_id, position) values (r.id, owner, 0);
  insert into public.reservation_players (reservation_id, user_id, position) select r.id, p, 1 from unnest(players) p;
  for n in 1..cardinality(guests) loop
    insert into public.reservation_players (reservation_id, guest_name, position) values (r.id, guests[n], 2 + n);
  end loop;

  return public.res_reservation_json(r, true);
end;
$$;

/** Staff: records what's been paid for a lesson (reservation) or a clinic registration. */
create function public.res_set_paid(p_reservation uuid default null, p_registration uuid default null, p_paid_cents integer default 0)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  if p_reservation is not null then
    select club_id into club from public.reservations where id = p_reservation;
  else
    select cl.club_id into club from public.clinic_registrations g join public.clinics cl on cl.id = g.clinic_id where g.id = p_registration;
  end if;
  if club is null then
    raise exception 'Not found.';
  end if;
  perform public.res_require_staff(club);
  if p_paid_cents is null or p_paid_cents < 0 then
    raise exception 'Enter the amount paid.';
  end if;
  if p_reservation is not null then
    update public.reservations set paid_cents = p_paid_cents where id = p_reservation;
  else
    update public.clinic_registrations set paid_cents = p_paid_cents where id = p_registration;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clinics
-- ---------------------------------------------------------------------------

/**
 * Staff: creates a clinic on a court every week on the chosen days between two dates (or one
 * date: p_from = p_until), each date a reservation. Dates whose court is taken or whose
 * instructor is busy are skipped and listed.
 */
create function public.res_create_clinic(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  k public.clubs;
  cl public.clinics;
  court uuid := nullif(p ->> 'courtId', '')::uuid;
  instructor uuid := nullif(p ->> 'instructorId', '')::uuid;
  days integer[] := public.res_days(p -> 'days');
  start_time time := (p ->> 'startTime')::time;
  minutes integer := (p ->> 'minutes')::integer;
  from_date date := (p ->> 'from')::date;
  until_date date := coalesce((p ->> 'until')::date, (p ->> 'from')::date);
  d date;
  s timestamptz;
  e timestamptz;
  why text;
  created integer := 0;
  skipped jsonb := '[]';
begin
  perform public.res_require_staff(p_club);
  select * into k from public.clubs where id = p_club;
  if char_length(btrim(coalesce(p ->> 'title', ''))) not between 1 and 80 then
    raise exception 'Give the clinic a title (up to 80 characters).';
  end if;
  if not exists (select 1 from public.club_courts where id = court and club_id = p_club and active) then
    raise exception 'Choose a court.';
  end if;
  if instructor is not null and not exists (select 1 from public.instructors where id = instructor and club_id = p_club and active) then
    raise exception 'Instructor not found.';
  end if;
  if not exists (select 1 from public.reservation_types where id = (p ->> 'typeId')::uuid and club_id = p_club and active) then
    raise exception 'Choose a reservation type.';
  end if;
  if start_time is null or minutes is null or minutes not between 15 and 720 then
    raise exception 'Choose the start time and length.';
  end if;
  if from_date is null or until_date < from_date or until_date > from_date + 366 then
    raise exception 'Choose the dates (up to a year).';
  end if;
  if cardinality(days) = 0 then
    days := array[extract(dow from from_date)::integer];
  end if;

  insert into public.clinics (club_id, title, description, instructor_id, type_id, max_players, price_cents, drop_in_price_cents, waitlist, published, created_by)
  values (
    p_club, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), instructor, (p ->> 'typeId')::uuid,
    coalesce((p ->> 'maxPlayers')::integer, 8), coalesce((p ->> 'priceCents')::integer, 0), (p ->> 'dropInPriceCents')::integer,
    coalesce((p ->> 'waitlist')::boolean, true), coalesce((p ->> 'published')::boolean, true), uid
  ) returning * into cl;

  perform pg_advisory_xact_lock(hashtextextended(p_club::text, 0));
  d := from_date;
  while d <= until_date and created < 200 loop
    if extract(dow from d)::integer = any(days) then
      s := (d + start_time) at time zone k.timezone;
      e := s + make_interval(mins => minutes);
      if s > now() then
        why := coalesce(public.res_conflict(court, s, e), case when instructor is not null then public.res_instructor_busy(instructor, s, e) end);
        if why is null then
          insert into public.reservations (club_id, court_id, type_id, instructor_id, clinic_id, title, starts_at, ends_at, is_prime, created_by)
          values (p_club, court, cl.type_id, instructor, cl.id, cl.title, s, e, public.res_is_prime(court, s, e), uid);
          created := created + 1;
        else
          skipped := skipped || jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'reason', why);
        end if;
      end if;
    end if;
    d := d + 1;
  end loop;
  if created = 0 then
    raise exception 'None of those dates were free%', coalesce(': ' || (skipped -> 0 ->> 'reason'), '.');
  end if;

  return jsonb_build_object('clinicId', cl.id, 'created', created, 'skipped', skipped);
exception
  when check_violation then
    raise exception 'Check the spots (1 to 200) and prices.';
end;
$$;

/** Staff: changes a clinic's details (title, description, instructor, spots, prices, waitlist, published). */
create function public.res_update_clinic(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  cl public.clinics;
begin
  select * into cl from public.clinics where id = p_id;
  if not found then
    raise exception 'Clinic not found.';
  end if;
  perform public.res_require_staff(cl.club_id);
  update public.clinics set
    title = case when p ? 'title' then btrim(p ->> 'title') else title end,
    description = case when p ? 'description' then nullif(btrim(coalesce(p ->> 'description', '')), '') else description end,
    instructor_id = case when p ? 'instructorId' then nullif(p ->> 'instructorId', '')::uuid else instructor_id end,
    max_players = coalesce((p ->> 'maxPlayers')::integer, max_players),
    price_cents = coalesce((p ->> 'priceCents')::integer, price_cents),
    drop_in_price_cents = case when p ? 'dropInPriceCents' then (p ->> 'dropInPriceCents')::integer else drop_in_price_cents end,
    waitlist = coalesce((p ->> 'waitlist')::boolean, waitlist),
    published = coalesce((p ->> 'published')::boolean, published)
  where id = p_id
  returning * into cl;
  if p ? 'title' or p ? 'instructorId' then
    update public.reservations set title = cl.title, instructor_id = cl.instructor_id
    where clinic_id = cl.id and status = 'booked' and starts_at > now();
  end if;
  return public.res_clinic_json(cl, true);
exception
  when check_violation then
    raise exception 'Check the title, spots (1 to 200) and prices.';
end;
$$;

/** Staff: cancels a clinic: its upcoming dates and every registration. */
create function public.res_cancel_clinic(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cl public.clinics;
begin
  select * into cl from public.clinics where id = p_id;
  if not found then
    raise exception 'Clinic not found.';
  end if;
  perform public.res_require_staff(cl.club_id);
  update public.clinics set cancelled_at = now() where id = p_id;
  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Clinic cancelled'
  where clinic_id = p_id and status = 'booked' and starts_at > now();
  update public.clinic_registrations set status = 'cancelled', cancelled_at = now() where clinic_id = p_id and status <> 'cancelled';
end;
$$;

/** Adds a player to every upcoming date of a clinic. */
create function public.res_clinic_add_player(p_clinic uuid, p_user uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.reservation_players (reservation_id, user_id, position)
  select r.id, p_user, 1 from public.reservations r
  where r.clinic_id = p_clinic and r.status = 'booked' and r.starts_at > now()
  on conflict (reservation_id, user_id) do nothing
$$;

/** Whether every upcoming date of a clinic has a spot left. */
create function public.res_clinic_has_room(p_clinic uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.reservations r join public.clinics cl on cl.id = r.clinic_id
    where r.clinic_id = p_clinic and r.status = 'booked' and r.starts_at > now()
      and (select count(*) from public.reservation_players p where p.reservation_id = r.id and p.user_id is not null) >= cl.max_players
  )
$$;

/**
 * Registers you (or, for staff, the player p_owner_code) for a clinic: the whole program, or
 * one date (p_reservation, a drop-in, when the clinic allows them). A full program puts you on
 * the waitlist when it has one. Returns your status.
 */
create function public.res_register_clinic(p_clinic uuid, p_reservation uuid default null, p_owner_code text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  cl public.clinics;
  who uuid := uid;
  r public.reservations;
  v_status text;
begin
  select * into cl from public.clinics where id = p_clinic and cancelled_at is null;
  if not found then
    raise exception 'Clinic not found.';
  end if;
  if not cl.published and not public.res_is_staff(cl.club_id) then
    raise exception 'Clinic not found.';
  end if;
  if public.res_role(cl.club_id) is null then
    raise exception 'Join the club to register.';
  end if;
  if nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    perform public.res_require_staff(cl.club_id);
    select id into who from public.profiles where player_code = upper(btrim(p_owner_code));
    if who is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
    insert into public.club_members (club_id, user_id) values (cl.club_id, who) on conflict do nothing;
  elsif public.res_suspended_until(cl.club_id, uid) is not null then
    raise exception 'Registration is paused because of late cancellations or no-shows.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(cl.club_id::text, 0));

  if p_reservation is not null then
    if cl.drop_in_price_cents is null then
      raise exception 'This clinic is for the whole program only.';
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
    insert into public.clinic_registrations (clinic_id, user_id, reservation_id, amount_cents) values (cl.id, who, r.id, cl.drop_in_price_cents);
    insert into public.reservation_players (reservation_id, user_id, position) values (r.id, who, 1);
    return jsonb_build_object('status', 'registered', 'amountCents', cl.drop_in_price_cents);
  end if;

  if exists (select 1 from public.clinic_registrations where clinic_id = cl.id and user_id = who and reservation_id is null and status <> 'cancelled') then
    raise exception 'You''re already signed up.';
  end if;
  if public.res_clinic_has_room(cl.id) then
    v_status := 'registered';
  elsif cl.waitlist then
    v_status := 'waitlisted';
  else
    raise exception 'This clinic is full.';
  end if;
  insert into public.clinic_registrations (clinic_id, user_id, status, amount_cents)
  values (cl.id, who, v_status, case when v_status = 'registered' then cl.price_cents else 0 end);
  if v_status = 'registered' then
    perform public.res_clinic_add_player(cl.id, who);
  end if;
  return jsonb_build_object('status', v_status, 'amountCents', case when v_status = 'registered' then cl.price_cents else 0 end);
end;
$$;

/**
 * Drops you (or, for staff, p_user) from a clinic's program, or one drop-in date
 * (p_reservation), and moves the first player on the waitlist up when there's room.
 */
create function public.res_unregister_clinic(p_clinic uuid, p_reservation uuid default null, p_user uuid default null)
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
    raise exception 'Clinic not found.';
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
    -- A drop-in stays on other dates they're registered for.
    and not exists (
      select 1 from public.clinic_registrations g
      where g.clinic_id = cl.id and g.user_id = who and g.status = 'registered'
        and (g.reservation_id is null or g.reservation_id = r.id)
    );

  -- First on the waitlist moves up.
  select * into next_up from public.clinic_registrations
  where clinic_id = cl.id and status = 'waitlisted' order by created_at limit 1;
  if found and public.res_clinic_has_room(cl.id) then
    update public.clinic_registrations set status = 'registered', amount_cents = cl.price_cents where id = next_up.id;
    perform public.res_clinic_add_player(cl.id, next_up.user_id);
  end if;
end;
$$;

/** Staff or the clinic's instructor: everyone registered or waiting, with payment and attendance. */
create function public.res_clinic_roster(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  cl public.clinics;
begin
  select * into cl from public.clinics where id = p_clinic;
  if not found then
    raise exception 'Clinic not found.';
  end if;
  if not public.res_is_staff(cl.club_id)
     and not exists (select 1 from public.instructors i where i.id = cl.instructor_id and i.user_id = (select auth.uid())) then
    raise exception 'Only club staff and the instructor can see the roster.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'userId', g.user_id, 'name', u.first_name || ' ' || u.last_name, 'playerCode', u.player_code,
      'status', g.status, 'dropInReservationId', g.reservation_id, 'amountCents', g.amount_cents, 'paidCents', g.paid_cents,
      'registeredAt', public.epoch_ms(g.created_at),
      'attended', (
        select count(*) from public.reservation_players p join public.reservations r on r.id = p.reservation_id
        where r.clinic_id = cl.id and p.user_id = g.user_id and p.checked_in_at is not null
      )
    ) order by case g.status when 'registered' then 0 else 1 end, g.created_at)
    from public.clinic_registrations g
    join public.profiles u on u.id = g.user_id
    where g.clinic_id = cl.id and g.status <> 'cancelled'
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Teaching and reporting
-- ---------------------------------------------------------------------------

/** Your lessons and clinic dates as an instructor between two moments, with rosters. */
create function public.res_my_teaching(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.res_reservation_json(r, true) order by r.starts_at), '[]'::jsonb)
  from public.reservations r
  join public.instructors i on i.id = r.instructor_id
  where r.club_id = p_club and i.user_id = (select auth.uid()) and r.status = 'booked'
    and r.starts_at < p_to and r.ends_at > p_from
$$;

/**
 * Staff: each instructor's numbers between two days (inclusive, club time): lessons and clinic
 * dates taught, hours on court, hours available, utilization, revenue billed and paid,
 * students, and attendance.
 */
create function public.res_instructor_report(p_club uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  k public.clubs;
  t1 timestamptz;
  t2 timestamptz;
begin
  perform public.res_require_staff(p_club);
  select * into k from public.clubs where id = p_club;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose up to a year.';
  end if;
  t1 := p_from::timestamp at time zone k.timezone;
  t2 := (p_to + 1)::timestamp at time zone k.timezone;
  return coalesce((
    select jsonb_agg(x.item order by x.hours desc)
    from (
      select taught.hours, jsonb_build_object(
        'instructorId', i.id,
        'name', i.name,
        'typeId', i.type_id,
        'lessons', taught.lessons,
        'clinicSessions', taught.clinic_sessions,
        'hours', round(taught.hours::numeric, 1),
        'availableHours', round(avail.hours::numeric, 1),
        'utilization', case when avail.hours > 0 then round((100 * taught.hours / avail.hours)::numeric) end,
        'revenueCents', taught.lesson_cents + coalesce((
          select sum(g.amount_cents) from public.clinic_registrations g join public.clinics cl on cl.id = g.clinic_id
          where cl.instructor_id = i.id and g.status = 'registered' and g.created_at >= t1 and g.created_at < t2
        ), 0),
        'paidCents', taught.paid_cents + coalesce((
          select sum(g.paid_cents) from public.clinic_registrations g join public.clinics cl on cl.id = g.clinic_id
          where cl.instructor_id = i.id and g.status = 'registered' and g.created_at >= t1 and g.created_at < t2
        ), 0),
        'students', taught.students,
        'attendance', case when taught.expected > 0 then round((100.0 * taught.attended / taught.expected)::numeric) end
      ) as item
      from public.instructors i
      cross join lateral (
        select
          count(*) filter (where r.clinic_id is null) as lessons,
          count(*) filter (where r.clinic_id is not null) as clinic_sessions,
          coalesce(sum(extract(epoch from r.ends_at - r.starts_at) / 3600), 0) as hours,
          coalesce(sum(r.amount_cents) filter (where r.clinic_id is null), 0) as lesson_cents,
          coalesce(sum(r.paid_cents) filter (where r.clinic_id is null), 0) as paid_cents,
          (select count(distinct p.user_id) from public.reservation_players p join public.reservations x on x.id = p.reservation_id
           where x.instructor_id = i.id and x.status = 'booked' and x.starts_at >= t1 and x.starts_at < t2 and p.user_id is not null) as students,
          (select count(*) from public.reservation_players p join public.reservations x on x.id = p.reservation_id
           where x.instructor_id = i.id and x.status = 'booked' and x.starts_at >= t1 and x.starts_at < least(t2, now())) as expected,
          (select count(*) from public.reservation_players p join public.reservations x on x.id = p.reservation_id
           where x.instructor_id = i.id and x.status = 'booked' and x.starts_at >= t1 and x.starts_at < least(t2, now()) and p.checked_in_at is not null) as attended
        from public.reservations r
        where r.instructor_id = i.id and r.status = 'booked' and r.starts_at >= t1 and r.starts_at < t2
      ) taught
      cross join lateral (
        select coalesce(sum(extract(epoch from a.ends - a.starts) / 3600), 0) as hours
        from generate_series(p_from, p_to, interval '1 day') d
        join public.instructor_availability a on a.instructor_id = i.id and extract(dow from d)::integer = any(a.days)
      ) avail
      where i.club_id = p_club and (i.active or taught.hours > 0)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting up (admins)
-- ---------------------------------------------------------------------------

/**
 * Adds or changes an instructor (p.id to change one). p.account links their Pickle Spots
 * account by player ID or email ('' unlinks); p.availability, when given, replaces their
 * weekly hours: [{days, starts, ends}].
 */
create function public.res_save_instructor(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.instructors;
  account uuid;
  q text := btrim(coalesce(p ->> 'account', ''));
  a jsonb;
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 60 then
    raise exception 'Enter the instructor''s name.';
  end if;
  if p ? 'typeId' and nullif(p ->> 'typeId', '') is not null
     and not exists (select 1 from public.instructor_types where id = (p ->> 'typeId')::uuid and club_id = p_club) then
    raise exception 'Instructor type not found.';
  end if;
  if q <> '' then
    if position('@' in q) > 0 then
      select id into account from auth.users where lower(email) = lower(q);
    else
      select id into account from public.profiles where player_code = upper(q);
    end if;
    if account is null then
      raise exception 'No Pickle Spots player has that %.', case when position('@' in q) > 0 then 'email' else 'player ID' end;
    end if;
    insert into public.club_members (club_id, user_id) values (p_club, account) on conflict do nothing;
  end if;

  if p ? 'id' then
    update public.instructors set
      name = btrim(p ->> 'name'),
      type_id = case when p ? 'typeId' then nullif(p ->> 'typeId', '')::uuid else type_id end,
      bio = case when p ? 'bio' then nullif(btrim(coalesce(p ->> 'bio', '')), '') else bio end,
      color = coalesce(p ->> 'color', color),
      members_can_book = coalesce((p ->> 'membersCanBook')::boolean, members_can_book),
      sort_order = coalesce((p ->> 'sortOrder')::integer, sort_order),
      user_id = case when p ? 'account' then account else user_id end
    where id = (p ->> 'id')::uuid and club_id = p_club and active
    returning * into i;
    if not found then
      raise exception 'Instructor not found.';
    end if;
  else
    insert into public.instructors (club_id, name, type_id, bio, color, members_can_book, sort_order, user_id)
    values (
      p_club, btrim(p ->> 'name'), nullif(p ->> 'typeId', '')::uuid, nullif(btrim(coalesce(p ->> 'bio', '')), ''),
      coalesce(p ->> 'color', '#F2711C'), coalesce((p ->> 'membersCanBook')::boolean, true),
      coalesce((p ->> 'sortOrder')::integer, (select coalesce(max(sort_order), 0) + 1 from public.instructors where club_id = p_club)),
      account
    ) returning * into i;
  end if;

  if p ? 'availability' then
    delete from public.instructor_availability where instructor_id = i.id;
    for a in select * from jsonb_array_elements(coalesce(p -> 'availability', '[]')) loop
      insert into public.instructor_availability (instructor_id, days, starts, ends)
      values (i.id, public.res_days(a -> 'days'), (a ->> 'starts')::time, (a ->> 'ends')::time);
    end loop;
  end if;
  return public.res_lessons(p_club);
exception
  when unique_violation then
    raise exception 'That account is already linked to another instructor here.';
  when check_violation then
    raise exception 'Check the color and the hours (each window ends after it starts, on at least one day).';
end;
$$;

/** Removes an instructor (their past lessons keep their name). */
create function public.res_delete_instructor(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.instructors where id = p_id;
  if club is null then
    raise exception 'Instructor not found.';
  end if;
  perform public.res_require_manager(club);
  if exists (select 1 from public.reservations where instructor_id = p_id and status = 'booked' and starts_at > now()) then
    raise exception 'They have upcoming lessons. Move or cancel them first.';
  end if;
  update public.instructors set active = false, user_id = null where id = p_id;
  return public.res_lessons(club);
end;
$$;

/** Staff: adds time off for an instructor (lessons can't be booked then). */
create function public.res_add_time_off(p_instructor uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.instructors where id = p_instructor;
  if club is null then
    raise exception 'Instructor not found.';
  end if;
  -- Staff, or the instructor themselves.
  if not public.res_is_staff(club) and not exists (select 1 from public.instructors where id = p_instructor and user_id = (select auth.uid())) then
    raise exception 'Only club staff can do that.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Choose when the time off starts and ends.';
  end if;
  insert into public.instructor_time_off (instructor_id, starts_at, ends_at, reason)
  values (p_instructor, p_starts_at, p_ends_at, nullif(left(btrim(coalesce(p_reason, '')), 120), ''));
  return public.res_lessons(club);
end;
$$;

create function public.res_delete_time_off(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
  instructor uuid;
begin
  select i.club_id, i.id into club, instructor
  from public.instructor_time_off t join public.instructors i on i.id = t.instructor_id where t.id = p_id;
  if club is null then
    raise exception 'Time off not found.';
  end if;
  if not public.res_is_staff(club) and not exists (select 1 from public.instructors where id = instructor and user_id = (select auth.uid())) then
    raise exception 'Only club staff can do that.';
  end if;
  delete from public.instructor_time_off where id = p_id;
  return public.res_lessons(club);
end;
$$;

/** Adds or renames an instructor type (p.id to change one). */
create function public.res_save_instructor_type(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
    raise exception 'Enter a name (up to 40 characters).';
  end if;
  if p ? 'id' then
    update public.instructor_types set name = btrim(p ->> 'name'), sort_order = coalesce((p ->> 'sortOrder')::integer, sort_order)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.instructor_types (club_id, name, sort_order)
    values (p_club, btrim(p ->> 'name'), (select coalesce(max(sort_order), 0) + 1 from public.instructor_types where club_id = p_club));
  end if;
  return public.res_lessons(p_club);
end;
$$;

create function public.res_delete_instructor_type(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.instructor_types where id = p_id;
  if club is null then
    raise exception 'Instructor type not found.';
  end if;
  perform public.res_require_manager(club);
  delete from public.instructor_types where id = p_id;
  return public.res_lessons(club);
end;
$$;

/** Adds or changes a pro pricing rate (p.id to change one). */
create function public.res_save_rate(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  instructor uuid := nullif(p ->> 'instructorId', '')::uuid;
  itype uuid := nullif(p ->> 'instructorTypeId', '')::uuid;
begin
  perform public.res_require_manager(p_club);
  if instructor is not null and not exists (select 1 from public.instructors where id = instructor and club_id = p_club) then
    raise exception 'Instructor not found.';
  end if;
  if itype is not null and not exists (select 1 from public.instructor_types where id = itype and club_id = p_club) then
    raise exception 'Instructor type not found.';
  end if;
  if p ? 'id' then
    update public.instructor_rates set
      instructor_id = instructor, instructor_type_id = case when instructor is null then itype end,
      name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
      max_players = coalesce((p ->> 'maxPlayers')::integer, max_players),
      days = coalesce(nullif(public.res_days(p -> 'days'), '{}'), days),
      starts = coalesce((p ->> 'starts')::time, starts),
      ends = coalesce((p ->> 'ends')::time, ends),
      price_cents = coalesce((p ->> 'priceCents')::integer, price_cents)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.instructor_rates (club_id, instructor_id, instructor_type_id, name, max_players, days, starts, ends, price_cents)
    values (
      p_club, instructor, case when instructor is null then itype end, coalesce(nullif(btrim(p ->> 'name'), ''), 'Private'),
      coalesce((p ->> 'maxPlayers')::integer, 1), coalesce(nullif(public.res_days(p -> 'days'), '{}'), '{0,1,2,3,4,5,6}'),
      coalesce((p ->> 'starts')::time, '00:00'), coalesce((p ->> 'ends')::time, '24:00'), (p ->> 'priceCents')::integer
    );
  end if;
  return public.res_lessons(p_club);
exception
  when check_violation or not_null_violation then
    raise exception 'Enter a price, players (1 to 50), and hours that end after they start.';
end;
$$;

create function public.res_delete_rate(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.instructor_rates where id = p_id;
  if club is null then
    raise exception 'Rate not found.';
  end if;
  perform public.res_require_manager(club);
  delete from public.instructor_rates where id = p_id;
  return public.res_lessons(club);
end;
$$;

/** Admins: marks a reservation type as a lesson type (it can be booked with an instructor) or not. */
create function public.res_set_lesson_type(p_type uuid, p_is_lesson boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.reservation_types where id = p_type;
  if club is null then
    raise exception 'Reservation type not found.';
  end if;
  perform public.res_require_manager(club);
  update public.reservation_types set is_lesson = p_is_lesson where id = p_type;
  return public.res_lessons(club);
end;
$$;

-- ---------------------------------------------------------------------------
-- Updated from the court reservations migration
-- ---------------------------------------------------------------------------

-- New clubs' Private Lesson and Clinic types are lesson types.
/**
 * Creates a club with you as its owner, p_courts pickleball courts, the usual reservation
 * types and one scheduler with all the courts, 7 AM to 10 PM in 30-minute slots.
 */
create or replace function public.res_create_club(p_name text, p_slug text, p_timezone text, p_courts integer, p_address text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  club public.clubs;
  v_slug text := lower(btrim(p_slug));
  i integer;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Enter the club''s name (up to 80 characters).';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'The web address can use 3–40 lowercase letters, numbers and dashes.';
  end if;
  if exists (select 1 from public.clubs k where k.slug = v_slug) then
    raise exception 'That web address is taken. Try another.';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'Choose the club''s time zone.';
  end if;
  if coalesce(p_courts, 0) not between 1 and 60 then
    raise exception 'Enter between 1 and 60 courts.';
  end if;

  insert into public.clubs (name, slug, timezone, address, created_by)
  values (btrim(p_name), v_slug, p_timezone, nullif(btrim(coalesce(p_address, '')), ''), uid)
  returning * into club;

  insert into public.club_members (club_id, user_id, role) values (club.id, uid, 'owner');

  for i in 1..p_courts loop
    insert into public.club_courts (club_id, name, sort_order) values (club.id, 'Court ' || i, i);
  end loop;

  insert into public.reservation_types (club_id, name, color, min_players, max_players, members_can_book, sort_order, is_lesson) values
    (club.id, 'Doubles', '#0A8754', 1, 4, true, 1, false),
    (club.id, 'Singles', '#2F6BFF', 1, 2, true, 2, false),
    (club.id, 'Open Play', '#7CC24A', 1, 8, true, 3, false),
    (club.id, 'Private Lesson', '#F2711C', 1, 4, false, 4, true),
    (club.id, 'Clinic', '#6A4FC8', 0, 16, false, 5, true),
    (club.id, 'Maintenance', '#6B7780', 0, 1, false, 6, false);

  insert into public.club_schedulers (club_id, name, court_ids)
  values (club.id, 'All Courts', array(select c.id from public.club_courts c where c.club_id = club.id order by c.sort_order));

  return public.res_club_json(club);
end;
$$;

-- Instructors take attendance for their own lessons and clinic dates.
/**
 * Checks players in (or undoes it). Staff (and the reservation's instructor) check in anyone on a reservation (p_player null:
 * everyone); a player checks only themselves in, from the club's check-in window before the
 * start until it ends.
 */
create or replace function public.res_check_in(p_reservation uuid, p_player uuid default null, p_undo boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  r public.reservations;
  club public.clubs;
begin
  select * into r from public.reservations where id = p_reservation;
  if not found or r.status <> 'booked' then
    raise exception 'Reservation not found.';
  end if;
  select * into club from public.clubs where id = r.club_id;

  if public.res_is_staff(r.club_id) or public.res_teaches(r) then
    update public.reservation_players
    set checked_in_at = case when p_undo then null else coalesce(checked_in_at, now()) end,
        no_show = case when p_undo then no_show else false end
    where reservation_id = r.id and (p_player is null or id = p_player);
    if not p_undo then
      -- Checking in clears a no-show strike for this reservation.
      delete from public.booking_strikes s
      using public.reservation_players p
      where s.reservation_id = r.id and s.kind = 'no_show' and s.user_id = p.user_id
        and p.reservation_id = r.id and (p_player is null or p.id = p_player);
    end if;
  else
    if now() < r.starts_at - make_interval(mins => club.check_in_minutes_before) then
      raise exception 'Check-in opens % minutes before your reservation.', club.check_in_minutes_before;
    end if;
    if now() > r.ends_at then
      raise exception 'This reservation is already over.';
    end if;
    update public.reservation_players
    set checked_in_at = case when p_undo then null else coalesce(checked_in_at, now()) end, no_show = false
    where reservation_id = r.id and user_id = uid;
    if not found then
      raise exception 'You''re not on this reservation.';
    end if;
  end if;

  return public.res_reservation_json(r, true);
end;
$$;

/** Staff or the instructor: marks a player as a no-show once the reservation has started (a strike, with the club's fee), or undoes it. */
create or replace function public.res_mark_no_show(p_reservation uuid, p_player uuid, p_undo boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reservations;
  club public.clubs;
  player public.reservation_players;
begin
  select * into r from public.reservations where id = p_reservation;
  if not found or r.status <> 'booked' then
    raise exception 'Reservation not found.';
  end if;
  if not public.res_is_staff(r.club_id) and not public.res_teaches(r) then
    raise exception 'Only club staff and the instructor can do that.';
  end if;
  select * into club from public.clubs where id = r.club_id;
  select * into player from public.reservation_players where id = p_player and reservation_id = r.id;
  if not found then
    raise exception 'Player not found.';
  end if;
  if not p_undo and now() < r.starts_at then
    raise exception 'You can mark a no-show once the reservation has started.';
  end if;

  update public.reservation_players
  set no_show = not p_undo, checked_in_at = case when p_undo then checked_in_at else null end
  where id = p_player;

  if player.user_id is not null then
    if p_undo then
      delete from public.booking_strikes
      where reservation_id = r.id and user_id = player.user_id and kind = 'no_show';
    else
      insert into public.booking_strikes (club_id, user_id, reservation_id, kind, fee_cents)
      values (r.club_id, player.user_id, r.id, 'no_show', club.no_show_fee_cents)
      on conflict do nothing;
    end if;
  end if;

  return public.res_reservation_json(r, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_teaches(public.reservations), public.res_instructor_busy(uuid, timestamptz, timestamptz, uuid),
  public.res_instructor_available(uuid, timestamptz, integer), public.res_lesson_price(uuid, timestamptz, integer, integer),
  public.res_free_lesson_court(uuid, timestamptz, timestamptz), public.res_instructor_json(public.instructors, boolean),
  public.res_clinic_json(public.clinics, boolean), public.res_clinic_add_player(uuid, uuid), public.res_clinic_has_room(uuid),
  public.res_lessons(uuid), public.res_lesson_times(uuid, date, integer, integer), public.res_instructor_time_off(uuid, timestamptz, timestamptz),
  public.res_clinics(uuid), public.res_book_lesson(uuid, uuid, timestamptz, integer, text[], text[], text, text, uuid),
  public.res_set_paid(uuid, uuid, integer), public.res_create_clinic(uuid, jsonb), public.res_update_clinic(uuid, jsonb),
  public.res_cancel_clinic(uuid), public.res_register_clinic(uuid, uuid, text), public.res_unregister_clinic(uuid, uuid, uuid),
  public.res_clinic_roster(uuid), public.res_my_teaching(uuid, timestamptz, timestamptz), public.res_instructor_report(uuid, date, date),
  public.res_save_instructor(uuid, jsonb), public.res_delete_instructor(uuid), public.res_add_time_off(uuid, timestamptz, timestamptz, text),
  public.res_delete_time_off(uuid), public.res_save_instructor_type(uuid, jsonb), public.res_delete_instructor_type(uuid),
  public.res_save_rate(uuid, jsonb), public.res_delete_rate(uuid), public.res_set_lesson_type(uuid, boolean)
from public, anon;

-- Helpers stay internal.
revoke execute on function
  public.res_teaches(public.reservations), public.res_instructor_busy(uuid, timestamptz, timestamptz, uuid),
  public.res_instructor_available(uuid, timestamptz, integer), public.res_lesson_price(uuid, timestamptz, integer, integer),
  public.res_free_lesson_court(uuid, timestamptz, timestamptz), public.res_instructor_json(public.instructors, boolean),
  public.res_clinic_json(public.clinics, boolean), public.res_clinic_add_player(uuid, uuid), public.res_clinic_has_room(uuid)
from authenticated;

grant execute on function
  public.res_lessons(uuid), public.res_lesson_times(uuid, date, integer, integer), public.res_instructor_time_off(uuid, timestamptz, timestamptz),
  public.res_clinics(uuid), public.res_book_lesson(uuid, uuid, timestamptz, integer, text[], text[], text, text, uuid),
  public.res_set_paid(uuid, uuid, integer), public.res_create_clinic(uuid, jsonb), public.res_update_clinic(uuid, jsonb),
  public.res_cancel_clinic(uuid), public.res_register_clinic(uuid, uuid, text), public.res_unregister_clinic(uuid, uuid, uuid),
  public.res_clinic_roster(uuid), public.res_my_teaching(uuid, timestamptz, timestamptz), public.res_instructor_report(uuid, date, date),
  public.res_save_instructor(uuid, jsonb), public.res_delete_instructor(uuid), public.res_add_time_off(uuid, timestamptz, timestamptz, text),
  public.res_delete_time_off(uuid), public.res_save_instructor_type(uuid, jsonb), public.res_delete_instructor_type(uuid),
  public.res_save_rate(uuid, jsonb), public.res_delete_rate(uuid), public.res_set_lesson_type(uuid, boolean)
to authenticated;
