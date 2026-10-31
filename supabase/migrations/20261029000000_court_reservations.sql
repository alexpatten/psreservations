-- Court reservations for clubs: the database side of the Pickle Spots Reservations web app
-- (the psreservations repo).
--
-- A club (a facility that rents courts) has courts, reservation types (Singles, Doubles,
-- Private Lesson... each with a color), schedulers (which courts members can book, on which
-- days and hours, in what slot length), prime time windows with stricter limits, closures,
-- recurring series and the reservations themselves. Members book within the club's rules;
-- staff book anything that doesn't overlap another reservation or a closure, move
-- reservations around the scheduler, check players in and mark no-shows. Late
-- cancellations and no-shows are strikes, and too many strikes suspend booking for a while.
--
-- Combo courts: a court can be split into smaller ones (a tennis court into two pickleball
-- courts) by giving the halves a parent_id. Booking the whole court blocks its halves and
-- the other way around. Ball machines are courts of kind 'ball_machine', with their own rules.
--
-- Roles per club, in club_members: member < staff (runs the desk) < admin (changes settings)
-- < owner. Pickle Spots admins (admin_users) count as owners of every club.
--
-- Same security model as the rest of the schema: the tables have Row Level Security with no
-- policies, so they're read and changed only through the res_* functions below. Other players
-- still see only first name + last initial; a club's staff also see their members' full name
-- and email (the app says so when you join). The lobby board is readable without signing in
-- through its unguessable link.
--
-- Times are timestamptz and go to the app as epoch milliseconds, like the rest of the schema.
-- Hours, prime time and "per day" limits are in the club's own time zone.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  -- The club's address in the web app, e.g. /c/austin-pickle-ranch.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  timezone text not null default 'America/New_York',
  address text check (char_length(address) <= 200),
  -- The Pickle Spots court location this club is, if any.
  park_id text references public.parks (id) on delete set null,

  -- Booking rules for members (staff aren't held to them). A court can override the
  -- duration limits.
  min_minutes integer not null default 30 check (min_minutes between 15 and 720),
  max_minutes integer not null default 120 check (max_minutes between 15 and 1440),
  -- How far ahead members can book.
  advance_days integer not null default 7 check (advance_days between 0 and 365),
  -- Upcoming reservations a member may hold at once, and how many they may start on one day.
  max_upcoming integer not null default 3 check (max_upcoming between 1 and 100),
  max_per_day integer not null default 1 check (max_per_day between 1 and 50),

  -- Cancelling less than this long before the start is a late cancellation (0: never late).
  cancel_cutoff_hours integer not null default 24 check (cancel_cutoff_hours between 0 and 168),
  -- Fees recorded with each strike, for invoicing later.
  late_cancel_fee_cents integer not null default 0 check (late_cancel_fee_cents between 0 and 100000),
  no_show_fee_cents integer not null default 0 check (no_show_fee_cents between 0 and 100000),
  -- This many strikes within strike_window_days suspends booking for suspension_days after
  -- the latest one (0: strikes never suspend).
  strike_limit integer not null default 3 check (strike_limit between 0 and 20),
  strike_window_days integer not null default 30 check (strike_window_days between 1 and 365),
  suspension_days integer not null default 7 check (suspension_days between 1 and 365),
  -- Players can check themselves in from this long before the start.
  check_in_minutes_before integer not null default 30 check (check_in_minutes_before between 0 and 240),

  -- Extra questions on the booking form: [{id, label, type: text|number|checkbox|select,
  -- options: [..], required}].
  custom_fields jsonb not null default '[]' check (jsonb_typeof(custom_fields) = 'array'),

  -- The lobby board's link (/lobby/<token>); anyone with it can see today's schedule.
  lobby_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  lobby_show_names boolean not null default true,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (max_minutes >= min_minutes)
);

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'staff', 'admin', 'owner')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index club_members_user on public.club_members (user_id);

create table public.club_courts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null default 'court' check (kind in ('court', 'ball_machine')),
  sport text not null default 'pickleball' check (sport in ('pickleball', 'tennis', 'padel', 'other')),
  indoor boolean not null default false,
  -- Combo courts: this court is part of the parent court (one level only).
  parent_id uuid references public.club_courts (id) on delete set null,
  -- Override the club's duration limits for this court or ball machine.
  min_minutes integer check (min_minutes between 15 and 720),
  max_minutes integer check (max_minutes between 15 and 1440),
  members_can_book boolean not null default true,
  sort_order integer not null default 0,
  -- Courts with reservations are retired rather than deleted.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index club_courts_club on public.club_courts (club_id, sort_order);
create index club_courts_parent on public.club_courts (parent_id);

create table public.reservation_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#0A8754' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Players on the reservation, counting whoever booked it and guests.
  min_players integer not null default 1 check (min_players between 0 and 50),
  max_players integer not null default 4 check (max_players between 1 and 50),
  -- Staff-only types (lessons, clinics, maintenance) can't be booked by members.
  members_can_book boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  check (max_players >= min_players)
);

create index reservation_types_club on public.reservation_types (club_id, sort_order);

-- A view of some courts with its own days, hours and slot length. Members can book a court
-- at times that fit a scheduler it's in.
create table public.club_schedulers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  court_ids uuid[] not null default '{}',
  -- Days of the week, 0 = Sunday.
  days integer[] not null default '{0,1,2,3,4,5,6}' check (days <@ '{0,1,2,3,4,5,6}'),
  opens time not null default '07:00',
  -- '24:00' for midnight.
  closes time not null default '22:00',
  slot_minutes integer not null default 30 check (slot_minutes in (15, 30, 60)),
  members_can_book boolean not null default true,
  sort_order integer not null default 0,
  check (closes > opens)
);

create index club_schedulers_club on public.club_schedulers (club_id, sort_order);

-- Busy hours with stricter limits. Null limits fall back to the club's rules.
create table public.prime_times (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null default 'Prime Time' check (char_length(name) between 1 and 40),
  -- Empty: all courts.
  court_ids uuid[] not null default '{}',
  days integer[] not null default '{1,2,3,4,5}' check (days <@ '{0,1,2,3,4,5,6}'),
  starts time not null default '17:00',
  ends time not null default '20:00',
  max_minutes integer check (max_minutes between 15 and 1440),
  -- Prime time reservations a member may hold in one week (Monday to Sunday).
  max_per_week integer check (max_per_week between 1 and 50),
  advance_days integer check (advance_days between 0 and 365),
  check (ends > starts)
);

create index prime_times_club on public.prime_times (club_id);

