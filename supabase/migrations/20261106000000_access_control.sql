-- Access control: door codes for smart locks, so unattended courts (public, HOA) open only for
-- confirmed reservations.
--
-- Each door (access point) covers some courts. In per-reservation mode, every booked reservation
-- on those courts gets its own PIN, valid from a few minutes before it starts until a few minutes
-- after it ends; moving the reservation moves the code, cancelling it revokes it, and the person
-- who booked gets a notification with the code. Daily mode instead shares one code a day with
-- everyone who has a reservation that day.
--
-- Doors linked to a lock through Seam (one API for Schlage, Yale, August, Kwikset, igloohome and
-- more) have their codes pushed to the lock by the access-control function, which also records
-- unlocks from Seam's webhook into the access log and tells staff.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.clubs
  add column access_mode text not null default 'off' check (access_mode in ('off', 'reservation', 'daily')),
  add column access_minutes_before integer not null default 15 check (access_minutes_before between 0 and 120),
  add column access_minutes_after integer not null default 15 check (access_minutes_after between 0 and 120),
  add column access_code_length integer not null default 4 check (access_code_length between 4 and 8),
  -- Staff hear about every unlock.
  add column access_notify_staff boolean not null default false;

create table public.access_points (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- Courts this door lets players reach (empty: all of them).
  court_ids uuid[] not null default '{}',
  -- A Seam device id when the lock is connected; null for a door whose codes staff set by hand.
  seam_device_id text check (char_length(seam_device_id) <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  access_point_id uuid not null references public.access_points (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete cascade,
  -- Daily codes have a day instead of a reservation.
  day date,
  code text not null check (code ~ '^[0-9]{4,8}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- pending: to be sent to the lock (or removed from it, once revoked); active: on the lock.
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked', 'failed')),
  seam_code_id text,
  error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reservation_id, access_point_id),
  unique (day, access_point_id)
);

create index access_codes_club on public.access_codes (club_id, starts_at);
create index access_codes_sync on public.access_codes (status) where status in ('pending', 'revoked');

create table public.access_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  access_point_id uuid references public.access_points (id) on delete set null,
  access_code_id uuid references public.access_codes (id) on delete set null,
  kind text not null check (kind in ('unlock', 'denied', 'manual')),
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'
);

create index access_events_club on public.access_events (club_id, occurred_at desc);

alter table public.access_points enable row level security;
alter table public.access_codes enable row level security;
alter table public.access_events enable row level security;
revoke all on public.access_points, public.access_codes, public.access_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Codes follow reservations
-- ---------------------------------------------------------------------------

/** A PIN of the club's length that no overlapping code on the same door uses. */
create function public.res_new_access_code(p_point uuid, p_len integer, p_starts timestamptz, p_ends timestamptz)
returns text
language plpgsql
set search_path = ''
as $$
declare
  c text;
  i integer := 0;
begin
  loop
    c := lpad(floor(random() * power(10, p_len))::bigint::text, p_len, '0');
    exit when not exists (select 1 from public.access_codes x where x.access_point_id = p_point and x.code = c
                          and x.status in ('pending', 'active') and x.starts_at < p_ends and x.ends_at > p_starts) or i > 20;
    i := i + 1;
  end loop;
  return c;
end;
$$;

/** Keeps a reservation's door codes in step with it (per-reservation mode). */
create function public.res_access_reservation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.clubs;
  ap public.access_points;
  s timestamptz;
  e timestamptz;
  code public.access_codes;
  linked uuid[];
  codes text := '';
begin
  select * into k from public.clubs where id = new.club_id;
  if k.access_mode <> 'reservation' then
    return new;
  end if;
  if new.status <> 'booked' then
    update public.access_codes set status = 'revoked'
    where reservation_id = new.id and status in ('pending', 'active');
    return new;
  end if;
  s := new.starts_at - make_interval(mins => k.access_minutes_before);
  e := new.ends_at + make_interval(mins => k.access_minutes_after);
  linked := public.res_linked_courts(new.court_id);
  for ap in select * from public.access_points where club_id = k.id and active and (cardinality(court_ids) = 0 or court_ids && linked) loop
    select * into code from public.access_codes where reservation_id = new.id and access_point_id = ap.id;
    if not found then
      insert into public.access_codes (club_id, access_point_id, reservation_id, code, starts_at, ends_at, status)
      values (k.id, ap.id, new.id, public.res_new_access_code(ap.id, k.access_code_length, s, e), s, e,
              case when ap.seam_device_id is null then 'active' else 'pending' end)
      returning * into code;
      codes := codes || case when codes = '' then '' else ', ' end || ap.name || ' ' || code.code;
    elsif code.starts_at <> s or code.ends_at <> e or code.status = 'revoked' then
      -- Moved (or back after a cancel): the lock needs the new times.
      update public.access_codes set starts_at = s, ends_at = e,
        status = case when ap.seam_device_id is null then 'active' else 'pending' end, error = null
      where id = code.id;
    end if;
  end loop;
  -- Codes for doors that no longer cover the court (moved to another court) are revoked.
  update public.access_codes x set status = 'revoked'
  from public.access_points door
  where x.reservation_id = new.id and door.id = x.access_point_id and x.status in ('pending', 'active')
    and not (cardinality(door.court_ids) = 0 or door.court_ids && linked);
  if codes <> '' and new.owner_id is not null then
    perform public.res_notify(k.id, new.owner_id, 'Your door code: ' || codes,
      'Works from ' || to_char(s at time zone k.timezone, 'Mon FMDD FMHH12:MI AM') || ' to ' || to_char(e at time zone k.timezone, 'FMHH12:MI AM') || '.',
      '/c/' || k.slug || '/mine');
  end if;
  return new;
end;
$$;

create trigger reservations_access
  after insert or update of status, starts_at, ends_at, court_id on public.reservations
  for each row execute function public.res_access_reservation();

-- ---------------------------------------------------------------------------
-- Players' codes
-- ---------------------------------------------------------------------------

/**
 * Your door codes at a club for reservations that haven't ended: per reservation, or the day's
 * shared code for days you have a reservation.
 */
create function public.res_my_access_codes(p_club uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('reservationId', r.id, 'door', ap.name, 'code', x.code,
      'startsAt', public.epoch_ms(x.starts_at), 'endsAt', public.epoch_ms(x.ends_at), 'pending', x.status = 'pending') order by x.starts_at), '[]'::jsonb)
  from public.reservations r
  join public.clubs k on k.id = r.club_id
  join public.access_codes x on x.status in ('active', 'pending') and (
    x.reservation_id = r.id
    or (k.access_mode = 'daily' and x.day = (r.starts_at at time zone k.timezone)::date))
  join public.access_points ap on ap.id = x.access_point_id
  where r.club_id = p_club and r.status = 'booked' and r.ends_at > now()
    and (r.owner_id = (select auth.uid()) or exists (select 1 from public.reservation_players p where p.reservation_id = r.id and p.user_id = (select auth.uid())))
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

