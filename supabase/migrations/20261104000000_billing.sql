-- Batch billing and invoicing.
--
-- The ledger (pro shop migration) now fills itself: lesson and court prices on reservations,
-- event registrations and strike fees become charges, payments at the desk or online become
-- payments, and cancelling reverses a charge (a late cancellation keeps it). Each source keeps
-- its ledger entries in step with it, so editing a price or marking something paid just
-- posts the difference.
--
-- A billing run bills membership dues that have come due, then turns each member's unbilled
-- entries into an invoice (draft to review, or issued straight away). Invoices carry the
-- club's template (color, header, payment instructions); staff record payments, members pay
-- online and can save a card for autopay, which staff run as a batch (club-payments).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.clubs
  add column invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9-]{1,8}$'),
  add column invoice_due_days integer not null default 15 check (invoice_due_days between 0 and 90),
  add column invoice_color text not null default '#0A8754' check (invoice_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column invoice_header text check (char_length(invoice_header) <= 200),
  -- How to pay: shown at the bottom of every invoice.
  add column invoice_footer text check (char_length(invoice_footer) <= 1000);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  number integer not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'paid', 'void')),
  period_end date not null,
  issued_on date,
  due_on date,
  total_cents integer not null,
  paid_cents integer not null default 0,
  note text check (char_length(note) <= 500),
  stripe_session_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, number)
);

create index invoices_club on public.invoices (club_id, status, created_at desc);
create index invoices_member on public.invoices (club_id, user_id);

alter table public.ledger_entries add column invoice_id uuid references public.invoices (id) on delete set null;
create index ledger_entries_unbilled on public.ledger_entries (club_id, user_id) where invoice_id is null;

