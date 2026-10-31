-- Membership management: plans with prices, billing periods and booking perks; families that
-- share a membership; member groups; custom rating scales; waivers with electronic signatures;
-- member check-in at the desk; and email to members (sent by the club-email function).
--
-- Clubs can require a membership to book courts, and any waiver marked required must be signed
-- first. Dues are billed by the batch billing migration from member_memberships.next_bill_on.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 1000),
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  period text not null default 'month' check (period in ('month', 'quarter', 'year', 'once')),
  -- People sharing one membership (2+ makes it a family plan).
  max_members integer not null default 1 check (max_members between 1 and 20),
  -- Booking perks; null keeps the club's rule.
  advance_days integer check (advance_days between 0 and 365),
  max_upcoming integer check (max_upcoming between 1 and 100),
  max_per_day integer check (max_per_day between 1 and 50),
  -- Members can sign up for it themselves.
  self_signup boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  relationship text check (char_length(relationship) <= 30),
  primary key (family_id, user_id)
);

create table public.member_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.membership_plans (id),
  -- A family plan covers everyone in the family.
  family_id uuid references public.families (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  starts_on date not null default current_date,
  -- Last day covered; null runs until cancelled.
  ends_on date,
  -- When dues are next billed (batch billing advances it).
  next_bill_on date,
  price_cents integer not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index member_memberships_member on public.member_memberships (club_id, user_id);

create table public.member_groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 500),
  -- Members see it (and can join it themselves).
  visible boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.member_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.rating_scales (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- For everyone, adults or juniors.
  audience text not null default 'all' check (audience in ('all', 'adults', 'juniors')),
  min_value numeric(5, 2) not null default 1,
  max_value numeric(5, 2) not null default 5,
  step numeric(5, 2) not null default 0.5 check (step > 0),
  sort_order integer not null default 0,
  check (max_value > min_value)
);

create table public.member_ratings (
  scale_id uuid not null references public.rating_scales (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  value numeric(5, 2) not null,
  rated_by uuid references auth.users (id) on delete set null,
  rated_at timestamptz not null default now(),
  primary key (scale_id, user_id)
);

create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 20000),
  -- Must be signed before booking.
  required boolean not null default true,
  -- Changing the text asks everyone to sign again.
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  waiver_id uuid not null references public.waivers (id) on delete cascade,
  version integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  signed_name text not null check (char_length(signed_name) between 2 and 80),
  -- The drawn signature as an SVG path (null when typed).
  signature_svg text check (char_length(signature_svg) <= 60000),
  signed_at timestamptz not null default now(),
  unique (waiver_id, version, user_id)
);

create table public.member_checkins (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users (id) on delete set null
);

create index member_checkins_club on public.member_checkins (club_id, checked_in_at);

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  subject text not null,
  body text not null,
  audience jsonb not null default '{}',
  recipients integer not null default 0,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now()
);

alter table public.clubs add column require_membership boolean not null default false;

alter table public.membership_plans enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.member_memberships enable row level security;
alter table public.member_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.rating_scales enable row level security;
alter table public.member_ratings enable row level security;
alter table public.waivers enable row level security;
alter table public.waiver_signatures enable row level security;
alter table public.member_checkins enable row level security;
alter table public.email_campaigns enable row level security;
revoke all on
  public.membership_plans, public.families, public.family_members, public.member_memberships, public.member_groups,
  public.group_members, public.rating_scales, public.member_ratings, public.waivers, public.waiver_signatures,
  public.member_checkins, public.email_campaigns
from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Memberships covering a player today: their own, or a family plan of a family they're in. */
create function public.res_active_memberships(p_club uuid, p_user uuid)
returns setof public.member_memberships
language sql stable
set search_path = ''
as $$
  select mm.* from public.member_memberships mm
  where mm.club_id = p_club and mm.status in ('active', 'cancelled')
    and mm.starts_on <= current_date and (mm.ends_on is null or mm.ends_on >= current_date)
    and (mm.user_id = p_user
         or (mm.family_id is not null and exists (select 1 from public.family_members f where f.family_id = mm.family_id and f.user_id = p_user)))
$$;

