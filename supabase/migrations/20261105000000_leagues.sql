-- Leagues and ladders.
--
-- A league is a season of round-robin play: singles players or doubles teams sign up, staff
-- generate the schedule (every entry plays every other, week by week on the league night,
-- each match booked on a court so the schedule and the courts agree), players report scores
-- and opponents confirm them, and standings follow (points per win and loss, then game
-- difference). A ladder is a ranked list: players challenge someone up to a few places above
-- them, and a challenger who wins takes that place. Each league has a message board.
-- Entry fees go on members' accounts.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'league' check (kind in ('league', 'ladder')),
  format text not null default 'doubles' check (format in ('singles', 'doubles')),
  description text check (char_length(description) <= 2000),
  status text not null default 'registration' check (status in ('registration', 'active', 'completed')),
  starts_on date not null,
  ends_on date,
  -- League night (0 = Sunday) and when matches start.
  day_of_week integer check (day_of_week between 0 and 6),
  start_time time not null default '18:00',
  match_minutes integer not null default 60 check (match_minutes between 15 and 240),
  -- Courts the schedule may use (empty: all courts).
  court_ids uuid[] not null default '{}',
  fee_cents integer not null default 0 check (fee_cents >= 0),
  max_entries integer check (max_entries between 2 and 200),
  members_only boolean not null default true,
  points_win integer not null default 2,
  points_loss integer not null default 0,
  -- Ladders: how many places above you can challenge.
  challenge_range integer not null default 3 check (challenge_range between 1 and 20),
  created_at timestamptz not null default now()
);

create table public.league_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  partner_id uuid references auth.users (id) on delete set null,
  team_name text check (char_length(team_name) <= 40),
  -- Ladder position (1 is the top).
  rank integer,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (league_id, user_id)
);

create table public.league_matches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  round integer,
  entry_a uuid not null references public.league_entries (id) on delete cascade,
  entry_b uuid not null references public.league_entries (id) on delete cascade,
  scheduled_at timestamptz,
  court_id uuid references public.club_courts (id) on delete set null,
  reservation_id uuid references public.reservations (id) on delete set null,
  -- Games, e.g. [[11, 7], [9, 11], [11, 4]], entry_a's score first.
  scores jsonb not null default '[]',
  winner uuid references public.league_entries (id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'reported', 'confirmed', 'cancelled')),
  -- Ladders: entry_a challenged entry_b.
  challenge boolean not null default false,
  reported_by uuid references auth.users (id) on delete set null,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index league_matches_league on public.league_matches (league_id, scheduled_at);

create table public.league_posts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.leagues enable row level security;
alter table public.league_entries enable row level security;
alter table public.league_matches enable row level security;
alter table public.league_posts enable row level security;
revoke all on public.leagues, public.league_entries, public.league_matches, public.league_posts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** "Jamie R." or "Jamie R. & Sam T.", or the team's name. */
create function public.res_entry_name(e public.league_entries)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce(e.team_name,
    public.res_player_name(e.user_id, null) || coalesce(' & ' || public.res_player_name(e.partner_id, null), ''))
$$;

/** Whether you play in an entry. */
create function public.res_in_entry(p_entry uuid)
returns boolean
language sql stable
set search_path = ''
as $$ select exists (select 1 from public.league_entries e where e.id = p_entry and (select auth.uid()) in (e.user_id, e.partner_id)) $$;

/** Games won by each side: {a, b}. */
create function public.res_games(p_scores jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'a', coalesce(sum(case when (g ->> 0)::integer > (g ->> 1)::integer then 1 else 0 end), 0),
    'b', coalesce(sum(case when (g ->> 1)::integer > (g ->> 0)::integer then 1 else 0 end), 0),
    'pointsA', coalesce(sum((g ->> 0)::integer), 0),
    'pointsB', coalesce(sum((g ->> 1)::integer), 0))
  from jsonb_array_elements(coalesce(p_scores, '[]')) g
$$;