-- A member's saved card at a club (on the club's Stripe account), for autopay.
create table public.billing_profiles (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  payment_method_id text,
  card_label text,
  autopay boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table public.invoices enable row level security;
alter table public.billing_profiles enable row level security;
revoke all on public.invoices, public.billing_profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keeping the ledger in step with what members owe
-- ---------------------------------------------------------------------------

/**
 * Posts whatever brings a source's ledger entries of some kinds to the amount they should
 * total (a charge if more is owed, a credit if less).
 */
create function public.res_ledger_sync(p_club uuid, p_user uuid, p_kind text, p_kinds text[], p_source_type text, p_source uuid,
                                       p_should integer, p_description text, p_credit_description text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  have integer;
begin
  if p_user is null then
    return;
  end if;
  select coalesce(sum(amount_cents), 0) into have from public.ledger_entries
  where source_type = p_source_type and source_id = p_source and kind = any(p_kinds);
  if have <> p_should then
    insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, source_type, source_id, created_by)
    values (p_club, p_user, p_kind, left(case when p_should > have then p_description else p_credit_description end, 200),
            p_should - have, p_source_type, p_source, (select auth.uid()));
  end if;
end;
$$;

/** Reservations with a price (lessons, court fees) owed by their owner; online public bookings are paid on Stripe and stay out. */
create function public.res_ledger_reservation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  label text := coalesce(new.title, 'Reservation') || ' · ' ||
    to_char(new.starts_at at time zone (select timezone from public.clubs where id = new.club_id), 'Mon FMDD');
  kind text := case when new.instructor_id is not null then 'lesson' else 'reservation' end;
begin
  if new.owner_id is null or new.public_token is not null or new.clinic_id is not null then
    return new;
  end if;
  perform public.res_ledger_sync(new.club_id, new.owner_id, kind, array['lesson', 'reservation'], 'reservation', new.id,
    case when new.status = 'booked' or (new.status = 'cancelled' and new.late_cancel) then new.amount_cents else 0 end,
    label, 'Cancelled: ' || label);
  perform public.res_ledger_sync(new.club_id, new.owner_id, 'payment', array['payment'], 'reservation', new.id,
    -new.paid_cents, 'Refund: ' || label, 'Paid: ' || label);
  return new;
end;
$$;

create trigger reservations_ledger
  after insert or update of status, amount_cents, paid_cents, late_cancel on public.reservations
  for each row execute function public.res_ledger_reservation();

/** Event and clinic registrations owe their price once registered (paying online posts the payment too). */
create function public.res_ledger_registration()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  cl public.clinics;
  label text;
begin
  select * into cl from public.clinics where id = new.clinic_id;
  label := cl.title || case when new.reservation_id is not null then ' (drop-in)' else '' end;
  perform public.res_ledger_sync(cl.club_id, new.user_id, 'event', array['event'], 'registration', new.id,
    case when new.status = 'registered' then new.amount_cents else 0 end, label, 'Cancelled: ' || label);
  perform public.res_ledger_sync(cl.club_id, new.user_id, 'payment', array['payment'], 'registration', new.id,
    -new.paid_cents, 'Refund: ' || label, 'Paid: ' || label);
  return new;
end;
$$;

create trigger clinic_registrations_ledger
  after insert or update of status, amount_cents, paid_cents on public.clinic_registrations
  for each row execute function public.res_ledger_registration();

/** Late cancellation and no-show fees, until waived. */
create function public.res_ledger_strike()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  label text := case new.kind when 'late_cancel' then 'Late cancellation fee' else 'No-show fee' end;
begin
  perform public.res_ledger_sync(new.club_id, new.user_id, 'fee', array['fee'], 'strike', new.id,
    case when new.waived_at is null then new.fee_cents else 0 end, label, 'Waived: ' || label);
  return new;
end;
$$;

create trigger booking_strikes_ledger
  after insert or update of waived_at, fee_cents on public.booking_strikes
  for each row execute function public.res_ledger_strike();

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create function public.res_invoice_json(i public.invoices, p_lines boolean)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'userId', i.user_id, 'number', k.invoice_prefix || '-' || i.number, 'status',
    case when i.status = 'open' and i.due_on < current_date then 'overdue' else i.status end,
    'periodEnd', to_char(i.period_end, 'YYYY-MM-DD'), 'issuedOn', to_char(i.issued_on, 'YYYY-MM-DD'), 'dueOn', to_char(i.due_on, 'YYYY-MM-DD'),
    'totalCents', i.total_cents, 'paidCents', i.paid_cents, 'note', i.note, 'paidAt', public.epoch_ms(i.paid_at),
    'memberName', u.first_name || ' ' || u.last_name, 'playerCode', u.player_code,
    'email', (select a.email from auth.users a where a.id = i.user_id),
    'autopay', exists (select 1 from public.billing_profiles b where b.club_id = i.club_id and b.user_id = i.user_id and b.autopay and b.payment_method_id is not null),
    'lines', case when p_lines then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'description', e.description,
        'amountCents', e.amount_cents, 'date', to_char(e.created_at at time zone k.timezone, 'YYYY-MM-DD')) order by e.created_at)
      from public.ledger_entries e where e.invoice_id = i.id), '[]'::jsonb) end,
    'club', case when p_lines then jsonb_build_object('name', k.name, 'address', k.address, 'color', k.invoice_color, 'header', k.invoice_header,
      'footer', k.invoice_footer, 'currency', k.currency, 'slug', k.slug, 'paymentsReady', k.stripe_account_id is not null and k.stripe_charges_enabled) end
  )
  from public.clubs k, public.profiles u where k.id = i.club_id and u.id = i.user_id
$$;

/**
 * Staff: runs billing through a day. Membership dues that have come due by then are charged
 * (and the next billing date moved on), then each member's unbilled entries up to then become
 * one invoice, if they owe anything. p_issue issues them straight away; otherwise they're
 * drafts to review.
 */