create table public.closures (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- Empty: the whole club.
  court_ids uuid[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (char_length(reason) <= 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index closures_club on public.closures (club_id, ends_at);

-- A weekly repeating reservation, e.g. Tuesday and Thursday 6–8 PM through the season.
create table public.reservation_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  court_id uuid not null references public.club_courts (id) on delete cascade,
  type_id uuid not null references public.reservation_types (id),
  owner_id uuid references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 80),
  days integer[] not null check (days <@ '{0,1,2,3,4,5,6}' and cardinality(days) > 0),
  start_time time not null,
  minutes integer not null check (minutes between 15 and 1440),
  from_date date not null,
  until_date date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (until_date >= from_date)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  court_id uuid not null references public.club_courts (id) on delete cascade,
  type_id uuid not null references public.reservation_types (id),
  series_id uuid references public.reservation_series (id) on delete set null,
  -- Who booked it and answers for it; null for club events staff put on the schedule.
  owner_id uuid references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 80),
  notes text check (char_length(notes) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Overlaps a prime time window (counted toward its weekly limit).
  is_prime boolean not null default false,
  -- Answers to the club's custom fields.
  custom jsonb not null default '{}' check (jsonb_typeof(custom) = 'object'),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_reason text check (char_length(cancel_reason) <= 120),
  late_cancel boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index reservations_court on public.reservations (court_id, starts_at) where status = 'booked';
create index reservations_club on public.reservations (club_id, starts_at);
create index reservations_owner on public.reservations (owner_id, starts_at) where status = 'booked';
create index reservations_series on public.reservations (series_id);

create table public.reservation_players (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  guest_name text check (char_length(guest_name) between 1 and 40),
  position integer not null default 0,
  checked_in_at timestamptz,
  no_show boolean not null default false,
  check ((user_id is null) <> (guest_name is null)),
  unique (reservation_id, user_id)
);

create index reservation_players_user on public.reservation_players (user_id);

-- Late cancellations and no-shows.
create table public.booking_strikes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete set null,
  kind text not null check (kind in ('late_cancel', 'no_show')),
  fee_cents integer not null default 0,
  created_at timestamptz not null default now(),
  waived_at timestamptz,
  waived_by uuid references auth.users (id) on delete set null,
  unique (reservation_id, user_id, kind)
);

create index booking_strikes_user on public.booking_strikes (club_id, user_id, created_at);

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_courts enable row level security;
alter table public.reservation_types enable row level security;
alter table public.club_schedulers enable row level security;
alter table public.prime_times enable row level security;
alter table public.closures enable row level security;
alter table public.reservation_series enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_players enable row level security;
alter table public.booking_strikes enable row level security;

revoke all on
  public.clubs, public.club_members, public.club_courts, public.reservation_types,
  public.club_schedulers, public.prime_times, public.closures, public.reservation_series,
  public.reservations, public.reservation_players, public.booking_strikes
from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Your role at a club: member, staff, admin or owner (Pickle Spots admins are owners), or null. */
create function public.res_role(p_club uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then 'owner'
    else (select m.role from public.club_members m where m.club_id = p_club and m.user_id = (select auth.uid()))
  end
$$;

create function public.res_is_staff(p_club uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.res_role(p_club) in ('staff', 'admin', 'owner'), false) $$;

create function public.res_is_manager(p_club uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.res_role(p_club) in ('admin', 'owner'), false) $$;

/** Minutes since local midnight. */
create function public.res_minutes(t timestamp)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$ select (extract(hour from t) * 60 + extract(minute from t))::integer $$;

/** Minutes since midnight for a time of day ('24:00' is 1440). */
create function public.res_time_minutes(t time)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$ select (extract(epoch from t) / 60)::integer $$;

/** The court, the court it's part of, and the courts that are part of it: booking one blocks the others. */
create function public.res_linked_courts(p_court uuid)
returns uuid[]
language sql stable
set search_path = ''
as $$
  select array(
    select p_court
    union select c.parent_id from public.club_courts c where c.id = p_court and c.parent_id is not null
    union select c.id from public.club_courts c where c.parent_id = p_court
  )
$$;

/** Why a court can't be used then (a closure or another reservation), or null when it's free. */
create function public.res_conflict(p_court uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_except uuid default null)
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
      where r.court_id = any(court.linked) and r.status = 'booked'
        and r.id is distinct from p_except
        and r.starts_at < p_ends_at and r.ends_at > p_starts_at
      limit 1
    )
  )
$$;

/** Whether a reservation on this court at this time overlaps any of the club's prime time windows. */
create function public.res_is_prime(p_court uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_courts c
    join public.clubs k on k.id = c.club_id
    join public.prime_times p on p.club_id = c.club_id
    cross join lateral (select p_starts_at at time zone k.timezone as local_start) l
    where c.id = p_court
      and (cardinality(p.court_ids) = 0 or p.court_ids && public.res_linked_courts(c.id))
      and extract(dow from l.local_start)::integer = any(p.days)
      and public.res_minutes(l.local_start) < public.res_time_minutes(p.ends)
      and public.res_minutes(l.local_start) + extract(epoch from p_ends_at - p_starts_at) / 60 > public.res_time_minutes(p.starts)
  )
$$;

/** Until when a player can't book at a club because of strikes, or null. */
create function public.res_suspended_until(p_club uuid, p_user uuid)
returns timestamptz
language sql stable
set search_path = ''
as $$
  select case when k.strike_limit > 0 and count(s.id) >= k.strike_limit
              and max(s.created_at) + make_interval(days => k.suspension_days) > now()
         then max(s.created_at) + make_interval(days => k.suspension_days) end
  from public.clubs k
  left join public.booking_strikes s
    on s.club_id = k.id and s.user_id = p_user and s.waived_at is null
   and s.created_at > now() - make_interval(days => k.strike_window_days)
  where k.id = p_club
  group by k.id
$$;

/** "Jamie R." for a member, or the guest's name. */
create function public.res_player_name(p_user uuid, p_guest text)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce((select public.display_name(u.first_name, u.last_name) from public.profiles u where u.id = p_user), p_guest)
$$;

/**
 * A reservation for the app. p_detail (staff, or someone on it) adds notes, answers to custom
 * fields and player IDs; without it the players are just names.
 */
create function public.res_reservation_json(r public.reservations, p_detail boolean)
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

/** Whether you're on a reservation (booked it or play in it). */
create function public.res_on_reservation(r public.reservations)
returns boolean
language sql stable
set search_path = ''
as $$
  select r.owner_id = (select auth.uid())
    or exists (select 1 from public.reservation_players p where p.reservation_id = r.id and p.user_id = (select auth.uid()))
$$;

/** The club's settings, courts, types, schedulers and prime times, plus where you stand there. */
create function public.res_club_json(k public.clubs)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', k.id,
    'name', k.name,
    'slug', k.slug,
    'timezone', k.timezone,
    'address', k.address,
    'parkId', k.park_id,
    'rules', jsonb_build_object(
      'minMinutes', k.min_minutes, 'maxMinutes', k.max_minutes, 'advanceDays', k.advance_days,
      'maxUpcoming', k.max_upcoming, 'maxPerDay', k.max_per_day,
      'cancelCutoffHours', k.cancel_cutoff_hours,
      'lateCancelFeeCents', k.late_cancel_fee_cents, 'noShowFeeCents', k.no_show_fee_cents,
      'strikeLimit', k.strike_limit, 'strikeWindowDays', k.strike_window_days,
      'suspensionDays', k.suspension_days, 'checkInMinutesBefore', k.check_in_minutes_before
    ),
    'customFields', k.custom_fields,
    'lobbyShowNames', k.lobby_show_names,
    'lobbyToken', case when public.res_is_staff(k.id) then k.lobby_token end,
    'myRole', public.res_role(k.id),
    'suspendedUntil', public.epoch_ms(public.res_suspended_until(k.id, (select auth.uid()))),
    'memberCount', (select count(*) from public.club_members m where m.club_id = k.id),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'kind', c.kind, 'sport', c.sport, 'indoor', c.indoor,
        'parentId', c.parent_id, 'minMinutes', c.min_minutes, 'maxMinutes', c.max_minutes,
        'membersCanBook', c.members_can_book, 'sortOrder', c.sort_order
      ) order by c.sort_order, c.name)
      from public.club_courts c where c.club_id = k.id and c.active
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'color', t.color, 'minPlayers', t.min_players,
        'maxPlayers', t.max_players, 'membersCanBook', t.members_can_book, 'sortOrder', t.sort_order
      ) order by t.sort_order, t.name)
      from public.reservation_types t where t.club_id = k.id and t.active
    ), '[]'::jsonb),
    'schedulers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'courtIds', to_jsonb(s.court_ids), 'days', to_jsonb(s.days),
        'opens', to_char(s.opens, 'HH24:MI'), 'closes', to_char(s.closes, 'HH24:MI'),
        'slotMinutes', s.slot_minutes, 'membersCanBook', s.members_can_book, 'sortOrder', s.sort_order
      ) order by s.sort_order, s.name)
      from public.club_schedulers s where s.club_id = k.id
    ), '[]'::jsonb),
    'primeTimes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'courtIds', to_jsonb(p.court_ids), 'days', to_jsonb(p.days),
        'starts', to_char(p.starts, 'HH24:MI'), 'ends', to_char(p.ends, 'HH24:MI'),
        'maxMinutes', p.max_minutes, 'maxPerWeek', p.max_per_week, 'advanceDays', p.advance_days
      ) order by p.starts)
      from public.prime_times p where p.club_id = k.id
    ), '[]'::jsonb)
  )
$$;

create function public.res_require_user()
returns uuid
language plpgsql stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Please sign in again.';
  end if;
  return (select auth.uid());
end;
$$;

