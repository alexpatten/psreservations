-- Pro Shop & Point of Sale: products with stock tracking and reorder alerts, categories,
-- included or added tax rates, and a register that sells products and custom items (court
-- time, snacks) with line and cart discounts, paid by cash, card or charged to a member's
-- account.
--
-- Also the club ledger, which later features build on: every charge to a member's account
-- (pro shop, lessons, events, dues) is a positive entry and every payment or credit a
-- negative one, so a member's balance is the sum. Batch billing turns unbilled entries into
-- invoices.
--
-- Same security model as the rest: RLS with no policies; staff use the res_* functions.

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('pos', 'lesson', 'clinic', 'event', 'membership', 'reservation', 'fee', 'adjustment', 'payment', 'refund')),
  description text not null check (char_length(description) between 1 and 200),
  -- Charges are positive; payments and credits negative.
  amount_cents integer not null,
  source_type text,
  source_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index ledger_entries_member on public.ledger_entries (club_id, user_id, created_at);
create index ledger_entries_source on public.ledger_entries (source_type, source_id);

alter table public.ledger_entries enable row level security;
revoke all on public.ledger_entries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- Basis points: 825 is 8.25%.
  rate_bp integer not null check (rate_bp between 0 and 5000),
  -- Included in the price (VAT-style) or added on top (US sales tax).
  inclusive boolean not null default false,
  active boolean not null default true
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  category_id uuid references public.product_categories (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  sku text check (char_length(sku) <= 40),
  barcode text check (char_length(barcode) <= 64),
  price_cents integer not null check (price_cents between 0 and 10000000),
  cost_cents integer check (cost_cents between 0 and 10000000),
  tax_rate_id uuid references public.tax_rates (id) on delete set null,
  track_inventory boolean not null default true,
  stock integer not null default 0,
  -- Alert when stock falls to this many or fewer.
  reorder_level integer check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index products_club on public.products (club_id, category_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  number integer not null,
  -- A member, or a walk-in.
  user_id uuid references auth.users (id) on delete set null,
  customer_name text check (char_length(customer_name) <= 80),
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null,
  payment_method text not null check (payment_method in ('cash', 'card', 'account', 'other')),
  tendered_cents integer,
  status text not null default 'completed' check (status in ('completed', 'refunded')),
  note text check (char_length(note) <= 200),
  staff_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  refunded_at timestamptz,
  unique (club_id, number)
);

create index sales_club on public.sales (club_id, created_at);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  category_id uuid references public.product_categories (id) on delete set null,
  name text not null,
  quantity integer not null check (quantity between 1 and 10000),
  unit_price_cents integer not null,
  -- The line's own discount plus its share of the cart discount.
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null
);

create index sale_items_sale on public.sale_items (sale_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  change integer not null,
  reason text not null check (reason in ('sale', 'restock', 'adjustment', 'refund')),
  sale_id uuid references public.sales (id) on delete set null,
  note text check (char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_movements_product on public.inventory_movements (product_id, created_at);

alter table public.tax_rates enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;
revoke all on public.tax_rates, public.product_categories, public.products, public.sales, public.sale_items, public.inventory_movements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create function public.res_product_json(p public.products)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'categoryId', p.category_id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode,
    'priceCents', p.price_cents, 'costCents', p.cost_cents, 'taxRateId', p.tax_rate_id,
    'trackInventory', p.track_inventory, 'stock', p.stock, 'reorderLevel', p.reorder_level,
    'low', p.track_inventory and p.reorder_level is not null and p.stock <= p.reorder_level
  )
$$;

/** Staff: the register's catalog: categories, products (with stock and low-stock flags) and tax rates. */
create function public.res_pos(p_club uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'sortOrder', c.sort_order) order by c.sort_order, c.name)
                            from public.product_categories c where c.club_id = p_club), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(public.res_product_json(p) order by p.name) from public.products p where p.club_id = p_club and p.active), '[]'::jsonb),
    'taxRates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'rateBp', t.rate_bp, 'inclusive', t.inclusive) order by t.name)
                          from public.tax_rates t where t.club_id = p_club and t.active), '[]'::jsonb),
    'lowStock', (select count(*) from public.products p where p.club_id = p_club and p.active and p.track_inventory
                 and p.reorder_level is not null and p.stock <= p.reorder_level)
  );