create function public.res_run_billing(p_club uuid, p_through date, p_issue boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.clubs;
  mm record;
  bill_on date;
  next_on date;
  dues integer := 0;
  member record;
  inv public.invoices;
  num integer;
  made integer := 0;
  total integer := 0;
  cutoff timestamptz;
begin
  perform public.res_require_manager(p_club);
  select * into k from public.clubs where id = p_club;
  perform pg_advisory_xact_lock(hashtextextended('billing' || p_club::text, 0));
  cutoff := (p_through + 1)::timestamp at time zone k.timezone;

  -- Dues.
  for mm in
    select m.*, p.name plan_name, p.period from public.member_memberships m join public.membership_plans p on p.id = m.plan_id
    where m.club_id = p_club and m.next_bill_on is not null and m.next_bill_on <= p_through and m.price_cents > 0
  loop
    bill_on := mm.next_bill_on;
    while bill_on is not null and bill_on <= p_through and (mm.ends_on is null or bill_on <= mm.ends_on) loop
      next_on := (bill_on + public.res_period_interval(mm.period))::date;
      insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, source_type, source_id, created_by, created_at)
      values (p_club, mm.user_id, 'membership',
              left(mm.plan_name || ' dues' || case when next_on is null then '' else ' · ' || to_char(bill_on, 'Mon FMDD') || ' – ' || to_char(next_on - 1, 'Mon FMDD, YYYY') end, 200),
              mm.price_cents, 'membership', mm.id, (select auth.uid()), least(now(), cutoff - interval '1 second'));
      dues := dues + 1;
      bill_on := next_on;
    end loop;
    update public.member_memberships set next_bill_on = case when mm.ends_on is not null and bill_on > mm.ends_on then null else bill_on end where id = mm.id;
  end loop;

  -- Invoices.
  for member in
    select e.user_id, sum(e.amount_cents) owed from public.ledger_entries e
    where e.club_id = p_club and e.invoice_id is null and e.created_at < cutoff
    group by e.user_id having sum(e.amount_cents) > 0
  loop
    select coalesce(max(number), 1000) + 1 into num from public.invoices where club_id = p_club;
    insert into public.invoices (club_id, user_id, number, status, period_end, issued_on, due_on, total_cents)
    values (p_club, member.user_id, num, case when p_issue then 'open' else 'draft' end, p_through,
            case when p_issue then current_date end, case when p_issue then current_date + k.invoice_due_days end, member.owed)
    returning * into inv;
    update public.ledger_entries set invoice_id = inv.id
    where club_id = p_club and user_id = member.user_id and invoice_id is null and created_at < cutoff;
    if p_issue then
      perform public.res_notify(p_club, member.user_id, 'New invoice from ' || k.name,
        to_char(member.owed / 100.0, 'FM$999,999,990.00') || ' due ' || to_char(inv.due_on, 'Mon FMDD'), '/c/' || k.slug || '/billing');
    end if;
    made := made + 1;
    total := total + member.owed;
  end loop;

  return jsonb_build_object('invoices', made, 'totalCents', total, 'dues', dues);
end;
$$;

/** Staff: invoices, newest first (up to 500), by status ('overdue' too) or member search, with totals. */
create function public.res_invoices(p_club uuid, p_status text default null, p_query text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
      select i.created_at, public.res_invoice_json(i, false) j from public.invoices i join public.profiles u on u.id = i.user_id
      where i.club_id = p_club
        and (p_status is null or (p_status = 'overdue' and i.status = 'open' and i.due_on < current_date) or i.status = p_status)
        and (btrim(coalesce(p_query, '')) = '' or (u.first_name || ' ' || u.last_name) ilike '%' || btrim(p_query) || '%' or u.player_code = upper(btrim(p_query)))
      order by i.created_at desc limit 500) x), '[]'::jsonb),
    'outstandingCents', (select coalesce(sum(total_cents - paid_cents), 0) from public.invoices where club_id = p_club and status = 'open'),
    'overdueCents', (select coalesce(sum(total_cents - paid_cents), 0) from public.invoices where club_id = p_club and status = 'open' and due_on < current_date),
    'draftCount', (select count(*) from public.invoices where club_id = p_club and status = 'draft'),
    'collectedThisMonthCents', (select coalesce(-sum(e.amount_cents), 0) from public.ledger_entries e
      where e.club_id = p_club and e.kind = 'payment' and e.created_at >= date_trunc('month', now())),
    'unbilledCents', (select coalesce(sum(amount_cents), 0) from public.ledger_entries where club_id = p_club and invoice_id is null)
  );
