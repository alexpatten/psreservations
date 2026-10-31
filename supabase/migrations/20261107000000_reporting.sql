-- Reporting ("Pulse"): one dashboard of how a club is doing, computed live from everything
-- else: financials (sales by category, mix of recurring and one-off, refunds, discounts,
-- taxes), court utilization (booked against open court-hours, by weekday and hour, type and
-- sport, unsold hours), engagement (active and new players, retention, churn, members at risk,
-- revenue per player), demographics (age, gender, skill, ZIP codes) and instructors. Every
-- number comes with the same-length period before it for comparison, plus automated insights.
--
-- Pickle Spots data counts too: when the club is linked to its Pickle Spots court
-- (clubs.park_id), players who checked in there with the app (checkin_events) show as
-- walk-up play and active players.
--
-- Admins see Pulse; staff when an admin turns it on for them. Clubs choose which tabs and
-- cards show.

alter table public.club_members add column can_view_reports boolean not null default false;
alter table public.clubs add column pulse_settings jsonb not null default '{}' check (jsonb_typeof(pulse_settings) = 'object');

create function public.res_can_view_reports(p_club uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.res_is_manager(p_club)
    or exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = (select auth.uid())
               and m.can_view_reports and m.role in ('staff', 'admin', 'owner'))
$$;