/** The club's "League" reservation type, made the first time a schedule needs one. */
create function public.res_league_type(p_club uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  t uuid;
begin
  select id into t from public.reservation_types where club_id = p_club and active and name = 'League' limit 1;
  if t is null then
    insert into public.reservation_types (club_id, name, color, min_players, max_players, members_can_book, sort_order)
    values (p_club, 'League', '#1D9BD1', 0, 4, false, 50) returning id into t;
  end if;
  return t;
end;
$$;

/** A ladder result: a challenger who beat someone above them takes their place; everyone between moves down one. */
create function public.res_apply_ladder(m public.league_matches)
returns void
language plpgsql
set search_path = ''
as $$
declare
  winner public.league_entries;
  loser public.league_entries;
begin
  if not m.challenge or m.winner is null then
    return;
  end if;
  select * into winner from public.league_entries where id = m.winner;
  select * into loser from public.league_entries where id = case when m.winner = m.entry_a then m.entry_b else m.entry_a end;
  if winner.rank > loser.rank then
    update public.league_entries set rank = rank + 1
    where league_id = m.league_id and status = 'active' and rank >= loser.rank and rank < winner.rank;
    update public.league_entries set rank = loser.rank where id = winner.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create function public.res_leagues(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_user();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'kind', l.kind, 'format', l.format, 'description', l.description, 'status', l.status,
      'startsOn', to_char(l.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(l.ends_on, 'YYYY-MM-DD'), 'dayOfWeek', l.day_of_week,
      'startTime', to_char(l.start_time, 'HH24:MI'), 'feeCents', l.fee_cents, 'maxEntries', l.max_entries, 'membersOnly', l.members_only,
      'entries', (select count(*) from public.league_entries e where e.league_id = l.id and e.status = 'active'),
      'joined', exists (select 1 from public.league_entries e where e.league_id = l.id and e.status = 'active' and (select auth.uid()) in (e.user_id, e.partner_id))
    ) order by case l.status when 'active' then 0 when 'registration' then 1 else 2 end, l.starts_on desc)
    from public.leagues l where l.club_id = p_club), '[]'::jsonb);
end;
$$;

/** A league or ladder: settings, entries, standings, matches and the board. */
create function public.res_league(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  l public.leagues;
begin
  perform public.res_require_user();
  select * into l from public.leagues where id = p_id;
  if not found then
    raise exception 'League not found.';
  end if;
  return jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'clubId', l.club_id, 'name', l.name, 'kind', l.kind, 'format', l.format, 'description', l.description,
      'status', l.status, 'startsOn', to_char(l.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(l.ends_on, 'YYYY-MM-DD'), 'dayOfWeek', l.day_of_week,
      'startTime', to_char(l.start_time, 'HH24:MI'), 'matchMinutes', l.match_minutes, 'courtIds', to_jsonb(l.court_ids), 'feeCents', l.fee_cents,
      'maxEntries', l.max_entries, 'membersOnly', l.members_only, 'pointsWin', l.points_win, 'pointsLoss', l.points_loss, 'challengeRange', l.challenge_range),
    'myEntryId', (select e.id from public.league_entries e where e.league_id = l.id and e.status = 'active' and (select auth.uid()) in (e.user_id, e.partner_id)),
    'standings', coalesce((select jsonb_agg(x.j order by x.ord) from (
      select jsonb_build_object('entryId', e.id, 'name', public.res_entry_name(e), 'rank', e.rank, 'played', s.played, 'wins', s.wins, 'losses', s.losses,
          'gamesFor', s.gf, 'gamesAgainst', s.ga, 'points', s.wins * l.points_win + s.losses * l.points_loss) j,
        case when l.kind = 'ladder' then e.rank::numeric else -(s.wins * l.points_win + s.losses * l.points_loss) * 1000 - (s.gf - s.ga) end ord
      from public.league_entries e
      cross join lateral (
        select count(*) played,
          count(*) filter (where m.winner = e.id) wins,
          count(*) filter (where m.winner is not null and m.winner <> e.id) losses,
          coalesce(sum(case when m.entry_a = e.id then (public.res_games(m.scores) ->> 'a')::integer else (public.res_games(m.scores) ->> 'b')::integer end), 0) gf,
          coalesce(sum(case when m.entry_a = e.id then (public.res_games(m.scores) ->> 'b')::integer else (public.res_games(m.scores) ->> 'a')::integer end), 0) ga
        from public.league_matches m where m.league_id = l.id and m.status = 'confirmed' and e.id in (m.entry_a, m.entry_b)
      ) s
      where e.league_id = l.id and e.status = 'active') x), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'round', m.round, 'entryA', m.entry_a, 'entryB', m.entry_b,
        'nameA', public.res_entry_name(a), 'nameB', public.res_entry_name(b), 'scheduledAt', public.epoch_ms(m.scheduled_at),
        'courtName', (select c.name from public.club_courts c where c.id = m.court_id), 'scores', m.scores, 'winner', m.winner, 'status', m.status,
        'challenge', m.challenge, 'mine', public.res_in_entry(m.entry_a) or public.res_in_entry(m.entry_b),
        'reportedByMe', m.reported_by = (select auth.uid()),
        'reportedBySide', case when m.reported_by in (a.user_id, a.partner_id) then 'a' when m.reported_by in (b.user_id, b.partner_id) then 'b' end
      ) order by m.round nulls last, m.scheduled_at nulls last, m.created_at)
      from public.league_matches m join public.league_entries a on a.id = m.entry_a join public.league_entries b on b.id = m.entry_b
      where m.league_id = l.id and m.status <> 'cancelled'), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', public.res_player_name(p.user_id, null), 'body', p.body,
        'createdAt', public.epoch_ms(p.created_at)) order by p.created_at desc)
      from (select * from public.league_posts where league_id = l.id order by created_at desc limit 100) p), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting up and joining