create function public.res_require_staff(p_club uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_user();
  if not public.res_is_staff(p_club) then
    raise exception 'Only club staff can do that.';
  end if;
end;
$$;

create function public.res_require_manager(p_club uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_user();
  if not public.res_is_manager(p_club) then
    raise exception 'Only club admins can change club settings.';
  end if;
end;
$$;

/** Keeps only ids of the club's own courts. */
create function public.res_club_court_ids(p_club uuid, p_ids uuid[])
returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array(select c.id from public.club_courts c where c.club_id = p_club and c.id = any(coalesce(p_ids, '{}'))), '{}')
$$;

/** Days of the week from a JSON array, e.g. [1,2,3]. */
create function public.res_days(p jsonb)
returns integer[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array(select distinct d::integer from jsonb_array_elements_text(coalesce(p, '[]')) d order by 1), '{}')
$$;

create function public.res_uuids(p jsonb)
returns uuid[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array(select d::uuid from jsonb_array_elements_text(coalesce(p, '[]')) d), '{}')
$$;

-- ---------------------------------------------------------------------------
-- Clubs: finding, creating, joining
-- ---------------------------------------------------------------------------

/** Clubs you belong to, alphabetically. */
create function public.res_my_clubs()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'name', k.name, 'slug', k.slug, 'address', k.address, 'role', m.role
  ) order by k.name), '[]'::jsonb)
  from public.club_members m
  join public.clubs k on k.id = m.club_id
  where m.user_id = (select auth.uid())
$$;

/** Clubs whose name or address contains the search, up to 30. */
create function public.res_find_clubs(p_query text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.name), '[]'::jsonb)
  from (
    select k.name, jsonb_build_object(
      'id', k.id, 'name', k.name, 'slug', k.slug, 'address', k.address,
      'role', (select m.role from public.club_members m where m.club_id = k.id and m.user_id = (select auth.uid()))
    ) as item
    from public.clubs k
    where btrim(coalesce(p_query, '')) = ''
       or k.name ilike '%' || btrim(p_query) || '%'
       or k.address ilike '%' || btrim(p_query) || '%'
    order by k.name
    limit 30
  ) x
$$;