end;
$$;

/** One invoice with its lines and the club's template: staff, or the member it's for. */
create function public.res_invoice(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where id = p_id;
  if not found or (i.user_id <> (select auth.uid()) and not public.res_is_staff(i.club_id)) or (i.status = 'draft' and not public.res_is_staff(i.club_id)) then
    raise exception 'Invoice not found.';
  end if;
  return public.res_invoice_json(i, true);
end;
$$;

/** Your invoices at a club (not drafts), your balance and whether autopay is on. */
create function public.res_my_billing(p_club uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(public.res_invoice_json(i, false) order by i.created_at desc) from public.invoices i
      where i.club_id = p_club and i.user_id = (select auth.uid()) and i.status <> 'draft'), '[]'::jsonb),
    'balanceCents', coalesce((select sum(amount_cents) from public.ledger_entries where club_id = p_club and user_id = (select auth.uid())), 0),
    'autopay', (select jsonb_build_object('on', b.autopay, 'card', b.card_label) from public.billing_profiles b where b.club_id = p_club and b.user_id = (select auth.uid()))
  )
$$;

/** Staff: issues drafts (all, or the ones given): they're due after the club's terms, and members are told. */
create function public.res_issue_invoices(p_club uuid, p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.clubs;
  i public.invoices;
  n integer := 0;
begin
  perform public.res_require_staff(p_club);
  select * into k from public.clubs where id = p_club;
  for i in update public.invoices set status = 'open', issued_on = current_date, due_on = current_date + k.invoice_due_days
           where club_id = p_club and status = 'draft' and (p_ids is null or id = any(p_ids)) returning * loop
    perform public.res_notify(p_club, i.user_id, 'New invoice from ' || k.name,
      to_char(i.total_cents / 100.0, 'FM$999,999,990.00') || ' due ' || to_char(i.due_on, 'Mon FMDD'), '/c/' || k.slug || '/billing');
    n := n + 1;
  end loop;
  return n;
end;
$$;

/** Records a payment on an invoice (staff at the desk, or online through the payment functions). */
create function public.res_pay_invoice(p_invoice uuid, p_cents integer, p_method text, p_by uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.invoices;
  k public.clubs;
begin
  select * into i from public.invoices where id = p_invoice for update;
  select * into k from public.clubs where id = i.club_id;
  if i.status not in ('open', 'draft') then
    raise exception 'This invoice is %.', i.status;
  end if;
  if p_cents is null or p_cents <= 0 then
    raise exception 'Enter the amount paid.';
  end if;
  insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, source_type, source_id, invoice_id, created_by)
  values (i.club_id, i.user_id, 'payment', 'Payment (' || p_method || ') on ' || k.invoice_prefix || '-' || i.number, -p_cents, 'invoice', i.id, i.id, p_by);
  update public.invoices set paid_cents = paid_cents + p_cents,
    status = case when paid_cents + p_cents >= total_cents then 'paid' else status end,
    paid_at = case when paid_cents + p_cents >= total_cents then now() else paid_at end
  where id = i.id returning * into i;
  return public.res_invoice_json(i, false);
end;
$$;

/** Staff: records a payment taken at the desk (cash, check, card on the terminal…). */
create function public.res_record_payment(p_invoice uuid, p_cents integer, p_method text default 'cash')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.invoices where id = p_invoice;
  if club is null then
    raise exception 'Invoice not found.';
  end if;
  perform public.res_require_staff(club);
  return public.res_pay_invoice(p_invoice, p_cents, coalesce(nullif(btrim(p_method), ''), 'cash'), (select auth.uid()));
end;
$$;

/** Staff: voids an invoice; its charges go back to unbilled for the next run (payments on it stay recorded). */
create function public.res_void_invoice(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where id = p_id;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  perform public.res_require_staff(i.club_id);
  if i.paid_cents > 0 then
    raise exception 'This invoice has payments on it; record a credit instead.';
  end if;
  update public.invoices set status = 'void' where id = p_id;
  update public.ledger_entries set invoice_id = null where invoice_id = p_id;
end;
$$;

/** Staff: adds a one-off charge or credit to a member's account (negative for a credit). */
create function public.res_adjust_account(p_club uuid, p_user uuid, p_cents integer, p_description text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  if p_cents is null or p_cents = 0 or char_length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Enter an amount and a description.';
  end if;
  insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, created_by)
  values (p_club, p_user, 'adjustment', left(btrim(p_description), 200), p_cents, (select auth.uid()));
end;
$$;

/** Admins: the invoice template and terms. */
create function public.res_save_invoice_settings(p_club uuid, p jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  update public.clubs set
    invoice_prefix = coalesce(upper(nullif(btrim(p ->> 'prefix'), '')), invoice_prefix),
    invoice_due_days = coalesce((p ->> 'dueDays')::integer, invoice_due_days),
    invoice_color = coalesce(p ->> 'color', invoice_color),
    invoice_header = case when p ? 'header' then nullif(btrim(coalesce(p ->> 'header', '')), '') else invoice_header end,
    invoice_footer = case when p ? 'footer' then nullif(btrim(coalesce(p ->> 'footer', '')), '') else invoice_footer end
  where id = p_club;
exception
  when check_violation then
    raise exception 'The prefix is up to 8 capital letters, numbers or dashes; terms are 0–90 days.';
end;
$$;

create function public.res_invoice_settings(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return (select jsonb_build_object('prefix', invoice_prefix, 'dueDays', invoice_due_days, 'color', invoice_color, 'header', invoice_header, 'footer', invoice_footer)
          from public.clubs where id = p_club);
end;
$$;

-- ---------------------------------------------------------------------------
-- Online payment and autopay (the club-payments function, with the secret key)
-- ---------------------------------------------------------------------------

/** What it takes to charge an invoice online, for its member. */
create function public.res_invoice_checkout_info(p_invoice uuid, p_user uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('invoiceId', i.id, 'number', k.invoice_prefix || '-' || i.number, 'dueCents', i.total_cents - i.paid_cents,
    'clubName', k.name, 'slug', k.slug, 'currency', k.currency, 'stripeAccount', k.stripe_account_id,
    'customer', (select b.stripe_customer_id from public.billing_profiles b where b.club_id = i.club_id and b.user_id = i.user_id),
    'email', (select email from auth.users where id = i.user_id))
  from public.invoices i join public.clubs k on k.id = i.club_id
  where i.id = p_invoice and i.user_id = p_user and i.status = 'open'
$$;

create function public.res_attach_invoice_session(p_invoice uuid, p_session text)
returns void
language sql security definer
set search_path = ''
as $$ update public.invoices set stripe_session_id = p_session where id = p_invoice $$;

/** A Checkout session for an invoice was paid: records it (once), and saves the card for autopay when asked. */
create function public.res_invoice_paid_online(p_session text, p_cents integer, p_customer text, p_payment_method text, p_card text, p_autopay boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where stripe_session_id = p_session;
  if not found then
    return null;
  end if;
  if p_customer is not null then
    insert into public.billing_profiles (club_id, user_id, stripe_customer_id, payment_method_id, card_label, autopay)
    values (i.club_id, i.user_id, p_customer, p_payment_method, p_card, coalesce(p_autopay, false))
    on conflict (club_id, user_id) do update set stripe_customer_id = excluded.stripe_customer_id,
      payment_method_id = coalesce(excluded.payment_method_id, billing_profiles.payment_method_id),
      card_label = coalesce(excluded.card_label, billing_profiles.card_label),
      autopay = billing_profiles.autopay or excluded.autopay, updated_at = now();
  end if;
  if i.status = 'open' then
    return public.res_pay_invoice(i.id, p_cents, 'online', i.user_id);
  end if;
  return public.res_invoice_json(i, false);
end;
$$;

/** Open invoices of members with autopay on: what the autopay run charges. */
create function public.res_autopay_due(p_club uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('invoiceId', i.id, 'dueCents', i.total_cents - i.paid_cents, 'customer', b.stripe_customer_id,
    'paymentMethod', b.payment_method_id, 'userId', i.user_id, 'number', k.invoice_prefix || '-' || i.number, 'currency', k.currency,
    'stripeAccount', k.stripe_account_id)), '[]'::jsonb)
  from public.invoices i join public.billing_profiles b on b.club_id = i.club_id and b.user_id = i.user_id and b.autopay and b.payment_method_id is not null
  join public.clubs k on k.id = i.club_id
  where i.club_id = p_club and i.status = 'open' and i.total_cents > i.paid_cents
$$;

/** Turns your autopay off (or on, when you've saved a card). */
create function public.res_set_autopay(p_club uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.billing_profiles set autopay = p_on and payment_method_id is not null, updated_at = now()
  where club_id = p_club and user_id = public.res_require_user();
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk payments post to the ledger
-- ---------------------------------------------------------------------------

/** As before; the ledger triggers record the payment against the lesson or registration. */
comment on function public.res_set_paid(uuid, uuid, integer) is 'Staff: records what''s been paid for a lesson or registration; the ledger follows.';

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_ledger_sync(uuid, uuid, text, text[], text, uuid, integer, text, text), public.res_ledger_reservation(),
  public.res_ledger_registration(), public.res_ledger_strike(), public.res_invoice_json(public.invoices, boolean),
  public.res_run_billing(uuid, date, boolean), public.res_invoices(uuid, text, text), public.res_invoice(uuid), public.res_my_billing(uuid),
  public.res_issue_invoices(uuid, uuid[]), public.res_pay_invoice(uuid, integer, text, uuid), public.res_record_payment(uuid, integer, text),
  public.res_void_invoice(uuid), public.res_adjust_account(uuid, uuid, integer, text), public.res_save_invoice_settings(uuid, jsonb),
  public.res_invoice_settings(uuid), public.res_invoice_checkout_info(uuid, uuid), public.res_attach_invoice_session(uuid, text),
  public.res_invoice_paid_online(text, integer, text, text, text, boolean), public.res_autopay_due(uuid), public.res_set_autopay(uuid, boolean)
from public, anon, authenticated;

grant execute on function
  public.res_run_billing(uuid, date, boolean), public.res_invoices(uuid, text, text), public.res_invoice(uuid), public.res_my_billing(uuid),
  public.res_issue_invoices(uuid, uuid[]), public.res_record_payment(uuid, integer, text), public.res_void_invoice(uuid),
  public.res_adjust_account(uuid, uuid, integer, text), public.res_save_invoice_settings(uuid, jsonb), public.res_invoice_settings(uuid),
  public.res_set_autopay(uuid, boolean)
to authenticated;
grant execute on function
  public.res_invoice_checkout_info(uuid, uuid), public.res_attach_invoice_session(uuid, text),
  public.res_invoice_paid_online(text, integer, text, text, text, boolean), public.res_autopay_due(uuid), public.res_pay_invoice(uuid, integer, text, uuid)
to service_role;

-- Bring what's already booked into the ledger.
update public.reservations set amount_cents = amount_cents where amount_cents > 0 or paid_cents > 0;
update public.clinic_registrations set amount_cents = amount_cents where amount_cents > 0 or paid_cents > 0;
update public.booking_strikes set fee_cents = fee_cents where fee_cents > 0;