create function public.res_access(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return (select jsonb_build_object(
    'mode', k.access_mode, 'minutesBefore', k.access_minutes_before, 'minutesAfter', k.access_minutes_after,
    'codeLength', k.access_code_length, 'notifyStaff', k.access_notify_staff,
    'points', coalesce((select jsonb_agg(jsonb_build_object('id', ap.id, 'name', ap.name, 'courtIds', to_jsonb(ap.court_ids), 'seamDeviceId', ap.seam_device_id) order by ap.name)
      from public.access_points ap where ap.club_id = k.id and ap.active), '[]'::jsonb),
    'dailyCodes', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(x.day, 'YYYY-MM-DD'), 'door', ap.name, 'code', x.code, 'status', x.status) order by x.day)
      from public.access_codes x join public.access_points ap on ap.id = x.access_point_id
      where x.club_id = k.id and x.day >= (now() at time zone k.timezone)::date and x.status <> 'revoked'), '[]'::jsonb),
    'failed', (select count(*) from public.access_codes x where x.club_id = k.id and x.status = 'failed' and x.ends_at > now())
  ) from public.clubs k where k.id = p_club);
end;
$$;

create function public.res_save_access(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  update public.clubs set
    access_mode = coalesce(p ->> 'mode', access_mode),
    access_minutes_before = coalesce((p ->> 'minutesBefore')::integer, access_minutes_before),
    access_minutes_after = coalesce((p ->> 'minutesAfter')::integer, access_minutes_after),
    access_code_length = coalesce((p ->> 'codeLength')::integer, access_code_length),
    access_notify_staff = coalesce((p ->> 'notifyStaff')::boolean, access_notify_staff)
  where id = p_club;
  -- Turning per-reservation codes on: make codes for what's already booked.
  if p ->> 'mode' = 'reservation' then
    update public.reservations set status = status where club_id = p_club and status = 'booked' and ends_at > now();
  end if;
  return public.res_access(p_club);
exception
  when check_violation then
    raise exception 'Codes are 4–8 digits; times before and after are up to 120 minutes.';
end;
$$;

create function public.res_save_access_point(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ap uuid;
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 60 then
    raise exception 'Name the door (e.g. Main Gate).';
  end if;
  if p ? 'id' then
    update public.access_points set name = btrim(p ->> 'name'),
      court_ids = public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')),
      seam_device_id = nullif(btrim(coalesce(p ->> 'seamDeviceId', '')), '')
    where id = (p ->> 'id')::uuid and club_id = p_club returning id into ap;
  else
    insert into public.access_points (club_id, name, court_ids, seam_device_id)
    values (p_club, btrim(p ->> 'name'), public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')), nullif(btrim(coalesce(p ->> 'seamDeviceId', '')), ''))
    returning id into ap;
  end if;
  update public.reservations set status = status where club_id = p_club and status = 'booked' and ends_at > now();
  return public.res_access(p_club);
end;
$$;

create function public.res_delete_access_point(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.access_points where id = p_id;
  if club is null then
    raise exception 'Door not found.';
  end if;
  perform public.res_require_manager(club);
  update public.access_points set active = false where id = p_id;
  update public.access_codes set status = 'revoked' where access_point_id = p_id and status in ('pending', 'active');
  return public.res_access(club);
end;
$$;

/** Staff: sets the shared code for a day (daily mode) on every door, or a random one when p_code is empty. */
create function public.res_set_daily_code(p_club uuid, p_day date, p_code text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.clubs;
  ap public.access_points;
  s timestamptz;
  e timestamptz;
  c text;
begin
  perform public.res_require_staff(p_club);
  select * into k from public.clubs where id = p_club;
  s := p_day::timestamp at time zone k.timezone;
  e := (p_day + 1)::timestamp at time zone k.timezone;
  for ap in select * from public.access_points where club_id = p_club and active loop
    c := coalesce(nullif(btrim(coalesce(p_code, '')), ''), public.res_new_access_code(ap.id, k.access_code_length, s, e));
    if c !~ '^[0-9]{4,8}$' then
      raise exception 'Codes are 4–8 digits.';
    end if;
    insert into public.access_codes (club_id, access_point_id, day, code, starts_at, ends_at, status)
    values (p_club, ap.id, p_day, c, s, e, case when ap.seam_device_id is null then 'active' else 'pending' end)
    on conflict (day, access_point_id) do update set code = excluded.code, status = excluded.status, error = null;
  end loop;
  return public.res_access(p_club);
end;
$$;

/** Staff: door codes between two moments (newest first, up to 500), with who they're for. */
create function public.res_access_codes(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return coalesce((select jsonb_agg(x.j order by x.starts_at) from (
    select c.starts_at, jsonb_build_object('id', c.id, 'door', ap.name, 'code', c.code, 'status', c.status, 'error', c.error,
      'startsAt', public.epoch_ms(c.starts_at), 'endsAt', public.epoch_ms(c.ends_at), 'day', to_char(c.day, 'YYYY-MM-DD'),
      'who', case when r.id is not null then coalesce(public.res_player_name(r.owner_id, null), r.title) end,
      'courtName', (select name from public.club_courts where id = r.court_id)) j
    from public.access_codes c join public.access_points ap on ap.id = c.access_point_id
    left join public.reservations r on r.id = c.reservation_id
    where c.club_id = p_club and c.starts_at < p_to and c.ends_at > p_from
    order by c.starts_at limit 500) x), '[]'::jsonb);
end;
$$;

/** Staff: the access log: unlocks (and denials) between two moments, matched to codes and reservations. */
create function public.res_access_events(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return coalesce((select jsonb_agg(x.j order by x.occurred_at desc) from (
    select ev.occurred_at, jsonb_build_object('id', ev.id, 'kind', ev.kind, 'occurredAt', public.epoch_ms(ev.occurred_at),
      'door', ap.name, 'code', c.code,
      'who', coalesce(public.res_player_name(r.owner_id, null), r.title, case when c.day is not null then 'Daily code' end, ev.detail ->> 'method'),
      'reservation', case when r.id is not null then jsonb_build_object('courtName', (select name from public.club_courts where id = r.court_id),
        'startsAt', public.epoch_ms(r.starts_at), 'endsAt', public.epoch_ms(r.ends_at)) end) j
    from public.access_events ev
    left join public.access_points ap on ap.id = ev.access_point_id
    left join public.access_codes c on c.id = ev.access_code_id
    left join public.reservations r on r.id = c.reservation_id
    where ev.club_id = p_club and ev.occurred_at >= p_from and ev.occurred_at < p_to
    order by ev.occurred_at desc limit 1000) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The access-control function (secret key)
-- ---------------------------------------------------------------------------

/** Codes to push to locks or remove from them. */
create function public.res_access_to_sync()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'code', c.code, 'deviceId', ap.seam_device_id,
    'seamCodeId', c.seam_code_id, 'startsAt', c.starts_at, 'endsAt', c.ends_at, 'name', left(coalesce(r.title, 'Reservation') || ' ' || c.code, 50))), '[]'::jsonb)
  from public.access_codes c join public.access_points ap on ap.id = c.access_point_id
  left join public.reservations r on r.id = c.reservation_id
  where ap.seam_device_id is not null and c.ends_at > now() - interval '1 hour'
    and (c.status = 'pending' or (c.status = 'revoked' and c.seam_code_id is not null))
  limit 200
$$;

create function public.res_access_synced(p_id uuid, p_seam_code_id text, p_ok boolean, p_error text default null)
returns void
language sql security definer
set search_path = ''
as $$
  update public.access_codes set
    status = case when not p_ok then 'failed' when status = 'revoked' then 'revoked' else 'active' end,
    seam_code_id = case when status = 'revoked' and p_ok then null else coalesce(p_seam_code_id, seam_code_id) end,
    error = case when p_ok then null else left(p_error, 300) end,
    synced_at = now()
  where id = p_id
$$;

/** Records an unlock (or denial) reported by Seam, and tells staff when the club wants that. */
create function public.res_access_event(p_device_id text, p_seam_code_id text, p_kind text, p_at timestamptz, p_detail jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  ap public.access_points;
  c public.access_codes;
  k public.clubs;
  who text;
begin
  select * into ap from public.access_points where seam_device_id = p_device_id and active limit 1;
  if not found then
    return;
  end if;
  select * into k from public.clubs where id = ap.club_id;
  select * into c from public.access_codes where seam_code_id = p_seam_code_id and access_point_id = ap.id;
  insert into public.access_events (club_id, access_point_id, access_code_id, kind, occurred_at, detail)
  values (ap.club_id, ap.id, c.id, coalesce(p_kind, 'unlock'), coalesce(p_at, now()), coalesce(p_detail, '{}'));
  if k.access_notify_staff then
    who := coalesce((select public.res_player_name(r.owner_id, null) from public.reservations r where r.id = c.reservation_id), 'Someone');
    insert into public.res_notifications (club_id, user_id, title, body, link)
    select k.id, m.user_id, ap.name || ': ' || case when p_kind = 'denied' then 'wrong code tried' else who || ' unlocked it' end,
      to_char(coalesce(p_at, now()) at time zone k.timezone, 'Mon FMDD FMHH12:MI AM'), '/c/' || k.slug || '/manage?section=access'
    from public.club_members m where m.club_id = k.id and m.role in ('staff', 'admin', 'owner');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_new_access_code(uuid, integer, timestamptz, timestamptz), public.res_access_reservation(), public.res_my_access_codes(uuid),
  public.res_access(uuid), public.res_save_access(uuid, jsonb), public.res_save_access_point(uuid, jsonb), public.res_delete_access_point(uuid),
  public.res_set_daily_code(uuid, date, text), public.res_access_codes(uuid, timestamptz, timestamptz), public.res_access_events(uuid, timestamptz, timestamptz),
  public.res_access_to_sync(), public.res_access_synced(uuid, text, boolean, text), public.res_access_event(text, text, text, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function
  public.res_my_access_codes(uuid), public.res_access(uuid), public.res_save_access(uuid, jsonb), public.res_save_access_point(uuid, jsonb),
  public.res_delete_access_point(uuid), public.res_set_daily_code(uuid, date, text), public.res_access_codes(uuid, timestamptz, timestamptz),
  public.res_access_events(uuid, timestamptz, timestamptz)
to authenticated;
grant execute on function
  public.res_access_to_sync(), public.res_access_synced(uuid, text, boolean, text), public.res_access_event(text, text, text, timestamptz, jsonb)
to service_role;