/** Required waivers a player hasn't signed (the current version), as a list of titles, or null. */
create function public.res_unsigned_waivers(p_club uuid, p_user uuid)
returns text
language sql stable
set search_path = ''
as $$
  select string_agg(w.title, ', ' order by w.created_at)
  from public.waivers w
  where w.club_id = p_club and w.active and w.required
    and not exists (select 1 from public.waiver_signatures s where s.waiver_id = w.id and s.version = w.version and s.user_id = p_user)
$$;

/** As before, preferring the club's own first rating scale when the player has a rating on it. */
create or replace function public.res_player_rating(p_club uuid, p_user uuid)
returns numeric
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select r.value from public.member_ratings r join public.rating_scales s on s.id = r.scale_id
     where s.club_id = p_club and r.user_id = p_user order by s.sort_order, s.name limit 1),
    (select u.doubles::numeric from public.profiles u where u.id = p_user)
  )
$$;

create function public.res_period_interval(p_period text)
returns interval
language sql immutable
set search_path = ''
as $$ select case p_period when 'month' then interval '1 month' when 'quarter' then interval '3 months' when 'year' then interval '1 year' else null end $$;

create function public.res_membership_json(mm public.member_memberships)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', mm.id, 'userId', mm.user_id, 'planId', mm.plan_id, 'planName', p.name, 'period', p.period, 'familyId', mm.family_id,
    'status', case when mm.ends_on is not null and mm.ends_on < current_date then 'expired' else mm.status end,
    'startsOn', to_char(mm.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(mm.ends_on, 'YYYY-MM-DD'),
    'nextBillOn', to_char(mm.next_bill_on, 'YYYY-MM-DD'), 'priceCents', mm.price_cents,
    'memberName', (select u.first_name || ' ' || u.last_name from public.profiles u where u.id = mm.user_id)
  )
  from public.membership_plans p where p.id = mm.plan_id
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

/** The membership page: plans, your memberships, family, groups you can see, waivers and your signatures, rating scales. */
create function public.res_memberships(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  staff boolean := public.res_is_staff(p_club);
begin
  return jsonb_build_object(
    'requireMembership', (select require_membership from public.clubs where id = p_club),
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'priceCents', p.price_cents, 'period', p.period,
      'maxMembers', p.max_members, 'advanceDays', p.advance_days, 'maxUpcoming', p.max_upcoming, 'maxPerDay', p.max_per_day,
      'selfSignup', p.self_signup, 'sortOrder', p.sort_order,
      'activeMembers', case when staff then (select count(*) from public.member_memberships mm where mm.plan_id = p.id and mm.status = 'active' and (mm.ends_on is null or mm.ends_on >= current_date)) end
    ) order by p.sort_order, p.price_cents) from public.membership_plans p where p.club_id = p_club and p.active and (staff or p.self_signup)), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(public.res_membership_json(mm) order by mm.starts_on desc)
      from public.member_memberships mm where mm.club_id = p_club and (mm.user_id = uid
        or (mm.family_id is not null and exists (select 1 from public.family_members f where f.family_id = mm.family_id and f.user_id = uid)))), '[]'::jsonb),
    'family', (select jsonb_build_object('id', fa.id, 'name', fa.name, 'members', (
        select jsonb_agg(jsonb_build_object('userId', fm.user_id, 'name', u.first_name || ' ' || u.last_name, 'relationship', fm.relationship) order by u.first_name)
        from public.family_members fm join public.profiles u on u.id = fm.user_id where fm.family_id = fa.id))
      from public.families fa join public.family_members f on f.family_id = fa.id where fa.club_id = p_club and f.user_id = uid limit 1),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'visible', g.visible,
        'members', (select count(*) from public.group_members x where x.group_id = g.id),
        'joined', exists (select 1 from public.group_members x where x.group_id = g.id and x.user_id = uid)) order by g.name)
      from public.member_groups g where g.club_id = p_club and (staff or g.visible or exists (select 1 from public.group_members x where x.group_id = g.id and x.user_id = uid))), '[]'::jsonb),
    'waivers', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'body', w.body, 'required', w.required, 'version', w.version,
        'signedAt', (select public.epoch_ms(s.signed_at) from public.waiver_signatures s where s.waiver_id = w.id and s.version = w.version and s.user_id = uid),
        'signatures', case when staff then (select count(*) from public.waiver_signatures s where s.waiver_id = w.id and s.version = w.version) end) order by w.created_at)
      from public.waivers w where w.club_id = p_club and w.active), '[]'::jsonb),
    'ratingScales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'audience', s.audience, 'min', s.min_value, 'max', s.max_value, 'step', s.step,
        'myRating', (select r.value from public.member_ratings r where r.scale_id = s.id and r.user_id = uid)) order by s.sort_order, s.name)
      from public.rating_scales s where s.club_id = p_club), '[]'::jsonb)
  );