end;
$$;

create function public.res_sale_json(s public.sales)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'number', s.number, 'userId', s.user_id,
    'customerName', coalesce((select u.first_name || ' ' || u.last_name from public.profiles u where u.id = s.user_id), s.customer_name),
    'subtotalCents', s.subtotal_cents, 'discountCents', s.discount_cents, 'taxCents', s.tax_cents, 'totalCents', s.total_cents,
    'paymentMethod', s.payment_method, 'tenderedCents', s.tendered_cents, 'status', s.status, 'note', s.note,
    'staffName', (select u.first_name || ' ' || u.last_name from public.profiles u where u.id = s.staff_id),
    'createdAt', public.epoch_ms(s.created_at),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'productId', i.product_id, 'name', i.name, 'quantity', i.quantity, 'unitPriceCents', i.unit_price_cents,
      'discountCents', i.discount_cents, 'taxCents', i.tax_cents, 'totalCents', i.total_cents
    ) order by i.name) from public.sale_items i where i.sale_id = s.id), '[]'::jsonb)
  )
$$;

/**
 * Staff: sales between two moments (newest first, up to 500) with a summary: gross, refunds,
 * discounts, taxes, net, by payment method, by category and the best sellers.
 */
create function public.res_sales(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.res_require_staff(p_club);
  return jsonb_build_object(
    'sales', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
      select s.created_at, public.res_sale_json(s) j from public.sales s
      where s.club_id = p_club and s.created_at >= p_from and s.created_at < p_to order by s.created_at desc limit 500) x), '[]'::jsonb),
    'summary', (
      select jsonb_build_object(
        'count', count(*) filter (where s.status = 'completed'),
        'grossCents', coalesce(sum(s.subtotal_cents), 0),
        'refundCents', coalesce(sum(s.total_cents) filter (where s.status = 'refunded'), 0),
        'discountCents', coalesce(sum(s.discount_cents) filter (where s.status = 'completed'), 0),
        'taxCents', coalesce(sum(s.tax_cents) filter (where s.status = 'completed'), 0),
        'netCents', coalesce(sum(s.total_cents - s.tax_cents) filter (where s.status = 'completed'), 0),
        'byMethod', coalesce((select jsonb_object_agg(m.payment_method, m.total) from (
          select x.payment_method, sum(x.total_cents) total from public.sales x
          where x.club_id = p_club and x.status = 'completed' and x.created_at >= p_from and x.created_at < p_to group by 1) m), '{}'::jsonb)
      )
      from public.sales s where s.club_id = p_club and s.created_at >= p_from and s.created_at < p_to
    ),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'totalCents', x.total, 'quantity', x.qty) order by x.total desc) from (
      select coalesce(c.name, 'Other') name, sum(i.total_cents - i.tax_cents) total, sum(i.quantity) qty
      from public.sale_items i join public.sales s on s.id = i.sale_id
      left join public.product_categories c on c.id = i.category_id
      where s.club_id = p_club and s.status = 'completed' and s.created_at >= p_from and s.created_at < p_to group by 1) x), '[]'::jsonb),
    'topItems', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'totalCents', x.total, 'quantity', x.qty) order by x.total desc) from (
      select i.name, sum(i.total_cents - i.tax_cents) total, sum(i.quantity) qty
      from public.sale_items i join public.sales s on s.id = i.sale_id
      where s.club_id = p_club and s.status = 'completed' and s.created_at >= p_from and s.created_at < p_to
      group by 1 order by 2 desc limit 10) x), '[]'::jsonb)
  );
end;
$$;