/** A club by its slug (or id), with everything the scheduler needs. */
create function public.res_club(p_slug text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select public.res_club_json(k)
  from public.clubs k
  where k.slug = lower(p_slug) or k.id::text = p_slug
$$;

/**
 * Creates a club with you as its owner, p_courts pickleball courts, the usual reservation
 * types and one scheduler with all the courts, 7 AM to 10 PM in 30-minute slots.
 */
create function public.res_create_club(p_name text, p_slug text, p_timezone text, p_courts integer, p_address text default null)
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

  insert into public.reservation_types (club_id, name, color, min_players, max_players, members_can_book, sort_order) values
    (club.id, 'Doubles', '#0A8754', 1, 4, true, 1),
    (club.id, 'Singles', '#2F6BFF', 1, 2, true, 2),
    (club.id, 'Open Play', '#7CC24A', 1, 8, true, 3),
    (club.id, 'Private Lesson', '#F2711C', 1, 4, false, 4),
    (club.id, 'Clinic', '#6A4FC8', 0, 16, false, 5),
    (club.id, 'Maintenance', '#6B7780', 0, 1, false, 6);

  insert into public.club_schedulers (club_id, name, court_ids)
  values (club.id, 'All Courts', array(select c.id from public.club_courts c where c.club_id = club.id order by c.sort_order));

  return public.res_club_json(club);
end;
$$;

create function public.res_join_club(p_club uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
begin
  if not exists (select 1 from public.clubs where id = p_club) then
    raise exception 'Club not found.';
  end if;
  insert into public.club_members (club_id, user_id) values (p_club, uid) on conflict do nothing;
  return (select public.res_club_json(k) from public.clubs k where k.id = p_club);
end;
$$;

/** Leaves a club and cancels your upcoming reservations there (without penalty). Owners can't leave. */
create function public.res_leave_club(p_club uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
begin
  if exists (select 1 from public.club_members where club_id = p_club and user_id = uid and role = 'owner') then
    raise exception 'Owners can''t leave their club. Make someone else the owner first.';
  end if;
  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = uid, cancel_reason = 'Left the club'
  where club_id = p_club and owner_id = uid and status = 'booked' and starts_at > now();
  delete from public.reservation_players p
  using public.reservations r
  where p.reservation_id = r.id and r.club_id = p_club and p.user_id = uid and r.starts_at > now();
  delete from public.club_members where club_id = p_club and user_id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

/**
 * Reservations (booked ones; staff also get cancelled ones) and closures between two moments,
 * up to 8 days. Members see who's playing; others see only that a court is taken.
 */
create function public.res_schedule(p_club uuid, p_from timestamptz, p_to timestamptz)
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
        and (r.status = 'booked' or (staff and r.status = 'cancelled'))
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

/** Your reservations that haven't ended (at one club, or all), soonest first. */
create function public.res_my_reservations(p_club uuid default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    public.res_reservation_json(r, true) || jsonb_build_object(
      'clubName', k.name, 'clubSlug', k.slug, 'timezone', k.timezone, 'courtName', c.name,
      'typeName', t.name, 'color', t.color,
      'cancelCutoffHours', k.cancel_cutoff_hours, 'checkInMinutesBefore', k.check_in_minutes_before
    ) order by r.starts_at), '[]'::jsonb)
  from public.reservations r
  join public.clubs k on k.id = r.club_id
  join public.club_courts c on c.id = r.court_id
  join public.reservation_types t on t.id = r.type_id
  where r.status = 'booked' and r.ends_at > now()
    and (p_club is null or r.club_id = p_club)
    and public.res_on_reservation(r)
$$;

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------

/**
 * Books a court. Members book for themselves within the club's rules. Staff can book for a
 * member (p_owner_code, their player ID, which also adds them to the club) or for no one
 * (p_no_owner, e.g. a clinic), and aren't held to the rules; nobody can book over another
 * reservation or a closure. Other players come from their player IDs, guests by name.
 */
create function public.res_book(
  p_court uuid,
  p_type uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_player_codes text[] default '{}',
  p_guests text[] default '{}',
  p_title text default null,
  p_notes text default null,
  p_custom jsonb default '{}',
  p_owner_code text default null,
  p_no_owner boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  court public.club_courts;
  club public.clubs;
  rtype public.reservation_types;
  staff boolean;
  owner uuid;
  players uuid[];
  guests text[];
  minutes integer;
  local_start timestamp;
  start_min integer;
  total integer;
  conflict text;
  custom jsonb;
  missing text;
  prime record;
  r public.reservations;
  i integer;
begin
  select * into court from public.club_courts where id = p_court and active;
  if not found then
    raise exception 'Court not found.';
  end if;
  select * into club from public.clubs where id = court.club_id;
  staff := public.res_is_staff(club.id);
  if not staff and public.res_role(club.id) is null then
    raise exception 'Join % to book courts.', club.name;
  end if;

  select * into rtype from public.reservation_types where id = p_type and club_id = club.id and active;
  if not found then
    raise exception 'Choose a reservation type.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '24 hours' then
    raise exception 'Choose a start and end time.';
  end if;

  -- One booking at a time per club, so two people can't take the same court at once.
  perform pg_advisory_xact_lock(hashtextextended(club.id::text, 0));

  -- Who it's for.
  if staff and p_no_owner then
    owner := null;
  elsif staff and nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    select id into owner from public.profiles where player_code = upper(btrim(p_owner_code));
    if owner is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
    insert into public.club_members (club_id, user_id) values (club.id, owner) on conflict do nothing;
  else
    owner := uid;
  end if;

  -- Other players and guests.
  select coalesce(array_agg(distinct u.id), '{}') into players
  from unnest(coalesce(p_player_codes, '{}')) code
  join public.profiles u on u.player_code = upper(btrim(code))
  where u.id is distinct from owner;
  if (select count(distinct upper(btrim(code))) from unnest(coalesce(p_player_codes, '{}')) code where btrim(code) <> '')
     > cardinality(players) + (case when owner is not null and exists (
       select 1 from unnest(coalesce(p_player_codes, '{}')) code join public.profiles u on u.player_code = upper(btrim(code)) where u.id = owner
     ) then 1 else 0 end) then
    raise exception 'One of those player IDs doesn''t match a player. Check it and try again.';
  end if;
  select coalesce(array_agg(left(btrim(g), 40)), '{}') into guests
  from unnest(coalesce(p_guests, '{}')) g where btrim(g) <> '';
  total := (owner is not null)::integer + cardinality(players) + cardinality(guests);

  -- Answers to the club's custom fields: only its own fields, and the required ones filled in.
  select coalesce(jsonb_object_agg(f ->> 'id', p_custom -> (f ->> 'id')), '{}') into custom
  from jsonb_array_elements(club.custom_fields) f
  where coalesce(p_custom, '{}') ? (f ->> 'id');

  minutes := (extract(epoch from p_ends_at - p_starts_at) / 60)::integer;
  local_start := p_starts_at at time zone club.timezone;
  start_min := public.res_minutes(local_start);

  if not staff then
    if public.res_suspended_until(club.id, uid) is not null then
      raise exception 'Booking at % is paused until % because of late cancellations or no-shows.',
        club.name, to_char(public.res_suspended_until(club.id, uid) at time zone club.timezone, 'Mon FMDD');
    end if;
    if not court.members_can_book then
      raise exception '% can only be booked by staff.', court.name;
    end if;
    if not rtype.members_can_book then
      raise exception '% reservations can only be made by staff.', rtype.name;
    end if;
    if p_starts_at < now() - interval '30 minutes' then
      raise exception 'That time has already passed.';
    end if;
    if p_starts_at > now() + make_interval(days => club.advance_days) then
      raise exception 'You can book up to % days ahead.', club.advance_days;
    end if;
    if minutes < coalesce(court.min_minutes, club.min_minutes) then
      raise exception 'Reservations on % are at least % minutes.', court.name, coalesce(court.min_minutes, club.min_minutes);
    end if;
    if minutes > coalesce(court.max_minutes, club.max_minutes) then
      raise exception 'Reservations on % are at most % minutes.', court.name, coalesce(court.max_minutes, club.max_minutes);
    end if;
    if not exists (
      select 1 from public.club_schedulers s
      where s.club_id = club.id and s.members_can_book and court.id = any(s.court_ids)
        and extract(dow from local_start)::integer = any(s.days)
        and start_min >= public.res_time_minutes(s.opens)
        and start_min + minutes <= public.res_time_minutes(s.closes)
        and (start_min - public.res_time_minutes(s.opens)) % s.slot_minutes = 0
        and minutes % s.slot_minutes = 0
    ) then
      raise exception '% isn''t open for booking at that time.', court.name;
    end if;
    if total < rtype.min_players then
      raise exception '% needs at least % players.', rtype.name, rtype.min_players;
    end if;
    if total > rtype.max_players then
      raise exception '% allows up to % players.', rtype.name, rtype.max_players;
    end if;
    if (select count(*) from public.reservations x
        where x.club_id = club.id and x.owner_id = uid and x.status = 'booked' and x.ends_at > now()) >= club.max_upcoming then
      raise exception 'You can hold % upcoming reservations at % at a time.', club.max_upcoming, club.name;
    end if;
    if (select count(*) from public.reservations x
        where x.club_id = club.id and x.owner_id = uid and x.status = 'booked'
          and (x.starts_at at time zone club.timezone)::date = local_start::date) >= club.max_per_day then
      raise exception 'You can book % reservation(s) a day at %.', club.max_per_day, club.name;
    end if;

    -- Prime time limits.
    for prime in
      select p.* from public.prime_times p
      where p.club_id = club.id
        and (cardinality(p.court_ids) = 0 or p.court_ids && public.res_linked_courts(court.id))
        and extract(dow from local_start)::integer = any(p.days)
        and start_min < public.res_time_minutes(p.ends)
        and start_min + minutes > public.res_time_minutes(p.starts)
    loop
      if prime.max_minutes is not null and minutes > prime.max_minutes then
        raise exception 'During % (% – %) reservations are at most % minutes.',
          prime.name, to_char(prime.starts, 'FMHH12:MI AM'), to_char(prime.ends, 'FMHH12:MI AM'), prime.max_minutes;
      end if;
      if prime.advance_days is not null and p_starts_at > now() + make_interval(days => prime.advance_days) then
        raise exception '% can be booked up to % days ahead.', prime.name, prime.advance_days;
      end if;
      if prime.max_per_week is not null and (
        select count(*) from public.reservations x
        where x.club_id = club.id and x.owner_id = uid and x.status = 'booked' and x.is_prime
          and date_trunc('week', x.starts_at at time zone club.timezone) = date_trunc('week', local_start)
      ) >= prime.max_per_week then
        raise exception 'You can book % prime time reservation(s) a week.', prime.max_per_week;
      end if;
    end loop;

    select string_agg(f ->> 'label', ', ') into missing
    from jsonb_array_elements(club.custom_fields) f
    where coalesce((f ->> 'required')::boolean, false)
      and (custom -> (f ->> 'id') is null
           or btrim(custom ->> (f ->> 'id')) = ''
           or (f ->> 'type' = 'checkbox' and custom ->> (f ->> 'id') <> 'true'));
    if missing is not null then
      raise exception 'Please fill in: %.', missing;
    end if;
  end if;

  conflict := public.res_conflict(court.id, p_starts_at, p_ends_at);
  if conflict is not null then
    raise exception '%', conflict;
  end if;

  insert into public.reservations (
    club_id, court_id, type_id, owner_id, title, notes, starts_at, ends_at, is_prime, custom, created_by
  ) values (
    club.id, court.id, rtype.id, owner, nullif(left(btrim(coalesce(p_title, '')), 80), ''),
    nullif(left(btrim(coalesce(p_notes, '')), 500), ''), p_starts_at, p_ends_at,
    public.res_is_prime(court.id, p_starts_at, p_ends_at), custom, uid
  ) returning * into r;

  if owner is not null then
    insert into public.reservation_players (reservation_id, user_id, position) values (r.id, owner, 0);
  end if;
  insert into public.reservation_players (reservation_id, user_id, position)
  select r.id, p, 1 from unnest(players) p;
  for i in 1..cardinality(guests) loop
    insert into public.reservation_players (reservation_id, guest_name, position) values (r.id, guests[i], 2 + i);
  end loop;

  return public.res_reservation_json(r, true);
end;
$$;

/**
 * Cancels a reservation. Its owner can cancel until it ends; cancelling within the club's
 * cutoff is a late cancellation, which is a strike (with the club's fee). Staff cancel
 * without penalty.
 */
create function public.res_cancel(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  r public.reservations;
  club public.clubs;
  staff boolean;
  late boolean;
begin
  select * into r from public.reservations where id = p_id for update;
  if not found then
    raise exception 'Reservation not found.';
  end if;
  select * into club from public.clubs where id = r.club_id;
  staff := public.res_is_staff(r.club_id);
  if not staff and r.owner_id is distinct from uid then
    raise exception 'Only the person who booked this reservation can cancel it.';
  end if;
  if r.status = 'cancelled' then
    raise exception 'This reservation is already cancelled.';
  end if;
  if not staff and r.ends_at <= now() then
    raise exception 'This reservation is already over.';
  end if;

  late := not staff and club.cancel_cutoff_hours > 0
    and r.starts_at - now() < make_interval(hours => club.cancel_cutoff_hours);

  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = uid,
      cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 120), ''), late_cancel = late
  where id = p_id
  returning * into r;

  if late then
    insert into public.booking_strikes (club_id, user_id, reservation_id, kind, fee_cents)
    values (r.club_id, uid, r.id, 'late_cancel', club.late_cancel_fee_cents)
    on conflict do nothing;
  end if;

  return public.res_reservation_json(r, true);
end;
$$;

/** Takes you off a reservation someone else booked. */
create function public.res_leave_reservation(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
begin
  if exists (select 1 from public.reservations where id = p_id and owner_id = uid) then
    raise exception 'You booked this reservation. Cancel it instead.';
  end if;
  delete from public.reservation_players where reservation_id = p_id and user_id = uid;
end;
$$;

/**
 * Changes a reservation's details: staff can change everything, its owner the players,
 * title and notes. Players come as player IDs and guests by name, replacing the list;
 * players who stay keep their check-in.
 */
create function public.res_edit(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  r public.reservations;
  club public.clubs;
  rtype public.reservation_types;
  staff boolean;
  players uuid[];
  guests text[];
  i integer;
begin
  select * into r from public.reservations where id = p_id for update;
  if not found or r.status <> 'booked' then
    raise exception 'Reservation not found.';
  end if;
  select * into club from public.clubs where id = r.club_id;
  staff := public.res_is_staff(r.club_id);
  if not staff and r.owner_id is distinct from uid then
    raise exception 'Only the person who booked this reservation can change it.';
  end if;

  if staff and p ? 'typeId' then
    select * into rtype from public.reservation_types where id = (p ->> 'typeId')::uuid and club_id = r.club_id and active;
    if not found then
      raise exception 'Choose a reservation type.';
    end if;
    r.type_id := rtype.id;
  end if;
  select * into rtype from public.reservation_types where id = r.type_id;

  update public.reservations set
    type_id = r.type_id,
    title = case when p ? 'title' then nullif(left(btrim(coalesce(p ->> 'title', '')), 80), '') else title end,
    notes = case when p ? 'notes' then nullif(left(btrim(coalesce(p ->> 'notes', '')), 500), '') else notes end,
    custom = case when p ? 'custom' then coalesce((
      select jsonb_object_agg(f ->> 'id', (p -> 'custom') -> (f ->> 'id'))
      from jsonb_array_elements(club.custom_fields) f where (p -> 'custom') ? (f ->> 'id')
    ), '{}') else custom end
  where id = p_id
  returning * into r;

  if p ? 'playerCodes' or p ? 'guests' then
    select coalesce(array_agg(distinct u.id), '{}') into players
    from jsonb_array_elements_text(coalesce(p -> 'playerCodes', '[]')) code
    join public.profiles u on u.player_code = upper(btrim(code))
    where u.id is distinct from r.owner_id;
    if (select count(distinct upper(btrim(code))) from jsonb_array_elements_text(coalesce(p -> 'playerCodes', '[]')) code
        where btrim(code) <> '' and upper(btrim(code)) is distinct from (select player_code from public.profiles where id = r.owner_id))
       > cardinality(players) then
      raise exception 'One of those player IDs doesn''t match a player. Check it and try again.';
    end if;
    select coalesce(array_agg(left(btrim(g), 40)), '{}') into guests
    from jsonb_array_elements_text(coalesce(p -> 'guests', '[]')) g where btrim(g) <> '';

    if not staff and (r.owner_id is not null)::integer + cardinality(players) + cardinality(guests) > rtype.max_players then
      raise exception '% allows up to % players.', rtype.name, rtype.max_players;
    end if;

    delete from public.reservation_players
    where reservation_id = r.id and user_id is not null and user_id is distinct from r.owner_id and not (user_id = any(players));
    insert into public.reservation_players (reservation_id, user_id, position)
    select r.id, x, 1 from unnest(players) x on conflict (reservation_id, user_id) do nothing;
    delete from public.reservation_players where reservation_id = r.id and guest_name is not null and not (guest_name = any(guests));
    for i in 1..cardinality(guests) loop
      if not exists (select 1 from public.reservation_players where reservation_id = r.id and guest_name = guests[i]) then
        insert into public.reservation_players (reservation_id, guest_name, position) values (r.id, guests[i], 2 + i);
      end if;
    end loop;
  end if;

  return public.res_reservation_json(r, true);
end;
$$;

/** Staff: moves a reservation to another court or time (drag and drop on the scheduler). */
create function public.res_move(p_id uuid, p_court uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reservations;
  conflict text;
begin
  select * into r from public.reservations where id = p_id for update;
  if not found or r.status <> 'booked' then
    raise exception 'Reservation not found.';
  end if;
  perform public.res_require_staff(r.club_id);
  if not exists (select 1 from public.club_courts where id = p_court and club_id = r.club_id and active) then
    raise exception 'Court not found.';
  end if;
  if p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '24 hours' then
    raise exception 'Choose a start and end time.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(r.club_id::text, 0));
  conflict := public.res_conflict(p_court, p_starts_at, p_ends_at, r.id);
  if conflict is not null then
    raise exception '%', conflict;
  end if;
  update public.reservations
  set court_id = p_court, starts_at = p_starts_at, ends_at = p_ends_at,
      is_prime = public.res_is_prime(p_court, p_starts_at, p_ends_at)
  where id = p_id
  returning * into r;
  return public.res_reservation_json(r, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in, no-shows and strikes
-- ---------------------------------------------------------------------------

/**
 * Checks players in (or undoes it). Staff check in anyone on a reservation (p_player null:
 * everyone); a player checks only themselves in, from the club's check-in window before the
 * start until it ends.
 */
create function public.res_check_in(p_reservation uuid, p_player uuid default null, p_undo boolean default false)
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

  if public.res_is_staff(r.club_id) then
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

/** Staff: marks a player as a no-show once the reservation has started (a strike, with the club's fee), or undoes it. */
create function public.res_mark_no_show(p_reservation uuid, p_player uuid, p_undo boolean default false)
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
  perform public.res_require_staff(r.club_id);
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

/** Strikes at a club: a player's own, or (staff) anyone's when p_user is given, or the club's recent ones. Newest first, up to 200. */
create function public.res_strikes(p_club uuid, p_user uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  who uuid := coalesce(p_user, uid);
  everyone boolean := false;
begin
  if p_user is distinct from uid and p_user is not null then
    perform public.res_require_staff(p_club);
  end if;
  if p_user is null and public.res_is_staff(p_club) then
    everyone := true;
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.created_at desc)
    from (
      select s.created_at, jsonb_build_object(
        'id', s.id, 'userId', s.user_id, 'name', public.res_player_name(s.user_id, null),
        'kind', s.kind, 'feeCents', s.fee_cents, 'createdAt', public.epoch_ms(s.created_at),
        'waivedAt', public.epoch_ms(s.waived_at), 'reservationId', s.reservation_id,
        'reservationStartsAt', public.epoch_ms(r.starts_at), 'courtName', c.name
      ) as item
      from public.booking_strikes s
      left join public.reservations r on r.id = s.reservation_id
      left join public.club_courts c on c.id = r.court_id
      where s.club_id = p_club and (everyone or s.user_id = who)
      order by s.created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

/** Staff: waives a strike (or restores it). Waived strikes don't count toward a suspension. */
create function public.res_waive_strike(p_id uuid, p_undo boolean default false)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.booking_strikes where id = p_id;
  if club is null then
    raise exception 'Strike not found.';
  end if;
  perform public.res_require_staff(club);
  update public.booking_strikes
  set waived_at = case when p_undo then null else now() end,
      waived_by = case when p_undo then null else (select auth.uid()) end
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recurring reservations
-- ---------------------------------------------------------------------------

/**
 * Staff: books a court every week on the chosen days, from one date through another (up to a
 * year, 300 reservations). Dates already taken or closed are skipped and listed.
 */
create function public.res_create_series(
  p_court uuid, p_type uuid, p_days integer[], p_start_time time, p_minutes integer,
  p_from date, p_until date, p_title text default null, p_owner_code text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  court public.club_courts;
  club public.clubs;
  owner uuid;
  series public.reservation_series;
  d date;
  s timestamptz;
  e timestamptz;
  conflict text;
  created integer := 0;
  skipped jsonb := '[]';
  r public.reservations;
begin
  select * into court from public.club_courts where id = p_court and active;
  if not found then
    raise exception 'Court not found.';
  end if;
  perform public.res_require_staff(court.club_id);
  select * into club from public.clubs where id = court.club_id;
  if not exists (select 1 from public.reservation_types where id = p_type and club_id = club.id and active) then
    raise exception 'Choose a reservation type.';
  end if;
  if coalesce(cardinality(p_days), 0) = 0 or not (p_days <@ '{0,1,2,3,4,5,6}') then
    raise exception 'Choose the days of the week.';
  end if;
  if p_minutes is null or p_minutes not between 15 and 1440 then
    raise exception 'Choose how long each reservation is.';
  end if;
  if p_from is null or p_until is null or p_until < p_from then
    raise exception 'Choose when the series starts and ends.';
  end if;
  if p_until > p_from + 366 then
    raise exception 'A series can run for up to a year.';
  end if;

  if nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    select id into owner from public.profiles where player_code = upper(btrim(p_owner_code));
    if owner is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
    insert into public.club_members (club_id, user_id) values (club.id, owner) on conflict do nothing;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(club.id::text, 0));

  insert into public.reservation_series (club_id, court_id, type_id, owner_id, title, days, start_time, minutes, from_date, until_date, created_by)
  values (club.id, court.id, p_type, owner, nullif(left(btrim(coalesce(p_title, '')), 80), ''),
          p_days, p_start_time, p_minutes, p_from, p_until, uid)
  returning * into series;

  d := p_from;
  while d <= p_until and created < 300 loop
    if extract(dow from d)::integer = any(p_days) then
      s := (d + p_start_time) at time zone club.timezone;
      e := s + make_interval(mins => p_minutes);
      if s > now() then
        conflict := public.res_conflict(court.id, s, e);
        if conflict is null then
          insert into public.reservations (club_id, court_id, type_id, series_id, owner_id, title, starts_at, ends_at, is_prime, created_by)
          values (club.id, court.id, p_type, series.id, owner, series.title, s, e, public.res_is_prime(court.id, s, e), uid)
          returning * into r;
          if owner is not null then
            insert into public.reservation_players (reservation_id, user_id) values (r.id, owner);
          end if;
          created := created + 1;
        else
          skipped := skipped || jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'reason', conflict);
        end if;
      end if;
    end if;
    d := d + 1;
  end loop;

  return jsonb_build_object('seriesId', series.id, 'created', created, 'skipped', skipped);
end;
$$;

/** Staff: cancels the reservations in a series from a moment on (default: all upcoming ones). Returns how many. */
create function public.res_cancel_series(p_series uuid, p_from timestamptz default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
  n integer;
begin
  select club_id into club from public.reservation_series where id = p_series;
  if club is null then
    raise exception 'Series not found.';
  end if;
  perform public.res_require_staff(club);
  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Series cancelled'
  where series_id = p_series and status = 'booked' and starts_at >= greatest(coalesce(p_from, now()), now());
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Closures
-- ---------------------------------------------------------------------------

/**
 * Staff: closes courts (none listed: the whole club) for a while, e.g. for weather. With
 * p_cancel, reservations in that time are cancelled without penalty. Returns how many.
 */
create function public.res_create_closure(
  p_club uuid, p_court_ids uuid[], p_starts_at timestamptz, p_ends_at timestamptz,
  p_reason text default null, p_cancel boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ids uuid[];
  closure public.closures;
  n integer := 0;
begin
  perform public.res_require_staff(p_club);
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Choose when the closure starts and ends.';
  end if;
  if p_ends_at - p_starts_at > interval '366 days' then
    raise exception 'A closure can last up to a year.';
  end if;
  ids := public.res_club_court_ids(p_club, p_court_ids);
  insert into public.closures (club_id, court_ids, starts_at, ends_at, reason, created_by)
  values (p_club, ids, p_starts_at, p_ends_at, nullif(left(btrim(coalesce(p_reason, '')), 120), ''), (select auth.uid()))
  returning * into closure;

  if p_cancel then
    update public.reservations r
    set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()),
        cancel_reason = left('Closed' || coalesce(': ' || closure.reason, ''), 120)
    where r.club_id = p_club and r.status = 'booked'
      and r.starts_at < p_ends_at and r.ends_at > p_starts_at
      and (cardinality(ids) = 0 or public.res_linked_courts(r.court_id) && ids);
    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('id', closure.id, 'cancelled', n);
end;
$$;

/** Closures that haven't ended, soonest first (up to 100). */
create function public.res_closures(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_user();
  if public.res_role(p_club) is null then
    raise exception 'Join the club to see its closures.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'courtIds', to_jsonb(x.court_ids), 'startsAt', public.epoch_ms(x.starts_at),
      'endsAt', public.epoch_ms(x.ends_at), 'reason', x.reason
    ) order by x.starts_at)
    from (
      select * from public.closures where club_id = p_club and ends_at > now() order by starts_at limit 100
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.res_delete_closure(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.closures where id = p_id;
  if club is null then
    raise exception 'Closure not found.';
  end if;
  perform public.res_require_staff(club);
  delete from public.closures where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club settings (admins)
-- ---------------------------------------------------------------------------

/** Changes the club's name, address, time zone, booking rules, custom fields and lobby settings (only the keys given). */
create function public.res_save_club(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club public.clubs;
  r jsonb := coalesce(p -> 'rules', '{}');
begin
  perform public.res_require_manager(p_club);
  if p ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p ->> 'timezone') then
    raise exception 'Choose the club''s time zone.';
  end if;
  if p ? 'name' and char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 80 then
    raise exception 'Enter the club''s name (up to 80 characters).';
  end if;
  if p ? 'customFields' and (
    jsonb_typeof(p -> 'customFields') <> 'array'
    or jsonb_array_length(p -> 'customFields') > 20
    or exists (
      select 1 from jsonb_array_elements(p -> 'customFields') f
      where coalesce(f ->> 'id', '') = '' or char_length(coalesce(f ->> 'label', '')) not between 1 and 60
        or coalesce(f ->> 'type', '') not in ('text', 'number', 'checkbox', 'select')
    )
  ) then
    raise exception 'Each custom field needs a label (up to 60 characters) and a type.';
  end if;

  update public.clubs set
    name = case when p ? 'name' then btrim(p ->> 'name') else name end,
    address = case when p ? 'address' then nullif(left(btrim(coalesce(p ->> 'address', '')), 200), '') else address end,
    timezone = coalesce(p ->> 'timezone', timezone),
    park_id = case when p ? 'parkId' then (select id from public.parks where id = p ->> 'parkId') else park_id end,
    min_minutes = coalesce((r ->> 'minMinutes')::integer, min_minutes),
    max_minutes = coalesce((r ->> 'maxMinutes')::integer, max_minutes),
    advance_days = coalesce((r ->> 'advanceDays')::integer, advance_days),
    max_upcoming = coalesce((r ->> 'maxUpcoming')::integer, max_upcoming),
    max_per_day = coalesce((r ->> 'maxPerDay')::integer, max_per_day),
    cancel_cutoff_hours = coalesce((r ->> 'cancelCutoffHours')::integer, cancel_cutoff_hours),
    late_cancel_fee_cents = coalesce((r ->> 'lateCancelFeeCents')::integer, late_cancel_fee_cents),
    no_show_fee_cents = coalesce((r ->> 'noShowFeeCents')::integer, no_show_fee_cents),
    strike_limit = coalesce((r ->> 'strikeLimit')::integer, strike_limit),
    strike_window_days = coalesce((r ->> 'strikeWindowDays')::integer, strike_window_days),
    suspension_days = coalesce((r ->> 'suspensionDays')::integer, suspension_days),
    check_in_minutes_before = coalesce((r ->> 'checkInMinutesBefore')::integer, check_in_minutes_before),
    custom_fields = coalesce(p -> 'customFields', custom_fields),
    lobby_show_names = coalesce((p ->> 'lobbyShowNames')::boolean, lobby_show_names),
    lobby_token = case when coalesce((p ->> 'newLobbyLink')::boolean, false)
                       then replace(gen_random_uuid()::text, '-', '') else lobby_token end
  where id = p_club
  returning * into club;
  return public.res_club_json(club);
exception
  when check_violation then
    raise exception 'One of those rules is out of range. Check the numbers and try again.';
end;
$$;

/**
 * Adds or changes a court or ball machine (p.id to change one). p.schedulerIds, when given,
 * sets which schedulers it's in.
 */
create function public.res_save_court(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  court public.club_courts;
  parent uuid := nullif(p ->> 'parentId', '')::uuid;
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
    raise exception 'Enter a name (up to 40 characters).';
  end if;
  if parent is not null and not exists (
    select 1 from public.club_courts where id = parent and club_id = p_club and parent_id is null and active
  ) then
    raise exception 'A court can only be part of another court that isn''t itself part of one.';
  end if;
  if parent is not null and p ? 'id' and (
    parent = (p ->> 'id')::uuid or exists (select 1 from public.club_courts where parent_id = (p ->> 'id')::uuid)
  ) then
    raise exception 'A court that''s split into others can''t be part of another court.';
  end if;

  if p ? 'id' then
    update public.club_courts set
      name = btrim(p ->> 'name'),
      kind = coalesce(p ->> 'kind', kind),
      sport = coalesce(p ->> 'sport', sport),
      indoor = coalesce((p ->> 'indoor')::boolean, indoor),
      parent_id = parent,
      min_minutes = (p ->> 'minMinutes')::integer,
      max_minutes = (p ->> 'maxMinutes')::integer,
      members_can_book = coalesce((p ->> 'membersCanBook')::boolean, members_can_book),
      sort_order = coalesce((p ->> 'sortOrder')::integer, sort_order)
    where id = (p ->> 'id')::uuid and club_id = p_club and active
    returning * into court;
    if not found then
      raise exception 'Court not found.';
    end if;
  else
    insert into public.club_courts (club_id, name, kind, sport, indoor, parent_id, min_minutes, max_minutes, members_can_book, sort_order)
    values (
      p_club, btrim(p ->> 'name'), coalesce(p ->> 'kind', 'court'), coalesce(p ->> 'sport', 'pickleball'),
      coalesce((p ->> 'indoor')::boolean, false), parent, (p ->> 'minMinutes')::integer, (p ->> 'maxMinutes')::integer,
      coalesce((p ->> 'membersCanBook')::boolean, true),
      coalesce((p ->> 'sortOrder')::integer, (select coalesce(max(sort_order), 0) + 1 from public.club_courts where club_id = p_club))
    )
    returning * into court;
  end if;

  if p ? 'schedulerIds' then
    update public.club_schedulers s
    set court_ids = case
      when s.id = any(public.res_uuids(p -> 'schedulerIds'))
        then case when court.id = any(s.court_ids) then s.court_ids else s.court_ids || court.id end
      else array_remove(s.court_ids, court.id)
    end
    where s.club_id = p_club;
  end if;

  return (select public.res_club_json(k) from public.clubs k where k.id = p_club);
exception
  when check_violation then
    raise exception 'Durations are 15 minutes to 24 hours, and the court type must be one of the choices.';
end;
$$;

/** Removes a court: deleted if it was never booked, otherwise retired (its history stays). */
create function public.res_delete_court(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  court public.club_courts;
begin
  select * into court from public.club_courts where id = p_id;
  if not found then
    raise exception 'Court not found.';
  end if;
  perform public.res_require_manager(court.club_id);
  if exists (select 1 from public.reservations where court_id = p_id and status = 'booked' and ends_at > now()) then
    raise exception '% has upcoming reservations. Move or cancel them first.', court.name;
  end if;
  update public.club_courts set parent_id = null where parent_id = p_id;
  update public.club_schedulers set court_ids = array_remove(court_ids, p_id) where club_id = court.club_id;
  update public.prime_times set court_ids = array_remove(court_ids, p_id) where club_id = court.club_id;
  if exists (select 1 from public.reservations where court_id = p_id) then
    update public.club_courts set active = false, parent_id = null where id = p_id;
  else
    delete from public.club_courts where id = p_id;
  end if;
  return (select public.res_club_json(k) from public.clubs k where k.id = court.club_id);
end;
$$;

/** Adds or changes a reservation type (p.id to change one). */
create function public.res_save_type(p_club uuid, p jsonb)
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
    update public.reservation_types set
      name = btrim(p ->> 'name'),
      color = coalesce(p ->> 'color', color),
      min_players = coalesce((p ->> 'minPlayers')::integer, min_players),
      max_players = coalesce((p ->> 'maxPlayers')::integer, max_players),
      members_can_book = coalesce((p ->> 'membersCanBook')::boolean, members_can_book),
      sort_order = coalesce((p ->> 'sortOrder')::integer, sort_order)
    where id = (p ->> 'id')::uuid and club_id = p_club and active;
    if not found then
      raise exception 'Reservation type not found.';
    end if;
  else
    insert into public.reservation_types (club_id, name, color, min_players, max_players, members_can_book, sort_order)
    values (
      p_club, btrim(p ->> 'name'), coalesce(p ->> 'color', '#0A8754'),
      coalesce((p ->> 'minPlayers')::integer, 1), coalesce((p ->> 'maxPlayers')::integer, 4),
      coalesce((p ->> 'membersCanBook')::boolean, true),
      coalesce((p ->> 'sortOrder')::integer, (select coalesce(max(sort_order), 0) + 1 from public.reservation_types where club_id = p_club))
    );
  end if;
  return (select public.res_club_json(k) from public.clubs k where k.id = p_club);
exception
  when check_violation then
    raise exception 'Colors are like #0A8754, and players go from 0 to 50 with the most at least the fewest.';
end;
$$;

/** Removes a reservation type: deleted if never used, otherwise retired. A club keeps at least one. */
create function public.res_delete_type(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.reservation_types where id = p_id;
  if club is null then
    raise exception 'Reservation type not found.';
  end if;
  perform public.res_require_manager(club);
  if (select count(*) from public.reservation_types where club_id = club and active) <= 1 then
    raise exception 'A club needs at least one reservation type.';
  end if;
  if exists (select 1 from public.reservations where type_id = p_id)
     or exists (select 1 from public.reservation_series where type_id = p_id) then
    update public.reservation_types set active = false where id = p_id;
  else
    delete from public.reservation_types where id = p_id;
  end if;
  return (select public.res_club_json(k) from public.clubs k where k.id = club);
end;
$$;

/** Adds or changes a scheduler (p.id to change one). */
create function public.res_save_scheduler(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
    raise exception 'Enter a name (up to 40 characters).';
  end if;
  if (p ->> 'closes')::time <= (p ->> 'opens')::time then
    raise exception 'Closing time must be after opening time.';
  end if;
  if p ? 'id' then
    update public.club_schedulers set
      name = btrim(p ->> 'name'),
      court_ids = public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')),
      days = public.res_days(p -> 'days'),
      opens = (p ->> 'opens')::time,
      closes = (p ->> 'closes')::time,
      slot_minutes = coalesce((p ->> 'slotMinutes')::integer, slot_minutes),
      members_can_book = coalesce((p ->> 'membersCanBook')::boolean, members_can_book),
      sort_order = coalesce((p ->> 'sortOrder')::integer, sort_order)
    where id = (p ->> 'id')::uuid and club_id = p_club;
    if not found then
      raise exception 'Scheduler not found.';
    end if;
  else
    insert into public.club_schedulers (club_id, name, court_ids, days, opens, closes, slot_minutes, members_can_book, sort_order)
    values (
      p_club, btrim(p ->> 'name'), public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')),
      public.res_days(p -> 'days'), (p ->> 'opens')::time, (p ->> 'closes')::time,
      coalesce((p ->> 'slotMinutes')::integer, 30), coalesce((p ->> 'membersCanBook')::boolean, true),
      coalesce((p ->> 'sortOrder')::integer, (select coalesce(max(sort_order), 0) + 1 from public.club_schedulers where club_id = p_club))
    );
  end if;
  return (select public.res_club_json(k) from public.clubs k where k.id = p_club);
exception
  when check_violation then
    raise exception 'Slots are 15, 30 or 60 minutes, and days are Sunday (0) to Saturday (6).';
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Enter opening and closing times like 07:00 and 22:00.';
end;
$$;

create function public.res_delete_scheduler(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.club_schedulers where id = p_id;
  if club is null then
    raise exception 'Scheduler not found.';
  end if;
  perform public.res_require_manager(club);
  delete from public.club_schedulers where id = p_id;
  return (select public.res_club_json(k) from public.clubs k where k.id = club);
end;
$$;

/** Adds or changes a prime time window (p.id to change one). */
create function public.res_save_prime_time(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if (p ->> 'ends')::time <= (p ->> 'starts')::time then
    raise exception 'Prime time must end after it starts.';
  end if;
  if p ? 'id' then
    update public.prime_times set
      name = coalesce(nullif(btrim(p ->> 'name'), ''), 'Prime Time'),
      court_ids = public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')),
      days = public.res_days(p -> 'days'),
      starts = (p ->> 'starts')::time,
      ends = (p ->> 'ends')::time,
      max_minutes = (p ->> 'maxMinutes')::integer,
      max_per_week = (p ->> 'maxPerWeek')::integer,
      advance_days = (p ->> 'advanceDays')::integer
    where id = (p ->> 'id')::uuid and club_id = p_club;
    if not found then
      raise exception 'Prime time not found.';
    end if;
  else
    insert into public.prime_times (club_id, name, court_ids, days, starts, ends, max_minutes, max_per_week, advance_days)
    values (
      p_club, coalesce(nullif(btrim(p ->> 'name'), ''), 'Prime Time'),
      public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')), public.res_days(p -> 'days'),
      (p ->> 'starts')::time, (p ->> 'ends')::time, (p ->> 'maxMinutes')::integer,
      (p ->> 'maxPerWeek')::integer, (p ->> 'advanceDays')::integer
    );
  end if;
  return (select public.res_club_json(k) from public.clubs k where k.id = p_club);
exception
  when check_violation then
    raise exception 'One of those limits is out of range. Check the numbers and try again.';
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Enter times like 17:00 and 20:00.';
end;
$$;

create function public.res_delete_prime_time(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.prime_times where id = p_id;
  if club is null then
    raise exception 'Prime time not found.';
  end if;
  perform public.res_require_manager(club);
  delete from public.prime_times where id = p_id;
  return (select public.res_club_json(k) from public.clubs k where k.id = club);
end;
$$;

-- ---------------------------------------------------------------------------
-- Members (staff)
-- ---------------------------------------------------------------------------

/** Staff: the club's members, with full name, email, player ID, role and strikes in the current window. */
create function public.res_members(p_club uuid, p_query text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return coalesce((
    select jsonb_agg(x.item order by x.sort_name)
    from (
      select lower(u.last_name || ' ' || u.first_name) as sort_name, jsonb_build_object(
        'userId', m.user_id,
        'name', u.first_name || ' ' || u.last_name,
        'email', a.email,
        'playerCode', u.player_code,
        'role', m.role,
        'joinedAt', public.epoch_ms(m.joined_at),
        'strikes', (
          select count(*) from public.booking_strikes s join public.clubs k on k.id = s.club_id
          where s.club_id = p_club and s.user_id = m.user_id and s.waived_at is null
            and s.created_at > now() - make_interval(days => k.strike_window_days)
        ),
        'suspendedUntil', public.epoch_ms(public.res_suspended_until(p_club, m.user_id))
      ) as item
      from public.club_members m
      join public.profiles u on u.id = m.user_id
      left join auth.users a on a.id = m.user_id
      where m.club_id = p_club
        and (btrim(coalesce(p_query, '')) = ''
             or (u.first_name || ' ' || u.last_name) ilike '%' || btrim(p_query) || '%'
             or a.email ilike '%' || btrim(p_query) || '%'
             or u.player_code = upper(btrim(p_query)))
      order by 1
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;

/**
 * Staff: adds a player to the club by player ID or email (e.g. right after they create an
 * account at the kiosk). Returns the member.
 */
create function public.res_add_member(p_club uuid, p_who text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  who uuid;
  q text := btrim(coalesce(p_who, ''));
begin
  perform public.res_require_staff(p_club);
  if position('@' in q) > 0 then
    select id into who from auth.users where lower(email) = lower(q);
  else
    select id into who from public.profiles where player_code = upper(q);
  end if;
  if who is null or not exists (select 1 from public.profiles where id = who) then
    raise exception 'No Pickle Spots player has that %.', case when position('@' in q) > 0 then 'email' else 'player ID' end;
  end if;
  insert into public.club_members (club_id, user_id) values (p_club, who) on conflict do nothing;
  return (
    select jsonb_build_object('userId', u.id, 'name', u.first_name || ' ' || u.last_name, 'playerCode', u.player_code)
    from public.profiles u where u.id = who
  );
end;
$$;

/**
 * Changes a member's role. Admins make members staff or admins; only owners make owners or
 * change another owner. A club always keeps an owner.
 */
create function public.res_set_member_role(p_club uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  current_role_ text;
  mine text;
begin
  perform public.res_require_manager(p_club);
  mine := public.res_role(p_club);
  select role into current_role_ from public.club_members where club_id = p_club and user_id = p_user;
  if current_role_ is null then
    raise exception 'Member not found.';
  end if;
  if p_role not in ('member', 'staff', 'admin', 'owner') then
    raise exception 'Choose a role.';
  end if;
  if (p_role = 'owner' or current_role_ = 'owner') and mine <> 'owner' then
    raise exception 'Only owners can change who owns the club.';
  end if;
  if current_role_ = 'owner' and p_role <> 'owner'
     and (select count(*) from public.club_members where club_id = p_club and role = 'owner') <= 1 then
    raise exception 'The club needs an owner. Make someone else an owner first.';
  end if;
  update public.club_members set role = p_role where club_id = p_club and user_id = p_user;
end;
$$;

/** Staff: removes a member (and cancels their upcoming reservations without penalty). Admins remove staff; owners stay. */
create function public.res_remove_member(p_club uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  their_role text;
begin
  perform public.res_require_staff(p_club);
  select role into their_role from public.club_members where club_id = p_club and user_id = p_user;
  if their_role is null then
    return;
  end if;
  if their_role = 'owner' then
    raise exception 'Owners can''t be removed. Change their role first.';
  end if;
  if their_role <> 'member' and not public.res_is_manager(p_club) then
    raise exception 'Only club admins can remove staff.';
  end if;
  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Removed from the club'
  where club_id = p_club and owner_id = p_user and status = 'booked' and starts_at > now();
  delete from public.club_members where club_id = p_club and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kiosk and lobby
-- ---------------------------------------------------------------------------

/** Staff (the kiosk): a player by player ID, whether they're a member, and their reservations at the club today. */
create function public.res_kiosk_player(p_club uuid, p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  club public.clubs;
  u public.profiles;
begin
  perform public.res_require_staff(p_club);
  select * into club from public.clubs where id = p_club;
  select * into u from public.profiles where player_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'No player has the ID %. Check it and try again.', upper(btrim(coalesce(p_code, '')));
  end if;
  return jsonb_build_object(
    'userId', u.id,
    'name', public.display_name(u.first_name, u.last_name),
    'playerCode', u.player_code,
    'isMember', exists (select 1 from public.club_members where club_id = p_club and user_id = u.id),
    'suspendedUntil', public.epoch_ms(public.res_suspended_until(p_club, u.id)),
    'reservations', coalesce((
      select jsonb_agg(public.res_reservation_json(r, true) order by r.starts_at)
      from public.reservations r
      where r.club_id = p_club and r.status = 'booked'
        and (r.starts_at at time zone club.timezone)::date = (now() at time zone club.timezone)::date
        and r.ends_at > now()
        and exists (select 1 from public.reservation_players p where p.reservation_id = r.id and p.user_id = u.id)
    ), '[]'::jsonb)
  );
end;
$$;

/**
 * The lobby board, for anyone with its link (no sign-in): the club's courts and the rest of
 * today's reservations and closures. Players' names only if the club shows them.
 */
create function public.res_lobby(p_token text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'club', jsonb_build_object('name', k.name, 'timezone', k.timezone, 'slug', k.slug),
    'now', public.epoch_ms(now()),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'parentId', c.parent_id)
                       order by c.sort_order, c.name)
      from public.club_courts c where c.club_id = k.id and c.active
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'courtId', r.court_id, 'startsAt', public.epoch_ms(r.starts_at), 'endsAt', public.epoch_ms(r.ends_at),
        'title', r.title, 'typeName', t.name, 'color', t.color,
        'names', case when k.lobby_show_names then coalesce((
          select jsonb_agg(public.res_player_name(p.user_id, p.guest_name) order by p.position, p.guest_name)
          from public.reservation_players p where p.reservation_id = r.id
        ), '[]'::jsonb) else '[]'::jsonb end,
        'checkedIn', exists (select 1 from public.reservation_players p where p.reservation_id = r.id and p.checked_in_at is not null)
      ) order by r.starts_at)
      from public.reservations r
      join public.reservation_types t on t.id = r.type_id
      where r.club_id = k.id and r.status = 'booked' and r.ends_at > now()
        and r.starts_at < ((now() at time zone k.timezone)::date + 1) at time zone k.timezone
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'courtIds', to_jsonb(x.court_ids), 'startsAt', public.epoch_ms(x.starts_at), 'endsAt', public.epoch_ms(x.ends_at), 'reason', x.reason
      ))
      from public.closures x
      where x.club_id = k.id and x.ends_at > now()
        and x.starts_at < ((now() at time zone k.timezone)::date + 1) at time zone k.timezone
    ), '[]'::jsonb)
  )
  from public.clubs k
  where k.lobby_token = p_token
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

-- Signed-in users call the res_* functions (each checks the caller's role); helpers that
-- take another user's id or a raw row aren't callable at all. The lobby is open to anyone.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'res\_%'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in (
      'res_conflict', 'res_is_prime', 'res_suspended_until', 'res_player_name', 'res_reservation_json',
      'res_on_reservation', 'res_club_json', 'res_linked_courts', 'res_club_court_ids'
    ) then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end;
$$;

grant execute on function public.res_lobby(text) to anon;