end;
$$;

/** Staff: everything about one member: details, memberships, family, groups, ratings, waivers, balance, strikes and visits. */
create function public.res_member_profile(p_club uuid, p_user uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return (
    select jsonb_build_object(
      'userId', m.user_id, 'name', u.first_name || ' ' || u.last_name, 'playerCode', u.player_code,
      'email', (select a.email from auth.users a where a.id = m.user_id), 'phone', u.phone, 'role', m.role,
      'joinedAt', public.epoch_ms(m.joined_at), 'birthDate', to_char(m.birth_date, 'YYYY-MM-DD'), 'gender', m.gender, 'zip', m.zip,
      'duprDoubles', u.doubles,
      'memberships', coalesce((select jsonb_agg(public.res_membership_json(mm) order by mm.starts_on desc) from public.member_memberships mm
        where mm.club_id = p_club and (mm.user_id = m.user_id or (mm.family_id is not null and exists (select 1 from public.family_members f where f.family_id = mm.family_id and f.user_id = m.user_id)))), '[]'::jsonb),
      'family', (select jsonb_build_object('id', fa.id, 'name', fa.name, 'members', (select jsonb_agg(jsonb_build_object('userId', fm.user_id, 'name', p.first_name || ' ' || p.last_name, 'playerCode', p.player_code, 'relationship', fm.relationship))
          from public.family_members fm join public.profiles p on p.id = fm.user_id where fm.family_id = fa.id))
        from public.families fa join public.family_members f on f.family_id = fa.id where fa.club_id = p_club and f.user_id = m.user_id limit 1),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name)) from public.member_groups g join public.group_members x on x.group_id = g.id where g.club_id = p_club and x.user_id = m.user_id), '[]'::jsonb),
      'ratings', coalesce((select jsonb_agg(jsonb_build_object('scaleId', s.id, 'name', s.name, 'value', r.value)) from public.rating_scales s join public.member_ratings r on r.scale_id = s.id where s.club_id = p_club and r.user_id = m.user_id), '[]'::jsonb),
      'waivers', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'required', w.required,
          'signedAt', (select public.epoch_ms(s.signed_at) from public.waiver_signatures s where s.waiver_id = w.id and s.version = w.version and s.user_id = m.user_id)))
        from public.waivers w where w.club_id = p_club and w.active), '[]'::jsonb),
      'balanceCents', coalesce((select sum(e.amount_cents) from public.ledger_entries e where e.club_id = p_club and e.user_id = m.user_id), 0),
      'visits30', (select count(*) from public.member_checkins c where c.club_id = p_club and c.user_id = m.user_id and c.checked_in_at > now() - interval '30 days'),
      'reservations30', (select count(*) from public.reservation_players rp join public.reservations r on r.id = rp.reservation_id
        where r.club_id = p_club and rp.user_id = m.user_id and r.status = 'booked' and r.starts_at > now() - interval '30 days' and r.starts_at <= now()),
      'lastVisit', (select public.epoch_ms(max(t)) from (
        select max(c.checked_in_at) t from public.member_checkins c where c.club_id = p_club and c.user_id = m.user_id
        union all select max(r.starts_at) from public.reservation_players rp join public.reservations r on r.id = rp.reservation_id
        where r.club_id = p_club and rp.user_id = m.user_id and r.status = 'booked' and r.starts_at <= now()) v)
    )
    from public.club_members m join public.profiles u on u.id = m.user_id
    where m.club_id = p_club and m.user_id = p_user
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans and memberships
-- ---------------------------------------------------------------------------