/** A member's account: balance (charges less payments) and recent entries. Staff for anyone; members for themselves. */
create function public.res_account(p_club uuid, p_user uuid default null)
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
  return jsonb_build_object(
    'balanceCents', coalesce((select sum(amount_cents) from public.ledger_entries where club_id = p_club and user_id = who), 0),
    'entries', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
      select e.created_at, jsonb_build_object('id', e.id, 'kind', e.kind, 'description', e.description, 'amountCents', e.amount_cents,
        'createdAt', public.epoch_ms(e.created_at), 'sourceType', e.source_type, 'sourceId', e.source_id) j
      from public.ledger_entries e where e.club_id = p_club and e.user_id = who order by e.created_at desc limit 200) x), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Selling
-- ---------------------------------------------------------------------------

/**
 * Staff: rings up a sale. p.items: [{productId} or {name, unitPriceCents}, quantity,
 * discountCents]; p.discountCents (the whole cart), p.customerCode (a member's player ID),
 * p.customerName (a walk-in), p.paymentMethod (cash, card, account, other), p.tenderedCents
 * (cash), p.note. Taxes come from each product's rate (custom items: p.taxRateId). Stock
 * goes down for tracked products. Charging to account needs a member and adds it to their
 * balance.
 */
create function public.res_checkout(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.res_require_user();
  item jsonb;
  prod public.products;
  rate public.tax_rates;
  customer uuid;
  method text := coalesce(p ->> 'paymentMethod', 'cash');
  lines jsonb := '[]';
  line jsonb;
  qty integer;
  unit integer;
  line_discount integer;
  base integer;
  subtotal integer := 0;
  item_discounts integer := 0;
  cart_discount integer := greatest(coalesce((p ->> 'discountCents')::integer, 0), 0);
  after_item integer;
  share integer;
  given integer := 0;
  n integer := 0;
  tax integer;
  tax_total integer := 0;
  total integer := 0;
  sale public.sales;
  num integer;
begin
  perform public.res_require_staff(p_club);
  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then
    raise exception 'The cart is empty.';
  end if;
  if method not in ('cash', 'card', 'account', 'other') then
    raise exception 'Choose how they''re paying.';
  end if;
  if nullif(btrim(coalesce(p ->> 'customerCode', '')), '') is not null then
    select id into customer from public.profiles where player_code = upper(btrim(p ->> 'customerCode'));
    if customer is null then
      raise exception 'No player has the ID %.', upper(btrim(p ->> 'customerCode'));
    end if;
  end if;
  if method = 'account' and (customer is null or not exists (select 1 from public.club_members where club_id = p_club and user_id = customer)) then
    raise exception 'Charging to an account needs a club member. Enter their player ID.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sale' || p_club::text, 0));

  -- First pass: prices, quantities and line discounts.
  for item in select * from jsonb_array_elements(p -> 'items') loop
    qty := coalesce((item ->> 'quantity')::integer, 1);
    if qty < 1 then
      raise exception 'Quantities start at 1.';
    end if;
    prod := null;
    rate := null;
    if item ? 'productId' and nullif(item ->> 'productId', '') is not null then
      select * into prod from public.products where id = (item ->> 'productId')::uuid and club_id = p_club and active;
      if not found then
        raise exception 'A product in the cart is no longer for sale.';
      end if;
      unit := coalesce((item ->> 'unitPriceCents')::integer, prod.price_cents);
      select * into rate from public.tax_rates where id = prod.tax_rate_id and active;
    else
      if char_length(btrim(coalesce(item ->> 'name', ''))) not between 1 and 80 then
        raise exception 'Name the custom item.';
      end if;
      unit := (item ->> 'unitPriceCents')::integer;
      select * into rate from public.tax_rates where id = nullif(item ->> 'taxRateId', '')::uuid and club_id = p_club and active;
    end if;
    if unit is null or unit < 0 then
      raise exception 'Every item needs a price.';
    end if;
    base := unit * qty;
    line_discount := least(greatest(coalesce((item ->> 'discountCents')::integer, 0), 0), base);
    subtotal := subtotal + base;
    item_discounts := item_discounts + line_discount;
    lines := lines || jsonb_build_object(
      'productId', prod.id, 'categoryId', prod.category_id, 'name', coalesce(prod.name, btrim(item ->> 'name')),
      'quantity', qty, 'unit', unit, 'base', base, 'discount', line_discount,
      'rateBp', coalesce(rate.rate_bp, 0), 'inclusive', coalesce(rate.inclusive, false),
      'track', coalesce(prod.track_inventory, false)
    );
  end loop;

  after_item := subtotal - item_discounts;
  cart_discount := least(cart_discount, after_item);

  -- Second pass: spread the cart discount over the lines, then tax each line.
  for line in select * from jsonb_array_elements(lines) loop
    n := n + 1;
    share := case
      when after_item = 0 then 0
      when n = jsonb_array_length(lines) then cart_discount - given
      else round(cart_discount * ((line ->> 'base')::integer - (line ->> 'discount')::integer)::numeric / after_item)::integer
    end;
    given := given + share;
    base := (line ->> 'base')::integer - (line ->> 'discount')::integer - share;
    if (line ->> 'inclusive')::boolean then
      tax := round(base * (line ->> 'rateBp')::integer::numeric / (10000 + (line ->> 'rateBp')::integer))::integer;
      total := total + base;
    else
      tax := round(base * (line ->> 'rateBp')::integer::numeric / 10000)::integer;
      total := total + base + tax;
    end if;
    tax_total := tax_total + tax;
    lines := jsonb_set(lines, array[(n - 1)::text], line || jsonb_build_object('share', share, 'tax', tax,
      'total', case when (line ->> 'inclusive')::boolean then base else base + tax end));
  end loop;

  if method = 'cash' and (p ->> 'tenderedCents') is not null and (p ->> 'tenderedCents')::integer < total then
    raise exception 'Cash given is less than the total.';
  end if;

  select coalesce(max(number), 1000) + 1 into num from public.sales where club_id = p_club;
  insert into public.sales (club_id, number, user_id, customer_name, subtotal_cents, discount_cents, tax_cents, total_cents,
                            payment_method, tendered_cents, note, staff_id)
  values (p_club, num, customer, nullif(left(btrim(coalesce(p ->> 'customerName', '')), 80), ''), subtotal,
          item_discounts + cart_discount, tax_total, total, method, (p ->> 'tenderedCents')::integer,
          nullif(left(btrim(coalesce(p ->> 'note', '')), 200), ''), uid)
  returning * into sale;

  for line in select * from jsonb_array_elements(lines) loop
    insert into public.sale_items (sale_id, product_id, category_id, name, quantity, unit_price_cents, discount_cents, tax_cents, total_cents)
    values (sale.id, nullif(line ->> 'productId', '')::uuid, nullif(line ->> 'categoryId', '')::uuid, line ->> 'name',
            (line ->> 'quantity')::integer, (line ->> 'unit')::integer,
            (line ->> 'discount')::integer + (line ->> 'share')::integer, (line ->> 'tax')::integer, (line ->> 'total')::integer);
    if (line ->> 'track')::boolean then
      update public.products set stock = stock - (line ->> 'quantity')::integer where id = (line ->> 'productId')::uuid;
      insert into public.inventory_movements (product_id, change, reason, sale_id, created_by)
      values ((line ->> 'productId')::uuid, -(line ->> 'quantity')::integer, 'sale', sale.id, uid);
    end if;
  end loop;

  if method = 'account' then
    insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, source_type, source_id, created_by)
    values (p_club, customer, 'pos', 'Pro shop sale #' || num, total, 'sale', sale.id, uid);
  end if;

  return public.res_sale_json(sale);