-- ---------------------------------------------------------------------------

create function public.res_save_league(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.leagues;
begin
  perform public.res_require_staff(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 80 then
    raise exception 'Name the league.';
  end if;
  if p ? 'id' then
    update public.leagues set name = btrim(p ->> 'name'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      status = coalesce(p ->> 'status', status), starts_on = coalesce((p ->> 'startsOn')::date, starts_on),
      ends_on = case when p ? 'endsOn' then (p ->> 'endsOn')::date else ends_on end,
      day_of_week = case when p ? 'dayOfWeek' then (p ->> 'dayOfWeek')::integer else day_of_week end,
      start_time = coalesce((p ->> 'startTime')::time, start_time), match_minutes = coalesce((p ->> 'matchMinutes')::integer, match_minutes),
      court_ids = case when p ? 'courtIds' then public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')) else court_ids end,
      fee_cents = coalesce((p ->> 'feeCents')::integer, fee_cents),
      max_entries = case when p ? 'maxEntries' then (p ->> 'maxEntries')::integer else max_entries end,
      members_only = coalesce((p ->> 'membersOnly')::boolean, members_only),
      points_win = coalesce((p ->> 'pointsWin')::integer, points_win), points_loss = coalesce((p ->> 'pointsLoss')::integer, points_loss),
      challenge_range = coalesce((p ->> 'challengeRange')::integer, challenge_range)
    where id = (p ->> 'id')::uuid and club_id = p_club returning * into l;
  else
    insert into public.leagues (club_id, name, kind, format, description, starts_on, ends_on, day_of_week, start_time, match_minutes, court_ids,
                                fee_cents, max_entries, members_only, challenge_range)
    values (p_club, btrim(p ->> 'name'), coalesce(p ->> 'kind', 'league'), coalesce(p ->> 'format', 'doubles'), nullif(btrim(coalesce(p ->> 'description', '')), ''),
            coalesce((p ->> 'startsOn')::date, current_date), (p ->> 'endsOn')::date, (p ->> 'dayOfWeek')::integer,
            coalesce((p ->> 'startTime')::time, '18:00'), coalesce((p ->> 'matchMinutes')::integer, 60),
            public.res_club_court_ids(p_club, public.res_uuids(p -> 'courtIds')), coalesce((p ->> 'feeCents')::integer, 0),
            (p ->> 'maxEntries')::integer, coalesce((p ->> 'membersOnly')::boolean, true), coalesce((p ->> 'challengeRange')::integer, 3))
    returning * into l;
  end if;
  return jsonb_build_object('id', l.id);
exception
  when check_violation then
    raise exception 'Check the kind, format, match length, entries and fee.';
end;
$$;

/**
 * Joins a league (or ladder): you, plus your partner by player ID for doubles, and an optional
 * team name; or (staff) someone else by player ID. Ladders put new players at the bottom.
 * The entry fee goes on your account.
 */
create function public.res_join_league(p_league uuid, p_partner_code text default null, p_team_name text default null, p_owner_code text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  l public.leagues;
  who uuid := uid;
  partner uuid;
  e public.league_entries;
begin
  select * into l from public.leagues where id = p_league;
  if not found then
    raise exception 'League not found.';
  end if;
  if nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    perform public.res_require_staff(l.club_id);
    select id into who from public.profiles where player_code = upper(btrim(p_owner_code));
    if who is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
  else
    if l.status = 'completed' or (l.status = 'active' and l.kind = 'league') then
      raise exception 'Sign-ups are closed.';
    end if;
    if l.members_only and public.res_role(l.club_id) is null then
      raise exception 'Join the club to sign up.';
    end if;
  end if;
  if l.format = 'doubles' and nullif(btrim(coalesce(p_partner_code, '')), '') is not null then
    select id into partner from public.profiles where player_code = upper(btrim(p_partner_code));
    if partner is null or partner = who then
      raise exception 'Check your partner''s player ID.';
    end if;
  end if;
  if exists (select 1 from public.league_entries x where x.league_id = l.id and x.status = 'active'
             and (x.user_id in (who, partner) or x.partner_id in (who, partner))) then
    raise exception 'You (or your partner) are already in this league.';
  end if;
  if l.max_entries is not null and (select count(*) from public.league_entries where league_id = l.id and status = 'active') >= l.max_entries then
    raise exception 'This league is full.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(l.id::text, 0));
  insert into public.club_members (club_id, user_id) values (l.club_id, who) on conflict do nothing;
  if partner is not null then
    insert into public.club_members (club_id, user_id) values (l.club_id, partner) on conflict do nothing;
  end if;
  insert into public.league_entries (league_id, user_id, partner_id, team_name, rank)
  values (l.id, who, partner, nullif(left(btrim(coalesce(p_team_name, '')), 40), ''),
          case when l.kind = 'ladder' then (select coalesce(max(rank), 0) + 1 from public.league_entries where league_id = l.id and status = 'active') end)
  on conflict (league_id, user_id) do update set status = 'active', partner_id = excluded.partner_id, team_name = excluded.team_name, rank = excluded.rank
  returning * into e;
  if l.fee_cents > 0 then
    insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, source_type, source_id, created_by)
    values (l.club_id, who, 'event', l.name || ' entry', l.fee_cents, 'league_entry', e.id, uid);
  end if;
  return jsonb_build_object('entryId', e.id, 'name', public.res_entry_name(e));
end;
$$;

/** Leaves a league (you, or staff for an entry). Their unplayed matches are cancelled; ladder places close up. */
create function public.res_withdraw_league(p_entry uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  e public.league_entries;
  l public.leagues;
begin
  select * into e from public.league_entries where id = p_entry;
  if not found then
    raise exception 'Entry not found.';
  end if;
  select * into l from public.leagues where id = e.league_id;
  if not public.res_in_entry(p_entry) then
    perform public.res_require_staff(l.club_id);
  end if;
  update public.league_entries set status = 'withdrawn', rank = null where id = p_entry;
  if e.rank is not null then
    update public.league_entries set rank = rank - 1 where league_id = l.id and status = 'active' and rank > e.rank;
  end if;
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason = 'League match cancelled'
  where id in (select reservation_id from public.league_matches where status = 'scheduled' and p_entry in (entry_a, entry_b)) and status = 'booked';
  update public.league_matches set status = 'cancelled' where status = 'scheduled' and p_entry in (entry_a, entry_b);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

/**
 * Staff: generates a round-robin league schedule from the start date, one round a week on
 * league night, and books each match on a court (trying later slots when a court's taken).
 * Replaces unplayed scheduled matches. Returns rounds, matches and any left unbooked.
 */
create function public.res_generate_schedule(p_league uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.leagues;
  k public.clubs;
  ids uuid[];
  n integer;
  rounds integer;
  r integer;
  i integer;
  a uuid;
  b uuid;
  day date;
  slot integer;
  court uuid;
  courts uuid[];
  s timestamptz;
  e timestamptz;
  t uuid;
  res public.reservations;
  made integer := 0;
  unbooked integer := 0;
  booked boolean;
  ci integer;
begin
  select * into l from public.leagues where id = p_league;
  if not found then
    raise exception 'League not found.';
  end if;
  perform public.res_require_staff(l.club_id);
  if l.kind <> 'league' then
    raise exception 'Ladders are played by challenge, not a schedule.';
  end if;
  select * into k from public.clubs where id = l.club_id;
  select array_agg(id order by created_at) into ids from public.league_entries where league_id = l.id and status = 'active';
  if coalesce(cardinality(ids), 0) < 2 then
    raise exception 'A schedule needs at least two entries.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(l.club_id::text, 0));

  -- Start over: cancel unplayed matches and their court bookings.
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason = 'League schedule regenerated'
  where id in (select reservation_id from public.league_matches where league_id = l.id and status = 'scheduled') and status = 'booked';
  delete from public.league_matches where league_id = l.id and status = 'scheduled';

  -- Circle method: an odd count gets a bye (null).
  if cardinality(ids) % 2 = 1 then
    ids := ids || null::uuid;
  end if;
  n := cardinality(ids);
  rounds := n - 1;
  courts := case when cardinality(l.court_ids) > 0 then l.court_ids
                 else array(select c.id from public.club_courts c where c.club_id = l.club_id and c.active and c.kind = 'court' order by c.sort_order) end;
  t := public.res_league_type(l.club_id);
  day := l.starts_on;
  if l.day_of_week is not null then
    day := day + ((l.day_of_week - extract(dow from day)::integer + 7) % 7);
  end if;

  for r in 1..rounds loop
    slot := 0;
    ci := 0;
    for i in 1..(n / 2) loop
      a := ids[i];
      b := ids[n + 1 - i];
      if a is null or b is null then
        continue;
      end if;
      booked := false;
      -- Fill courts at the start time, then later slots, up to 4 slots deep.
      while not booked and slot < 4 loop
        s := (day + l.start_time + make_interval(mins => slot * l.match_minutes)) at time zone k.timezone;
        e := s + make_interval(mins => l.match_minutes);
        while ci < cardinality(courts) and not booked loop
          ci := ci + 1;
          court := courts[ci];
          if public.res_conflict(court, s, e) is null then
            insert into public.reservations (club_id, court_id, type_id, title, starts_at, ends_at, created_by)
            values (l.club_id, court, t, l.name || ' · Round ' || r, s, e, (select auth.uid())) returning * into res;
            insert into public.reservation_players (reservation_id, user_id, position)
            select res.id, u, 0 from public.league_entries x, unnest(array[x.user_id, x.partner_id]) u
            where x.id in (a, b) and u is not null on conflict do nothing;
            insert into public.league_matches (league_id, round, entry_a, entry_b, scheduled_at, court_id, reservation_id)
            values (l.id, r, a, b, s, court, res.id);
            booked := true;
          end if;
        end loop;
        if not booked then
          slot := slot + 1;
          ci := 0;
        end if;
      end loop;
      if not booked then
        insert into public.league_matches (league_id, round, entry_a, entry_b, scheduled_at) values (l.id, r, a, b, (day + l.start_time) at time zone k.timezone);
        unbooked := unbooked + 1;
      end if;
      made := made + 1;
    end loop;
    -- Rotate everyone but the first.
    ids := array[ids[1]] || ids[n:n] || ids[2:n - 1];
    day := day + 7;
  end loop;

  update public.leagues set status = 'active', ends_on = coalesce(ends_on, day - 7) where id = l.id;
  -- Tell everyone.
  insert into public.res_notifications (club_id, user_id, title, body, link)
  select l.club_id, u, l.name || ': the schedule is out', rounds || ' rounds starting ' || to_char(l.starts_on, 'Mon FMDD'), '/c/' || k.slug || '/leagues/' || l.id
  from public.league_entries x, unnest(array[x.user_id, x.partner_id]) u where x.league_id = l.id and x.status = 'active' and u is not null;

  return jsonb_build_object('rounds', rounds, 'matches', made, 'unbooked', unbooked);
end;
$$;

-- ---------------------------------------------------------------------------
-- Playing
-- ---------------------------------------------------------------------------

/** Ladders: challenges someone up to the ladder's range above you, optionally at a time. */
create function public.res_challenge(p_league uuid, p_opponent uuid, p_at timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.leagues;
  me public.league_entries;
  them public.league_entries;
  m public.league_matches;
begin
  select * into l from public.leagues where id = p_league;
  if l.kind <> 'ladder' or l.status = 'completed' then
    raise exception 'Challenges are for open ladders.';
  end if;
  select * into me from public.league_entries where league_id = l.id and status = 'active' and (select auth.uid()) in (user_id, partner_id);
  if not found then
    raise exception 'Join the ladder first.';
  end if;
  select * into them from public.league_entries where id = p_opponent and league_id = l.id and status = 'active';
  if not found or them.id = me.id then
    raise exception 'Choose who to challenge.';
  end if;
  if them.rank >= me.rank or me.rank - them.rank > l.challenge_range then
    raise exception 'You can challenge up to % places above you.', l.challenge_range;
  end if;
  if exists (select 1 from public.league_matches x where x.league_id = l.id and x.status in ('scheduled', 'reported') and (me.id in (x.entry_a, x.entry_b) or them.id in (x.entry_a, x.entry_b))) then
    raise exception 'One of you already has a challenge to play.';
  end if;
  insert into public.league_matches (league_id, entry_a, entry_b, scheduled_at, challenge) values (l.id, me.id, them.id, p_at, true) returning * into m;
  insert into public.res_notifications (club_id, user_id, title, body, link)
  select l.club_id, u, public.res_entry_name(me) || ' challenged you', l.name, '/c/' || (select slug from public.clubs where id = l.club_id) || '/leagues/' || l.id
  from unnest(array[them.user_id, them.partner_id]) u where u is not null;
  return jsonb_build_object('matchId', m.id);
end;
$$;

/**
 * Reports a match score (games, entry A's score first). A player's report waits for the other
 * side to confirm; staff reports are final. Final results update standings and ladders.
 */
create function public.res_report_score(p_match uuid, p_scores jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.league_matches;
  l public.leagues;
  g jsonb;
  staff boolean;
  v_winner uuid;
  game jsonb;
begin
  select * into m from public.league_matches where id = p_match for update;
  if not found or m.status = 'cancelled' then
    raise exception 'Match not found.';
  end if;
  select * into l from public.leagues where id = m.league_id;
  staff := public.res_is_staff(l.club_id);
  if not staff and not public.res_in_entry(m.entry_a) and not public.res_in_entry(m.entry_b) then
    raise exception 'Only the players and staff can report this score.';
  end if;
  if m.status = 'confirmed' and not staff then
    raise exception 'This score is final. Ask the club to change it.';
  end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) = 0 then
    raise exception 'Enter at least one game.';
  end if;
  for game in select * from jsonb_array_elements(p_scores) loop
    if jsonb_typeof(game) <> 'array' or jsonb_array_length(game) <> 2 or (game ->> 0)::integer < 0 or (game ->> 1)::integer < 0
       or (game ->> 0)::integer = (game ->> 1)::integer then
      raise exception 'Each game needs two different scores.';
    end if;
  end loop;
  g := public.res_games(p_scores);
  if (g ->> 'a')::integer = (g ->> 'b')::integer then
    raise exception 'Someone has to win more games.';
  end if;
  v_winner := case when (g ->> 'a')::integer > (g ->> 'b')::integer then m.entry_a else m.entry_b end;
  update public.league_matches set scores = p_scores, winner = v_winner, status = case when staff then 'confirmed' else 'reported' end,
    reported_by = (select auth.uid()), confirmed_by = case when staff then (select auth.uid()) end
  where id = p_match returning * into m;
  if staff then
    perform public.res_apply_ladder(m);
  else
    insert into public.res_notifications (club_id, user_id, title, body, link)
    select l.club_id, u, 'Confirm your score', l.name, '/c/' || (select slug from public.clubs where id = l.club_id) || '/leagues/' || l.id
    from public.league_entries x, unnest(array[x.user_id, x.partner_id]) u
    where x.id in (m.entry_a, m.entry_b) and u is not null and u <> (select auth.uid())
      and not ((select auth.uid()) in (x.user_id, x.partner_id));
  end if;
end;
$$;

/** The other side (or staff) confirms a reported score. */
create function public.res_confirm_score(p_match uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.league_matches;
  l public.leagues;
  reporter_side uuid;
begin
  select * into m from public.league_matches where id = p_match for update;
  if not found or m.status <> 'reported' then
    raise exception 'There''s no score waiting to be confirmed.';
  end if;
  select * into l from public.leagues where id = m.league_id;
  select id into reporter_side from public.league_entries where id in (m.entry_a, m.entry_b) and m.reported_by in (user_id, partner_id);
  if not public.res_is_staff(l.club_id) and (not (public.res_in_entry(m.entry_a) or public.res_in_entry(m.entry_b)) or public.res_in_entry(reporter_side)) then
    raise exception 'The other side confirms the score.';
  end if;
  update public.league_matches set status = 'confirmed', confirmed_by = (select auth.uid()) where id = p_match returning * into m;
  perform public.res_apply_ladder(m);
end;
$$;

/** Posts on a league's board: players in it, and staff. */
create function public.res_league_post(p_league uuid, p_body text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.leagues;
begin
  select * into l from public.leagues where id = p_league;
  if not public.res_is_staff(l.club_id) and not exists (select 1 from public.league_entries e where e.league_id = l.id and e.status = 'active' and (select auth.uid()) in (e.user_id, e.partner_id)) then
    raise exception 'Join the league to post.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Write a message (up to 1000 characters).';
  end if;
  insert into public.league_posts (league_id, user_id, body) values (l.id, (select auth.uid()), btrim(p_body));
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_entry_name(public.league_entries), public.res_in_entry(uuid), public.res_games(jsonb), public.res_league_type(uuid),
  public.res_apply_ladder(public.league_matches), public.res_leagues(uuid), public.res_league(uuid), public.res_save_league(uuid, jsonb),
  public.res_join_league(uuid, text, text, text), public.res_withdraw_league(uuid), public.res_generate_schedule(uuid),
  public.res_challenge(uuid, uuid, timestamptz), public.res_report_score(uuid, jsonb), public.res_confirm_score(uuid), public.res_league_post(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.res_leagues(uuid), public.res_league(uuid), public.res_save_league(uuid, jsonb), public.res_join_league(uuid, text, text, text),
  public.res_withdraw_league(uuid), public.res_generate_schedule(uuid), public.res_challenge(uuid, uuid, timestamptz),
  public.res_report_score(uuid, jsonb), public.res_confirm_score(uuid), public.res_league_post(uuid, text)
to authenticated;