create function public.res_save_plan(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 60 then
    raise exception 'Name the plan.';
  end if;
  if p ? 'id' then
    update public.membership_plans set name = btrim(p ->> 'name'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      price_cents = coalesce((p ->> 'priceCents')::integer, price_cents), period = coalesce(p ->> 'period', period),
      max_members = coalesce((p ->> 'maxMembers')::integer, max_members),
      advance_days = (p ->> 'advanceDays')::integer, max_upcoming = (p ->> 'maxUpcoming')::integer, max_per_day = (p ->> 'maxPerDay')::integer,
      self_signup = coalesce((p ->> 'selfSignup')::boolean, self_signup)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.membership_plans (club_id, name, description, price_cents, period, max_members, advance_days, max_upcoming, max_per_day, self_signup, sort_order)
    values (p_club, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'description', '')), ''), coalesce((p ->> 'priceCents')::integer, 0),
            coalesce(p ->> 'period', 'month'), coalesce((p ->> 'maxMembers')::integer, 1), (p ->> 'advanceDays')::integer,
            (p ->> 'maxUpcoming')::integer, (p ->> 'maxPerDay')::integer, coalesce((p ->> 'selfSignup')::boolean, true),
            (select coalesce(max(sort_order), 0) + 1 from public.membership_plans where club_id = p_club));
  end if;
  return public.res_memberships(p_club);
exception
  when check_violation then
    raise exception 'Check the price, period, family size and booking perks.';
end;
$$;