end;
$$;

/** Staff: refunds a sale (stock goes back for tracked products; an account charge is credited). */
create function public.res_refund_sale(p_sale uuid, p_restock boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sales;
  i public.sale_items;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  perform public.res_require_staff(s.club_id);
  if s.status = 'refunded' then
    raise exception 'This sale is already refunded.';
  end if;
  update public.sales set status = 'refunded', refunded_at = now() where id = p_sale returning * into s;
  if p_restock then
    for i in select * from public.sale_items where sale_id = p_sale and product_id is not null loop
      if exists (select 1 from public.products where id = i.product_id and track_inventory) then
        update public.products set stock = stock + i.quantity where id = i.product_id;
        insert into public.inventory_movements (product_id, change, reason, sale_id, created_by)
        values (i.product_id, i.quantity, 'refund', p_sale, (select auth.uid()));
      end if;
    end loop;
  end if;
  if s.payment_method = 'account' and s.user_id is not null then
    insert into public.ledger_entries (club_id, user_id, kind, description, amount_cents, source_type, source_id, created_by)
    values (s.club_id, s.user_id, 'refund', 'Refund of pro shop sale #' || s.number, -s.total_cents, 'sale', s.id, (select auth.uid()));
  end if;
  return public.res_sale_json(s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog upkeep
-- ---------------------------------------------------------------------------

/** Staff: adds or changes a product (p.id to change one). Setting p.stock records an adjustment. */
create function public.res_save_product(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  prod public.products;
  before integer;
begin
  perform public.res_require_staff(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 80 then
    raise exception 'Name the product.';
  end if;
  if nullif(p ->> 'categoryId', '') is not null and not exists (select 1 from public.product_categories where id = (p ->> 'categoryId')::uuid and club_id = p_club) then
    raise exception 'Category not found.';
  end if;
  if nullif(p ->> 'taxRateId', '') is not null and not exists (select 1 from public.tax_rates where id = (p ->> 'taxRateId')::uuid and club_id = p_club) then
    raise exception 'Tax rate not found.';
  end if;
  if p ? 'id' then
    select stock into before from public.products where id = (p ->> 'id')::uuid and club_id = p_club;
    update public.products set
      name = btrim(p ->> 'name'),
      category_id = nullif(p ->> 'categoryId', '')::uuid,
      sku = nullif(btrim(coalesce(p ->> 'sku', '')), ''),
      barcode = nullif(btrim(coalesce(p ->> 'barcode', '')), ''),
      price_cents = (p ->> 'priceCents')::integer,
      cost_cents = (p ->> 'costCents')::integer,
      tax_rate_id = nullif(p ->> 'taxRateId', '')::uuid,
      track_inventory = coalesce((p ->> 'trackInventory')::boolean, track_inventory),
      stock = coalesce((p ->> 'stock')::integer, stock),
      reorder_level = (p ->> 'reorderLevel')::integer
    where id = (p ->> 'id')::uuid and club_id = p_club and active
    returning * into prod;
    if not found then
      raise exception 'Product not found.';
    end if;
    if prod.stock <> before then
      insert into public.inventory_movements (product_id, change, reason, note, created_by)
      values (prod.id, prod.stock - before, 'adjustment', 'Edited', (select auth.uid()));
    end if;
  else
    insert into public.products (club_id, category_id, name, sku, barcode, price_cents, cost_cents, tax_rate_id, track_inventory, stock, reorder_level)
    values (p_club, nullif(p ->> 'categoryId', '')::uuid, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'sku', '')), ''),
            nullif(btrim(coalesce(p ->> 'barcode', '')), ''), (p ->> 'priceCents')::integer, (p ->> 'costCents')::integer,
            nullif(p ->> 'taxRateId', '')::uuid, coalesce((p ->> 'trackInventory')::boolean, true),
            coalesce((p ->> 'stock')::integer, 0), (p ->> 'reorderLevel')::integer)
    returning * into prod;
    if prod.stock <> 0 then
      insert into public.inventory_movements (product_id, change, reason, note, created_by)
      values (prod.id, prod.stock, 'restock', 'Starting stock', (select auth.uid()));
    end if;
  end if;
  return public.res_pos(p_club);
exception
  when check_violation or not_null_violation then
    raise exception 'Check the price, cost and reorder level.';
end;
$$;

create function public.res_delete_product(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.products where id = p_id;
  if club is null then
    raise exception 'Product not found.';
  end if;
  perform public.res_require_staff(club);
  update public.products set active = false where id = p_id;
  return public.res_pos(club);
end;
$$;

/** Staff: adds stock (a delivery) or adjusts it (damaged, counted), with a note. */
create function public.res_adjust_stock(p_product uuid, p_change integer, p_reason text default 'restock', p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.products where id = p_product and active;
  if club is null then
    raise exception 'Product not found.';
  end if;
  perform public.res_require_staff(club);
  if p_change is null or p_change = 0 then
    raise exception 'Enter how many.';
  end if;
  update public.products set stock = stock + p_change where id = p_product;
  insert into public.inventory_movements (product_id, change, reason, note, created_by)
  values (p_product, p_change, case when p_reason = 'adjustment' then 'adjustment' else 'restock' end,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), (select auth.uid()));
  return public.res_pos(club);
end;
$$;

create function public.res_save_product_category(p_club uuid, p jsonb)
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
    update public.product_categories set name = btrim(p ->> 'name') where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.product_categories (club_id, name, sort_order)
    values (p_club, btrim(p ->> 'name'), (select coalesce(max(sort_order), 0) + 1 from public.product_categories where club_id = p_club));
  end if;
  return public.res_pos(p_club);
end;
$$;

create function public.res_delete_product_category(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  club uuid;
begin
  select club_id into club from public.product_categories where id = p_id;
  if club is null then
    raise exception 'Category not found.';
  end if;
  perform public.res_require_staff(club);
  delete from public.product_categories where id = p_id;
  return public.res_pos(club);
end;
$$;

/** Admins: adds or changes a tax rate. p.ratePercent like 8.25; p.inclusive. */
create function public.res_save_tax_rate(p_club uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.res_require_manager(p_club);
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
    raise exception 'Name the tax rate.';
  end if;
  if p ? 'id' then
    update public.tax_rates set name = btrim(p ->> 'name'), rate_bp = round((p ->> 'ratePercent')::numeric * 100)::integer,
      inclusive = coalesce((p ->> 'inclusive')::boolean, inclusive), active = coalesce((p ->> 'active')::boolean, active)
    where id = (p ->> 'id')::uuid and club_id = p_club;
  else
    insert into public.tax_rates (club_id, name, rate_bp, inclusive)
    values (p_club, btrim(p ->> 'name'), round((p ->> 'ratePercent')::numeric * 100)::integer, coalesce((p ->> 'inclusive')::boolean, false));
  end if;
  return public.res_pos(p_club);
exception
  when check_violation or not_null_violation then
    raise exception 'Enter a rate between 0 and 50%%.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.res_product_json(public.products), public.res_sale_json(public.sales),
  public.res_pos(uuid), public.res_sales(uuid, timestamptz, timestamptz), public.res_account(uuid, uuid),
  public.res_checkout(uuid, jsonb), public.res_refund_sale(uuid, boolean), public.res_save_product(uuid, jsonb),
  public.res_delete_product(uuid), public.res_adjust_stock(uuid, integer, text, text), public.res_save_product_category(uuid, jsonb),
  public.res_delete_product_category(uuid), public.res_save_tax_rate(uuid, jsonb)
from public, anon;
revoke execute on function public.res_product_json(public.products), public.res_sale_json(public.sales) from authenticated;
grant execute on function
  public.res_pos(uuid), public.res_sales(uuid, timestamptz, timestamptz), public.res_account(uuid, uuid),
  public.res_checkout(uuid, jsonb), public.res_refund_sale(uuid, boolean), public.res_save_product(uuid, jsonb),
  public.res_delete_product(uuid), public.res_adjust_stock(uuid, integer, text, text), public.res_save_product_category(uuid, jsonb),
  public.res_delete_product_category(uuid), public.res_save_tax_rate(uuid, jsonb)
to authenticated;