/** The numbers for one period [p_from, p_to) (club-local days). */
create function public.res_pulse_period(p_club uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  k public.clubs;
  t1 timestamptz;
  t2 timestamptz;
  available numeric;
  booked numeric;
  pos jsonb;
  charges jsonb;
  public_cents integer;
  gross integer;
  active integer;
  walkups jsonb;
begin
  select * into k from public.clubs where id = p_club;
  t1 := p_from::timestamp at time zone k.timezone;
  t2 := p_to::timestamp at time zone k.timezone;

  -- Court-hours open: for each court and day, its longest scheduler window that day.
  select coalesce(sum(w.minutes), 0) / 60.0 into available from (
    select c.id, d, max(public.res_time_minutes(s.closes) - public.res_time_minutes(s.opens)) minutes
    from public.club_courts c
    cross join generate_series(p_from, p_to - 1, interval '1 day') d
    join public.club_schedulers s on s.club_id = c.club_id and c.id = any(s.court_ids) and extract(dow from d)::integer = any(s.days)
    where c.club_id = p_club and c.active and c.kind = 'court'
    group by c.id, d) w;
  select coalesce(sum(extract(epoch from least(r.ends_at, t2) - greatest(r.starts_at, t1)) / 3600), 0) into booked
  from public.reservations r join public.club_courts c on c.id = r.court_id
  where r.club_id = p_club and c.kind = 'court' and r.status = 'booked' and r.starts_at < t2 and r.ends_at > t1;

  select jsonb_build_object(
      'grossCents', coalesce(sum(s.subtotal_cents) filter (where s.status = 'completed'), 0),
      'discountCents', coalesce(sum(s.discount_cents) filter (where s.status = 'completed'), 0),
      'taxCents', coalesce(sum(s.tax_cents) filter (where s.status = 'completed'), 0),
      'netCents', coalesce(sum(s.total_cents - s.tax_cents) filter (where s.status = 'completed'), 0),
      'refundCents', coalesce(sum(s.total_cents) filter (where s.status = 'refunded'), 0),
      'count', count(*) filter (where s.status = 'completed'))
  into pos from public.sales s where s.club_id = p_club and s.created_at >= t1 and s.created_at < t2;

  -- Charges on members' accounts (accrual), by kind; pro shop is counted from sales instead.
  select coalesce(jsonb_object_agg(x.kind, x.cents), '{}') into charges from (
    select e.kind, sum(e.amount_cents) cents from public.ledger_entries e
    where e.club_id = p_club and e.created_at >= t1 and e.created_at < t2
      and e.kind in ('lesson', 'reservation', 'event', 'membership', 'fee')
    group by e.kind) x;
  select coalesce(sum(r.paid_cents - r.refunded_cents), 0) into public_cents from public.reservations r
  where r.club_id = p_club and r.public_token is not null and r.created_at >= t1 and r.created_at < t2;

  gross := (pos ->> 'netCents')::integer + public_cents
    + coalesce((charges ->> 'lesson')::integer, 0) + coalesce((charges ->> 'reservation')::integer, 0)
    + coalesce((charges ->> 'event')::integer, 0) + coalesce((charges ->> 'membership')::integer, 0)
    + coalesce((charges ->> 'fee')::integer, 0);

  -- Walk-up play at the club's Pickle Spots court.
  select jsonb_build_object('visits', count(*), 'players', count(distinct ce.user_id),
      'hours', round(coalesce(sum(extract(epoch from ce.last_seen_at - ce.checked_in_at)) / 3600, 0)::numeric, 1))
  into walkups from public.checkin_events ce
  where k.park_id is not null and ce.park_id = k.park_id and ce.checked_in_at >= t1 and ce.checked_in_at < t2;

  select count(*) into active from (
    select p.user_id from public.reservation_players p join public.reservations r on r.id = p.reservation_id
      where r.club_id = p_club and r.status = 'booked' and r.starts_at >= t1 and r.starts_at < t2 and p.user_id is not null
    union select c.user_id from public.member_checkins c where c.club_id = p_club and c.checked_in_at >= t1 and c.checked_in_at < t2
    union select s.user_id from public.sales s where s.club_id = p_club and s.user_id is not null and s.created_at >= t1 and s.created_at < t2
    union select ce.user_id from public.checkin_events ce where k.park_id is not null and ce.park_id = k.park_id and ce.checked_in_at >= t1 and ce.checked_in_at < t2
  ) a;

  return jsonb_build_object(
    'grossCents', gross,
    'netCents', gross - (pos ->> 'refundCents')::integer,
    'refundCents', (pos ->> 'refundCents')::integer,
    'discountCents', (pos ->> 'discountCents')::integer,
    'taxCents', (pos ->> 'taxCents')::integer,
    'recurringCents', coalesce((charges ->> 'membership')::integer, 0),
    'categories', jsonb_build_object(
      'Court reservations', coalesce((charges ->> 'reservation')::integer, 0) + public_cents,
      'Lessons', coalesce((charges ->> 'lesson')::integer, 0),
      'Events & programs', coalesce((charges ->> 'event')::integer, 0),
      'Memberships', coalesce((charges ->> 'membership')::integer, 0),
      'Pro shop', (pos ->> 'netCents')::integer,
      'Fees', coalesce((charges ->> 'fee')::integer, 0)),
    'utilization', case when available > 0 then round(100 * booked / available) end,
    'bookedHours', round(booked, 1),
    'availableHours', round(available, 1),
    'unsoldHours', round(greatest(available - booked, 0), 1),
    'reservations', (select count(*) from public.reservations r where r.club_id = p_club and r.status = 'booked' and r.starts_at >= t1 and r.starts_at < t2),
    'activePlayers', active,
    'newMembers', (select count(*) from public.club_members m where m.club_id = p_club and m.joined_at >= t1 and m.joined_at < t2),
    'newGuests', (select count(*) from public.public_players g where g.club_id = p_club and g.first_booked_at >= t1 and g.first_booked_at < t2),
    'revenuePerPlayerCents', case when active > 0 then gross / active end,
    'checkins', (select count(*) from public.member_checkins c where c.club_id = p_club and c.checked_in_at >= t1 and c.checked_in_at < t2),
    'noShows', (select count(*) from public.booking_strikes s where s.club_id = p_club and s.kind = 'no_show' and s.created_at >= t1 and s.created_at < t2),
    'lateCancels', (select count(*) from public.booking_strikes s where s.club_id = p_club and s.kind = 'late_cancel' and s.created_at >= t1 and s.created_at < t2),
    'walkups', walkups
  );
end;
$$;

/**
 * Pulse: a period's numbers (club-local days, p_to inclusive) beside the same-length period
 * before, and the breakdowns and insights for the period.
 */
create function public.res_pulse(p_club uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  k public.clubs;
  days integer := p_to - p_from + 1;
  t1 timestamptz;
  t2 timestamptz;
  cur jsonb;
  prev jsonb;
  heat jsonb;
  insights jsonb := '[]';
  quiet record;
  busy record;
  at_risk jsonb;
  retained numeric;
  churn numeric;
begin
  perform public.res_require_user();
  if not public.res_can_view_reports(p_club) then
    raise exception 'Ask a club admin for access to reports.';
  end if;
  if days < 1 or days > 400 then
    raise exception 'Choose up to about a year.';
  end if;
  select * into k from public.clubs where id = p_club;
  t1 := p_from::timestamp at time zone k.timezone;
  t2 := (p_to + 1)::timestamp at time zone k.timezone;
  cur := public.res_pulse_period(p_club, p_from, p_to + 1);
  prev := public.res_pulse_period(p_club, p_from - days, p_from);

  -- Booked share of open court-time by weekday and hour.
  with open_hours as (
    select extract(dow from d)::integer dow, h, count(*) * 60 open_minutes
    from public.club_courts c
    cross join generate_series(p_from, p_to, interval '1 day') d
    cross join generate_series(0, 23) h
    where c.club_id = p_club and c.active and c.kind = 'court'
      and exists (select 1 from public.club_schedulers s where s.club_id = p_club and c.id = any(s.court_ids)
                  and extract(dow from d)::integer = any(s.days)
                  and h * 60 >= public.res_time_minutes(s.opens) and h * 60 + 60 <= public.res_time_minutes(s.closes))
    group by 1, 2
  ),
  used as (
    select extract(dow from l)::integer dow, extract(hour from l)::integer h, count(*) * 30 booked_minutes
    from public.reservations r join public.club_courts c on c.id = r.court_id
    cross join lateral generate_series(r.starts_at, r.ends_at - interval '30 minutes', interval '30 minutes') slot
    cross join lateral (select slot at time zone k.timezone l) x
    where r.club_id = p_club and c.kind = 'court' and r.status = 'booked' and r.starts_at < t2 and r.ends_at > t1 and slot >= t1 and slot < t2
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('dow', o.dow, 'hour', o.h, 'pct', least(100, round(100.0 * coalesce(u.booked_minutes, 0) / o.open_minutes)))
                            order by o.dow, o.h), '[]') into heat
  from open_hours o left join used u on u.dow = o.dow and u.h = o.h;

  -- Insights.
  if (cur ->> 'utilization') is not null and (prev ->> 'utilization') is not null and (cur ->> 'utilization')::integer <> (prev ->> 'utilization')::integer then
    insights := insights || jsonb_build_object('tone', case when (cur ->> 'utilization')::integer > (prev ->> 'utilization')::integer then 'good' else 'warning' end,
      'text', 'Courts were ' || (cur ->> 'utilization') || '% booked, ' ||
        case when (cur ->> 'utilization')::integer > (prev ->> 'utilization')::integer then 'up' else 'down' end ||
        ' from ' || (prev ->> 'utilization') || '% the period before.');
  end if;
  select x.dow, min(x.hour) h1, max(x.hour) h2, round(avg(x.pct)) pct into quiet
  from jsonb_to_recordset(heat) x(dow integer, hour integer, pct integer)
  where x.hour between 8 and 11 group by x.dow order by avg(x.pct) limit 1;
  if quiet.dow is not null and quiet.pct < 35 then
    insights := insights || jsonb_build_object('tone', 'info', 'text',
      (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[quiet.dow + 1] || ' mornings are only ' || quiet.pct ||
      '% booked: a clinic, open play or off-peak price could fill them.');
  end if;
  select x.dow, x.hour, x.pct into busy from jsonb_to_recordset(heat) x(dow integer, hour integer, pct integer) order by x.pct desc limit 1;
  if busy.pct >= 85 then
    insights := insights || jsonb_build_object('tone', 'good', 'text',
      (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[busy.dow + 1] || 's at ' ||
      to_char(make_time(busy.hour, 0, 0), 'FMHH12 AM') || ' are ' || busy.pct || '% booked. Prime-time limits or pricing keep it fair.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('userId', z.user_id, 'name', z.name, 'lastSeen', public.epoch_ms(z.last_seen)) order by z.last_seen nulls first), '[]') into at_risk
  from (
    select m.user_id, u.first_name || ' ' || u.last_name name,
      (select max(t) from (
        select max(r.starts_at) t from public.reservation_players p join public.reservations r on r.id = p.reservation_id
          where r.club_id = p_club and p.user_id = m.user_id and r.status = 'booked' and r.starts_at <= now()
        union all select max(c.checked_in_at) from public.member_checkins c where c.club_id = p_club and c.user_id = m.user_id) v) last_seen
    from public.club_members m join public.profiles u on u.id = m.user_id
    where m.club_id = p_club and exists (select 1 from public.res_active_memberships(p_club, m.user_id))
  ) z where z.last_seen is null or z.last_seen < now() - interval '30 days'
  limit 25;
  if jsonb_array_length(at_risk) > 0 then
    insights := insights || jsonb_build_object('tone', 'warning', 'text',
      jsonb_array_length(at_risk) || ' member' || case when jsonb_array_length(at_risk) = 1 then ' hasn''t' else 's haven''t' end ||
      ' played in 30 days. A check-in email (Email Members) can bring them back.');
  end if;
  if (select count(*) from public.products p where p.club_id = p_club and p.active and p.track_inventory and p.reorder_level is not null and p.stock <= p.reorder_level) > 0 then
    insights := insights || jsonb_build_object('tone', 'warning', 'text', 'Some pro shop items are at their reorder level.');
  end if;
  if (select coalesce(sum(total_cents - paid_cents), 0) from public.invoices where club_id = p_club and status = 'open' and due_on < current_date) > 0 then
    insights := insights || jsonb_build_object('tone', 'warning', 'text', 'There are overdue invoices: ' ||
      to_char((select sum(total_cents - paid_cents) from public.invoices where club_id = p_club and status = 'open' and due_on < current_date) / 100.0, 'FM$999,999,990.00') || ' outstanding.');
  end if;

  -- Retention: of the members active the period before, how many came back.
  with before as (
    select distinct p.user_id from public.reservation_players p join public.reservations r on r.id = p.reservation_id
    where r.club_id = p_club and r.status = 'booked' and r.starts_at >= t1 - make_interval(days => days) and r.starts_at < t1 and p.user_id is not null
  ), after as (
    select distinct p.user_id from public.reservation_players p join public.reservations r on r.id = p.reservation_id
    where r.club_id = p_club and r.status = 'booked' and r.starts_at >= t1 and r.starts_at < t2 and p.user_id is not null
  )
  select case when count(*) > 0 then round(100.0 * count(*) filter (where a.user_id is not null) / count(*)) end into retained
  from before b left join after a on a.user_id = b.user_id;
  select case when count(*) > 0 then round(100.0 * count(*) filter (where mm.ends_on between p_from and p_to) / count(*)) end into churn
  from public.member_memberships mm where mm.club_id = p_club and mm.starts_on < p_from and (mm.ends_on is null or mm.ends_on >= p_from);

  return jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'), 'to', to_char(p_to, 'YYYY-MM-DD'),
    'current', cur, 'previous', prev,
    'settings', k.pulse_settings,
    'linkedToPickleSpots', k.park_id is not null,
    'heatmap', heat,
    'byType', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color, 'hours', x.hours) order by x.hours desc) from (
      select r.type_id, round(sum(extract(epoch from r.ends_at - r.starts_at)) / 3600, 1) hours from public.reservations r
      where r.club_id = p_club and r.status = 'booked' and r.starts_at >= t1 and r.starts_at < t2 group by 1) x
      join public.reservation_types t on t.id = x.type_id), '[]'),
    'bySport', coalesce((select jsonb_agg(jsonb_build_object('name', x.sport, 'hours', x.hours) order by x.hours desc) from (
      select c.sport, round(sum(extract(epoch from r.ends_at - r.starts_at)) / 3600, 1) hours
      from public.reservations r join public.club_courts c on c.id = r.court_id
      where r.club_id = p_club and r.status = 'booked' and c.kind = 'court' and r.starts_at >= t1 and r.starts_at < t2 group by 1) x), '[]'),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('week', to_char(x.w, 'YYYY-MM-DD'), 'players', x.players, 'reservations', x.n) order by x.w) from (
      select date_trunc('week', r.starts_at at time zone k.timezone)::date w, count(distinct p.user_id) players, count(distinct r.id) n
      from public.reservations r left join public.reservation_players p on p.reservation_id = r.id and p.user_id is not null
      where r.club_id = p_club and r.status = 'booked' and r.starts_at >= t1 and r.starts_at < t2 group by 1) x), '[]'),
    'retention', retained,
    'churn', churn,
    'members', (select count(*) from public.club_members where club_id = p_club),
    'activeMemberships', (select count(*) from public.member_memberships mm where mm.club_id = p_club and mm.starts_on <= current_date and (mm.ends_on is null or mm.ends_on >= current_date)),
    'atRisk', at_risk,
    'demographics', jsonb_build_object(
      'age', (select jsonb_agg(jsonb_build_object('name', b, 'count', n) order by o) from (
        select case when m.birth_date is null then 'Unknown' when age(m.birth_date) < interval '18 years' then 'Under 18'
                    when age(m.birth_date) < interval '35 years' then '18–34' when age(m.birth_date) < interval '50 years' then '35–49'
                    when age(m.birth_date) < interval '65 years' then '50–64' else '65+' end b,
               case when m.birth_date is null then 9 when age(m.birth_date) < interval '18 years' then 1 when age(m.birth_date) < interval '35 years' then 2
                    when age(m.birth_date) < interval '50 years' then 3 when age(m.birth_date) < interval '65 years' then 4 else 5 end o, count(*) n
        from public.club_members m where m.club_id = p_club group by 1, 2) x),
      'gender', (select jsonb_agg(jsonb_build_object('name', b, 'count', n) order by n desc) from (
        select case m.gender when 'woman' then 'Women' when 'man' then 'Men' when 'nonbinary' then 'Nonbinary' else 'Not given' end b, count(*) n
        from public.club_members m where m.club_id = p_club group by 1) x),
      'skill', (select jsonb_agg(jsonb_build_object('name', b, 'count', n) order by o) from (
        select case when r is null then 'Unrated' when r < 3 then 'Under 3.0' when r < 3.5 then '3.0–3.49' when r < 4 then '3.5–3.99'
                    when r < 4.5 then '4.0–4.49' else '4.5+' end b,
               case when r is null then 9 when r < 3 then 1 when r < 3.5 then 2 when r < 4 then 3 when r < 4.5 then 4 else 5 end o, count(*) n
        from (select public.res_player_rating(p_club, m.user_id) r from public.club_members m where m.club_id = p_club) y group by 1, 2) x),
      'zips', coalesce((select jsonb_agg(jsonb_build_object('name', z, 'count', n) order by n desc) from (
        select m.zip z, count(*) n from public.club_members m where m.club_id = p_club and m.zip is not null group by 1 order by 2 desc limit 15) x), '[]')),
    'instructors', public.res_instructor_report(p_club, p_from, p_to),
    'insights', insights
  );
end;
$$;

/** Admins: which tabs and cards Pulse shows ({hiddenTabs: [...], hiddenCards: [...]}). */
create function public.res_save_pulse_settings(p_club uuid, p jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  update public.clubs set pulse_settings = coalesce(p, '{}') where id = p_club;
end;
$$;

/** Admins: lets a staff member see Pulse (or not). */
create function public.res_set_report_access(p_club uuid, p_user uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  update public.club_members set can_view_reports = p_on where club_id = p_club and user_id = p_user;
end;
$$;

/** Admins: staff who can see Pulse. */
create function public.res_report_access(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  return coalesce((select jsonb_agg(m.user_id) from public.club_members m where m.club_id = p_club and m.can_view_reports), '[]'::jsonb);
end;
$$;

revoke execute on function
  public.res_report_access(uuid), public.res_can_view_reports(uuid), public.res_pulse_period(uuid, date, date), public.res_pulse(uuid, date, date),
  public.res_save_pulse_settings(uuid, jsonb), public.res_set_report_access(uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.res_report_access(uuid), public.res_can_view_reports(uuid), public.res_pulse(uuid, date, date), public.res_save_pulse_settings(uuid, jsonb), public.res_set_report_access(uuid, uuid, boolean)
to authenticated;