create function public.res_delete_plan(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.membership_plans where id = p_id;
  if club is null then
    raise exception 'Plan not found.';
  end if;
  perform public.res_require_manager(club);
  update public.membership_plans set active = false where id = p_id;
  return public.res_memberships(club);
end;
$$;

/**
 * Starts a membership: yourself on a plan open for sign-up, or (staff) any member by player ID
 * on any plan, from a date, optionally until one. A family plan covers your family (staff
 * set families up). Dues are billed from the start date.
 */
create function public.res_start_membership(p_plan uuid, p_owner_code text default null, p_starts_on date default null, p_ends_on date default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  plan public.membership_plans;
  who uuid := uid;
  staff boolean;
  fam uuid;
  mm public.member_memberships;
begin
  select * into plan from public.membership_plans where id = p_plan and active;
  if not found then
    raise exception 'Plan not found.';
  end if;
  staff := public.res_is_staff(plan.club_id);
  if nullif(btrim(coalesce(p_owner_code, '')), '') is not null then
    perform public.res_require_staff(plan.club_id);
    select id into who from public.profiles where player_code = upper(btrim(p_owner_code));
    if who is null then
      raise exception 'No player has the ID %.', upper(btrim(p_owner_code));
    end if;
  elsif not plan.self_signup and not staff then
    raise exception 'Ask the front desk about this plan.';
  end if;
  insert into public.club_members (club_id, user_id) values (plan.club_id, who) on conflict do nothing;
  if exists (select 1 from public.res_active_memberships(plan.club_id, who) a where a.status = 'active' and a.plan_id = plan.id) then
    raise exception 'Already on this plan.';
  end if;
  if plan.max_members > 1 then
    select f.family_id into fam from public.family_members f join public.families fa on fa.id = f.family_id where fa.club_id = plan.club_id and f.user_id = who limit 1;
    if fam is not null and (select count(*) from public.family_members where family_id = fam) > plan.max_members then
      raise exception 'This plan covers up to % people; the family has more.', plan.max_members;
    end if;
  end if;
  insert into public.member_memberships (club_id, user_id, plan_id, family_id, starts_on, ends_on, next_bill_on, price_cents, created_by)
  values (plan.club_id, who, plan.id, fam, coalesce(p_starts_on, current_date), p_ends_on,
          case when plan.price_cents > 0 then coalesce(p_starts_on, current_date) end, plan.price_cents, uid)
  returning * into mm;
  return public.res_membership_json(mm);
end;
$$;

/** Cancels a membership: yours, or (staff) anyone's. It runs to the end of the period already billed. */
create function public.res_cancel_membership(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  mm public.member_memberships;
begin
  select * into mm from public.member_memberships where id = p_id;
  if not found then
    raise exception 'Membership not found.';
  end if;
  if mm.user_id <> uid then
    perform public.res_require_staff(mm.club_id);
  end if;
  update public.member_memberships set status = 'cancelled', cancelled_at = now(),
    ends_on = coalesce(ends_on, greatest(current_date, coalesce(next_bill_on, current_date + 1) - 1)), next_bill_on = null
  where id = p_id returning * into mm;
  return public.res_membership_json(mm);
end;
$$;

/** Admins: require an active membership to book courts, or not. */
create function public.res_set_require_membership(p_club uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  update public.clubs set require_membership = p_on where id = p_club;
end;
$$;

-- ---------------------------------------------------------------------------
-- Families, groups, ratings
-- ---------------------------------------------------------------------------

/** Staff: creates or changes a family: p.name, p.members [{code, relationship}] (replaces the list). */
create function public.res_save_family(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  fam uuid := nullif(p ->> 'id', '')::uuid;
  m jsonb;
  who uuid;
begin
  perform public.res_require_staff(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 60 then
    raise exception 'Name the family (e.g. The Riveras).';
  end if;
  if fam is null then
    insert into public.families (club_id, name) values (p_club, btrim(p ->> 'name')) returning id into fam;
  else
    update public.families set name = btrim(p ->> 'name') where id = fam and club_id = p_club;
    if not found then
      raise exception 'Family not found.';
    end if;
    delete from public.family_members where family_id = fam;
  end if;
  for m in select * from jsonb_array_elements(coalesce(p -> 'members', '[]')) loop
    select id into who from public.profiles where player_code = upper(btrim(m ->> 'code'));
    if who is null then
      raise exception 'No player has the ID %.', upper(btrim(m ->> 'code'));
    end if;
    -- One family per club.
    delete from public.family_members f using public.families fa where fa.id = f.family_id and fa.club_id = p_club and f.user_id = who and f.family_id <> fam;
    insert into public.club_members (club_id, user_id) values (p_club, who) on conflict do nothing;
    insert into public.family_members (family_id, user_id, relationship) values (fam, who, nullif(btrim(coalesce(m ->> 'relationship', '')), ''))
    on conflict do nothing;
  end loop;
  -- Family plans held by anyone in it cover the family.
  update public.member_memberships mm set family_id = fam
  from public.membership_plans pl
  where pl.id = mm.plan_id and pl.max_members > 1 and mm.club_id = p_club
    and mm.user_id in (select user_id from public.family_members where family_id = fam);
  return jsonb_build_object('id', fam);
end;
$$;

create function public.res_save_group(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 60 then
    raise exception 'Name the group.';
  end if;
  if p ? 'id' then
    update public.member_groups set name = btrim(p ->> 'name'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      visible = coalesce((p ->> 'visible')::boolean, visible) where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.member_groups (club_id, name, description, visible)
    values (p_club, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'description', '')), ''), coalesce((p ->> 'visible')::boolean, false));
  end if;
  return public.res_memberships(p_club);
end;
$$;

create function public.res_delete_group(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.member_groups where id = p_id;
  if club is null then
    raise exception 'Group not found.';
  end if;
  perform public.res_require_staff(club);
  delete from public.member_groups where id = p_id;
  return public.res_memberships(club);
end;
$$;

/** Joins or leaves a group: yourself (visible groups), or (staff) anyone by player ID. */
create function public.res_group_member(p_group uuid, p_join boolean, p_code text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  g public.member_groups;
  who uuid := uid;
begin
  select * into g from public.member_groups where id = p_group;
  if not found then
    raise exception 'Group not found.';
  end if;
  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    perform public.res_require_staff(g.club_id);
    select id into who from public.profiles where player_code = upper(btrim(p_code));
    if who is null then
      raise exception 'No player has the ID %.', upper(btrim(p_code));
    end if;
  elsif not g.visible and not public.res_is_staff(g.club_id) and p_join then
    raise exception 'Ask the club to add you to this group.';
  end if;
  if p_join then
    insert into public.club_members (club_id, user_id) values (g.club_id, who) on conflict do nothing;
    insert into public.group_members (group_id, user_id) values (g.id, who) on conflict do nothing;
  else
    delete from public.group_members where group_id = g.id and user_id = who;
  end if;
end;
$$;

/** Staff: a group's members. */
create function public.res_group_members(p_group uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.member_groups where id = p_group;
  perform public.res_require_staff(club);
  return coalesce((select jsonb_agg(jsonb_build_object('userId', u.id, 'name', u.first_name || ' ' || u.last_name, 'playerCode', u.player_code) order by u.last_name)
    from public.group_members x join public.profiles u on u.id = x.user_id where x.group_id = p_group), '[]'::jsonb);
end;
$$;

create function public.res_save_rating_scale(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
    raise exception 'Name the rating.';
  end if;
  if p ? 'id' then
    update public.rating_scales set name = btrim(p ->> 'name'), audience = coalesce(p ->> 'audience', audience),
      min_value = coalesce((p ->> 'min')::numeric, min_value), max_value = coalesce((p ->> 'max')::numeric, max_value), step = coalesce((p ->> 'step')::numeric, step)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.rating_scales (club_id, name, audience, min_value, max_value, step, sort_order)
    values (p_club, btrim(p ->> 'name'), coalesce(p ->> 'audience', 'all'), coalesce((p ->> 'min')::numeric, 1), coalesce((p ->> 'max')::numeric, 5),
            coalesce((p ->> 'step')::numeric, 0.5), (select coalesce(max(sort_order), 0) + 1 from public.rating_scales where club_id = p_club));
  end if;
  return public.res_memberships(p_club);
exception
  when check_violation then
    raise exception 'The highest rating must be above the lowest, with a step above 0.';
end;
$$;

create function public.res_delete_rating_scale(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.rating_scales where id = p_id;
  if club is null then
    raise exception 'Rating not found.';
  end if;
  perform public.res_require_manager(club);
  delete from public.rating_scales where id = p_id;
  return public.res_memberships(club);
end;
$$;

/** Staff: rates a member on one of the club's scales (null clears it). */
create function public.res_rate_member(p_scale uuid, p_user uuid, p_value numeric)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.rating_scales;
begin
  select * into s from public.rating_scales where id = p_scale;
  if not found then
    raise exception 'Rating not found.';
  end if;
  perform public.res_require_staff(s.club_id);
  if p_value is null then
    delete from public.member_ratings where scale_id = p_scale and user_id = p_user;
    return;
  end if;
  if p_value < s.min_value or p_value > s.max_value then
    raise exception '% goes from % to %.', s.name, trim_scale(s.min_value), trim_scale(s.max_value);
  end if;
  insert into public.member_ratings (scale_id, user_id, value, rated_by) values (p_scale, p_user, p_value, (select auth.uid()))
  on conflict (scale_id, user_id) do update set value = excluded.value, rated_by = excluded.rated_by, rated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Waivers
-- ---------------------------------------------------------------------------

/** Admins: adds or changes a waiver; changing its text asks everyone to sign again. */
create function public.res_save_waiver(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'title', ''))) not between 1 and 80 or btrim(coalesce(p ->> 'body', '')) = '' then
    raise exception 'Give the waiver a title and text.';
  end if;
  if p ? 'id' then
    update public.waivers set title = btrim(p ->> 'title'),
      version = case when body <> btrim(p ->> 'body') then version + 1 else version end,
      body = btrim(p ->> 'body'), required = coalesce((p ->> 'required')::boolean, required), active = coalesce((p ->> 'active')::boolean, active)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.waivers (club_id, title, body, required) values (p_club, btrim(p ->> 'title'), btrim(p ->> 'body'), coalesce((p ->> 'required')::boolean, true));
  end if;
  return public.res_memberships(p_club);
end;
$$;

/** Signs the current version of a waiver: your typed full name, and the drawn signature if there is one. */
create function public.res_sign_waiver(p_waiver uuid, p_name text, p_signature_svg text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  w public.waivers;
begin
  select * into w from public.waivers where id = p_waiver and active;
  if not found then
    raise exception 'Waiver not found.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Type your full name to sign.';
  end if;
  insert into public.club_members (club_id, user_id) values (w.club_id, uid) on conflict do nothing;
  insert into public.waiver_signatures (waiver_id, version, user_id, signed_name, signature_svg)
  values (w.id, w.version, uid, left(btrim(p_name), 80), nullif(p_signature_svg, ''))
  on conflict (waiver_id, version, user_id) do nothing;
  return public.res_memberships(w.club_id);
end;
$$;

/** Staff: who signed a waiver's current version, newest first. */
create function public.res_waiver_signatures(p_waiver uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  w public.waivers;
begin
  select * into w from public.waivers where id = p_waiver;
  perform public.res_require_staff(w.club_id);
  return coalesce((select jsonb_agg(jsonb_build_object('userId', s.user_id, 'name', u.first_name || ' ' || u.last_name, 'signedName', s.signed_name,
      'signedAt', public.epoch_ms(s.signed_at), 'signatureSvg', s.signature_svg) order by s.signed_at desc)
    from public.waiver_signatures s join public.profiles u on u.id = s.user_id where s.waiver_id = w.id and s.version = w.version), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in and email
-- ---------------------------------------------------------------------------

/** Staff (the desk or kiosk): checks a member into the club by player ID, reservation or not. */
create function public.res_member_checkin(p_club uuid, p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  who uuid;
  u public.profiles;
begin
  perform public.res_require_staff(p_club);
  select * into u from public.profiles where player_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'No player has the ID %.', upper(btrim(coalesce(p_code, '')));
  end if;
  who := u.id;
  insert into public.club_members (club_id, user_id) values (p_club, who) on conflict do nothing;
  insert into public.member_checkins (club_id, user_id, checked_in_by) values (p_club, who, (select auth.uid()));
  return jsonb_build_object(
    'name', public.display_name(u.first_name, u.last_name),
    'membership', (select p.name from public.res_active_memberships(p_club, who) a join public.membership_plans p on p.id = a.plan_id limit 1),
    'unsignedWaivers', public.res_unsigned_waivers(p_club, who),
    'balanceCents', coalesce((select sum(amount_cents) from public.ledger_entries where club_id = p_club and user_id = who), 0)
  );
end;
$$;

/**
 * Who an email goes to: members filtered by p.audience: 'all', 'active' (with a membership),
 * 'none' (without one), 'plan' (p.planIds) or 'group' (p.groupIds). Staff see the count;
 * the club-email function (secret key) gets the addresses.
 */
create function public.res_email_recipients(p_club uuid, p jsonb)
returns table (user_id uuid, email text, first_name text)
language sql stable security definer
set search_path = ''
as $$
  select m.user_id, a.email, u.first_name
  from public.club_members m
  join auth.users a on a.id = m.user_id
  join public.profiles u on u.id = m.user_id
  where m.club_id = p_club and a.email is not null
    and case coalesce(p ->> 'audience', 'all')
      when 'active' then exists (select 1 from public.res_active_memberships(p_club, m.user_id))
      when 'none' then not exists (select 1 from public.res_active_memberships(p_club, m.user_id))
      when 'plan' then exists (select 1 from public.res_active_memberships(p_club, m.user_id) a2 where a2.plan_id = any(public.res_uuids(p -> 'planIds')))
      when 'group' then exists (select 1 from public.group_members x where x.user_id = m.user_id and x.group_id = any(public.res_uuids(p -> 'groupIds')))
      else true end
$$;

create function public.res_email_audience_count(p_club uuid, p jsonb)
returns integer
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return (select count(*) from public.res_email_recipients(p_club, p));
end;
$$;

create function public.res_log_email(p_club uuid, p_subject text, p_body text, p_audience jsonb, p_recipients integer, p_by uuid)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.email_campaigns (club_id, subject, body, audience, recipients, sent_by)
  values (p_club, p_subject, p_body, p_audience, p_recipients, p_by)
$$;

create function public.res_email_history(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'subject', e.subject, 'recipients', e.recipients, 'sentAt', public.epoch_ms(e.sent_at),
      'sentBy', (select u.first_name || ' ' || u.last_name from public.profiles u where u.id = e.sent_by)) order by e.sent_at desc)
    from (select * from public.email_campaigns where club_id = p_club order by sent_at desc limit 100) e), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking: memberships and waivers
-- ---------------------------------------------------------------------------

/**
 * Books a court (as before, plus memberships: a club can require one, a plan's perks loosen the
 * booking rules, and required waivers must be signed). Members book for themselves within the club's rules. Staff can book for a
 * member (p_owner_code, their player ID, which also adds them to the club) or for no one
 * (p_no_owner, e.g. a clinic), and aren't held to the rules; nobody can book over another
 * reservation or a closure. Other players come from their player IDs, guests by name.
 */
create or replace function public.res_book(
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
  plan_advance integer;
  plan_upcoming integer;
  plan_per_day integer;
  unsigned text;
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
    -- Membership: required to book when the club says so, and a plan's perks loosen the rules.
    if club.require_membership and not exists (select 1 from public.res_active_memberships(club.id, uid)) then
      raise exception 'Booking at % needs a membership. See Membership to join.', club.name;
    end if;
    select max(pl.advance_days), max(pl.max_upcoming), max(pl.max_per_day) into plan_advance, plan_upcoming, plan_per_day
    from public.res_active_memberships(club.id, uid) a join public.membership_plans pl on pl.id = a.plan_id;
    club.advance_days := greatest(club.advance_days, coalesce(plan_advance, 0));
    club.max_upcoming := greatest(club.max_upcoming, coalesce(plan_upcoming, 0));
    club.max_per_day := greatest(club.max_per_day, coalesce(plan_per_day, 0));
    unsigned := public.res_unsigned_waivers(club.id, uid);
    if unsigned is not null then
      raise exception 'Please sign % first (under Membership).', unsigned;
    end if;
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

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_active_memberships(uuid, uuid), public.res_unsigned_waivers(uuid, uuid), public.res_period_interval(text),
  public.res_membership_json(public.member_memberships), public.res_memberships(uuid), public.res_member_profile(uuid, uuid),
  public.res_save_plan(uuid, jsonb), public.res_delete_plan(uuid), public.res_start_membership(uuid, text, date, date),
  public.res_cancel_membership(uuid), public.res_set_require_membership(uuid, boolean), public.res_save_family(uuid, jsonb),
  public.res_save_group(uuid, jsonb), public.res_delete_group(uuid), public.res_group_member(uuid, boolean, text), public.res_group_members(uuid),
  public.res_save_rating_scale(uuid, jsonb), public.res_delete_rating_scale(uuid), public.res_rate_member(uuid, uuid, numeric),
  public.res_save_waiver(uuid, jsonb), public.res_sign_waiver(uuid, text, text), public.res_waiver_signatures(uuid),
  public.res_member_checkin(uuid, text), public.res_email_recipients(uuid, jsonb), public.res_email_audience_count(uuid, jsonb),
  public.res_log_email(uuid, text, text, jsonb, integer, uuid), public.res_email_history(uuid)
from public, anon, authenticated;

grant execute on function
  public.res_memberships(uuid), public.res_member_profile(uuid, uuid),
  public.res_save_plan(uuid, jsonb), public.res_delete_plan(uuid), public.res_start_membership(uuid, text, date, date),
  public.res_cancel_membership(uuid), public.res_set_require_membership(uuid, boolean), public.res_save_family(uuid, jsonb),
  public.res_save_group(uuid, jsonb), public.res_delete_group(uuid), public.res_group_member(uuid, boolean, text), public.res_group_members(uuid),
  public.res_save_rating_scale(uuid, jsonb), public.res_delete_rating_scale(uuid), public.res_rate_member(uuid, uuid, numeric),
  public.res_save_waiver(uuid, jsonb), public.res_sign_waiver(uuid, text, text), public.res_waiver_signatures(uuid),
  public.res_member_checkin(uuid, text), public.res_email_audience_count(uuid, jsonb), public.res_email_history(uuid)
to authenticated;
grant execute on function public.res_email_recipients(uuid, jsonb), public.res_log_email(uuid, text, text, jsonb, integer, uuid) to service_role;
