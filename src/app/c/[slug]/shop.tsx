import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { confirm, toast } from '@/components/Dialogs';
import { Banner, Body, Button, Card, Chip, ChipRow, Divider, Empty, ErrorText, Field, Loading, NumberField, Page, Row, Segmented, Sheet, Small, Tag, Toggle, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { addDays, dayLabel, dayOf, money, timeOf, today, zonedMs } from '@/lib/time';

type Tab = 'register' | 'products' | 'sales';

/** The pro shop: the register, products and stock, and sales. Staff only. */
export default function Shop() {
  const { club } = useClub();
  const [tab, setTab] = useState<Tab>('register');
  const [catalog, setCatalog] = useState<api.Pos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.pos(club.id).then(setCatalog, (e: Error) => setError(e.message));
  }, [club.id]);
  useEffect(load, [load]);

  if (!api.isStaff(club.myRole)) {
    return (
      <Page>
        <Empty icon="ban" title="Staff only" />
      </Page>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, width: '100%', maxWidth: 1400, alignSelf: 'center', gap: 10 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'register', label: 'Register' },
            { value: 'products', label: `Products${catalog?.lowStock ? ` (${catalog.lowStock} low)` : ''}` },
            { value: 'sales', label: 'Sales' },
          ]}
        />
        <ErrorText error={error} />
      </View>
      {!catalog ? (
        <Loading />
      ) : tab === 'register' ? (
        <Register club={club} catalog={catalog} onSold={load} />
      ) : tab === 'products' ? (
        <Products club={club} catalog={catalog} setCatalog={setCatalog} />
      ) : (
        <Sales club={club} onRefund={load} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

interface CartLine {
  key: string;
  productId?: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
}

const METHODS: { value: api.PaymentMethod; label: string; icon: 'dollar' | 'tablet' | 'users' | 'list' }[] = [
  { value: 'cash', label: 'Cash', icon: 'dollar' },
  { value: 'card', label: 'Card', icon: 'tablet' },
  { value: 'account', label: 'Charge to Account', icon: 'users' },
  { value: 'other', label: 'Other', icon: 'list' },
];

function Register({ club, catalog, onSold }: { club: api.Club; catalog: api.Pos; onSold: () => void }) {
  const c = useColors();
  const wide = useWide();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState<number | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [customItem, setCustomItem] = useState(false);
  const [paying, setPaying] = useState<api.PaymentMethod | null>(null);
  const [receipt, setReceipt] = useState<api.Sale | null>(null);

  const products = catalog.products.filter(
    (p) =>
      (!category || p.categoryId === category) &&
      (!search.trim() || `${p.name} ${p.sku ?? ''} ${p.barcode ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const add = (p: api.Product) => {
    // Typing or scanning an exact barcode adds it straight away.
    setCart((lines) => {
      const found = lines.find((l) => l.productId === p.id);
      if (found) return lines.map((l) => (l === found ? { ...l, quantity: l.quantity + 1 } : l));
      return [...lines, { key: p.id, productId: p.id, name: p.name, unitPriceCents: p.priceCents, quantity: 1, discountCents: 0 }];
    });
  };
  const update = (key: string, patch: Partial<CartLine>) => setCart((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.quantity > 0));

  // An estimate for the screen; the server works out the exact taxes.
  const estimate = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity - l.discountCents, 0);
    const discount = Math.min(Math.round((cartDiscount ?? 0) * 100), subtotal);
    let tax = 0;
    for (const l of cart) {
      const p = catalog.products.find((x) => x.id === l.productId);
      const rate = catalog.taxRates.find((t) => t.id === p?.taxRateId);
      if (!rate || rate.inclusive) continue;
      const base = l.unitPriceCents * l.quantity - l.discountCents;
      tax += Math.round(((subtotal ? base - (discount * base) / subtotal : base) * rate.rateBp) / 10000);
    }
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [cart, cartDiscount, catalog]);

  const searchSubmit = () => {
    const exact = catalog.products.find((p) => p.barcode && p.barcode === search.trim());
    if (exact) {
      add(exact);
      setSearch('');
    }
  };

  const cartView = (
    <Card style={{ gap: 12, flex: wide ? 1 : undefined }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[type.title3, { color: c.label, flex: 1 }]}>Cart</Text>
        {cart.length ? <Button small kind="plain" title="Clear" onPress={() => setCart([])} /> : null}
      </View>
      {cart.length === 0 ? <Small>Tap products to add them.</Small> : null}
      {cart.map((l) => (
        <View key={l.key} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body style={{ flex: 1 }} numberOfLines={1}>
              {l.name}
            </Body>
            <Body>{money(l.unitPriceCents * l.quantity - l.discountCents)}</Body>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Stepper value={l.quantity} onChange={(q) => update(l.key, { quantity: q })} />
            <Small style={{ flex: 1 }}>
              {money(l.unitPriceCents)} each{l.discountCents ? ` · ${money(l.discountCents)} off` : ''}
            </Small>
            <Button
              small
              kind="plain"
              title={l.discountCents ? 'No Discount' : '10% Off'}
              onPress={() => update(l.key, { discountCents: l.discountCents ? 0 : Math.round(l.unitPriceCents * l.quantity * 0.1) })}
            />
          </View>
        </View>
      ))}
      <Divider />
      <NumberField label="Cart Discount" suffix="$" allowEmpty value={cartDiscount} onChange={setCartDiscount} />
      <Field label="Member (Player ID)" value={customerCode} onChangeText={setCustomerCode} autoCapitalize="characters" hint="Needed to charge to their account. Optional otherwise." />
      <View style={{ gap: 4 }}>
        <Line label="Subtotal" value={money(estimate.subtotal)} />
        {estimate.discount ? <Line label="Discount" value={`−${money(estimate.discount)}`} /> : null}
        {estimate.tax ? <Line label="Tax" value={money(estimate.tax)} /> : null}
        <Line label="Total" value={money(estimate.total)} bold />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {METHODS.map((m) => (
          <Button
            key={m.value}
            kind={m.value === 'cash' ? 'primary' : 'secondary'}
            icon={m.icon}
            title={m.label}
            disabled={!cart.length || (m.value === 'account' && !customerCode.trim())}
            onPress={() => setPaying(m.value)}
            style={{ flexGrow: 1 }}
          />
        ))}
      </View>
    </Card>
  );

  return (
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', gap: 16, padding: 16, width: '100%', maxWidth: 1400, alignSelf: 'center' }}>
      <ScrollView style={{ flex: wide ? 2 : undefined }} contentContainerStyle={{ gap: 12 }}>
        {catalog.lowStock ? (
          <Banner tone="warning" icon="list">
            {catalog.lowStock} product{catalog.lowStock === 1 ? ' is' : 's are'} at or below the reorder level. See Products.
          </Banner>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field style={{ flex: 1 }} placeholder="Search or scan a barcode" value={search} onChangeText={setSearch} onSubmitEditing={searchSubmit} autoCapitalize="none" />
          <Button kind="secondary" icon="plus" title="Custom Item" onPress={() => setCustomItem(true)} />
        </View>
        <ChipRow>
          <Chip small label="All" selected={!category} onPress={() => setCategory(null)} />
          {catalog.categories.map((k) => (
            <Chip key={k.id} small label={k.name} selected={category === k.id} onPress={() => setCategory(k.id)} />
          ))}
        </ChipRow>
        {catalog.products.length === 0 ? (
          <Card>
            <Empty icon="list" title="No products yet">
              Add what you sell under Products, or ring up a custom item.
            </Empty>
          </Card>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {products.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => add(p)}
              style={({ pressed, hovered }) => ({
                width: wide ? 170 : '47%',
                flexGrow: wide ? 0 : 1,
                minHeight: 96,
                padding: 12,
                borderRadius: 14,
                backgroundColor: pressed ? c.tintSoft : c.card,
                borderWidth: 1,
                borderColor: hovered ? c.tint : c.cardBorder,
                justifyContent: 'space-between',
              })}
            >
              <Text style={[type.subheadline, { color: c.label, fontWeight: '600' }]} numberOfLines={2}>
                {p.name}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[type.headline, { color: c.tint }]}>{money(p.priceCents)}</Text>
                {p.trackInventory ? <Tag label={`${p.stock} left`} tone={p.low ? 'danger' : 'slate'} /> : null}
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {cartView}

      {customItem ? (
        <CustomItemSheet
          onClose={() => setCustomItem(false)}
          onAdd={(name, cents) => {
            setCart((lines) => [...lines, { key: `custom-${Date.now()}`, name, unitPriceCents: cents, quantity: 1, discountCents: 0 }]);
            setCustomItem(false);
          }}
        />
      ) : null}
      {paying ? (
        <PaySheet
          club={club}
          method={paying}
          estimateCents={estimate.total}
          onClose={() => setPaying(null)}
          onPay={async (tendered) => {
            const sale = await api.checkout(club.id, {
              items: cart.map((l) => (l.productId ? { productId: l.productId, quantity: l.quantity, discountCents: l.discountCents } : { name: l.name, unitPriceCents: l.unitPriceCents, quantity: l.quantity, discountCents: l.discountCents })),
              discountCents: estimate.discount,
              customerCode: customerCode.trim() || undefined,
              paymentMethod: paying,
              tenderedCents: tendered,
            });
            setPaying(null);
            setCart([]);
            setCartDiscount(null);
            setCustomerCode('');
            setReceipt(sale);
            onSold();
          }}
        />
      ) : null}
      {receipt ? <ReceiptSheet club={club} sale={receipt} onClose={() => setReceipt(null)} /> : null}
    </View>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const c = useColors();
  const btn = (label: string, next: number) => (
    <Pressable onPress={() => onChange(next)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.headline, { color: c.label }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {btn('−', value - 1)}
      <Text style={[type.headline, { color: c.label, minWidth: 20, textAlign: 'center' }]}>{value}</Text>
      {btn('+', value + 1)}
    </View>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[bold ? type.headline : type.subheadline, { color: bold ? c.label : c.secondaryLabel }]}>{label}</Text>
      <Text style={[bold ? type.title3 : type.subheadline, { color: c.label }]}>{value}</Text>
    </View>
  );
}

function CustomItemSheet({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, cents: number) => void }) {
  const [name, setName] = useState('Court time');
  const [price, setPrice] = useState<number | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Custom Item"
      width={420}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Add to Cart" disabled={!name.trim() || price == null} onPress={() => onAdd(name.trim(), Math.round((price ?? 0) * 100))} />
        </>
      }
    >
      <ChipRow>
        {['Court time', 'Guest fee', 'Ball machine', 'Snack', 'Drink'].map((n) => (
          <Chip key={n} small label={n} selected={name === n} onPress={() => setName(n)} />
        ))}
      </ChipRow>
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
      <NumberField label="Price" suffix="$" value={price} onChange={setPrice} />
    </Sheet>
  );
}

function PaySheet({
  club,
  method,
  estimateCents,
  onClose,
  onPay,
}: {
  club: api.Club;
  method: api.PaymentMethod;
  estimateCents: number;
  onClose: () => void;
  onPay: (tenderedCents?: number) => Promise<void>;
}) {
  const [tendered, setTendered] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = METHODS.find((m) => m.value === method)?.label;
  const cents = tendered == null ? undefined : Math.round(tendered * 100);
  const quick = [estimateCents, Math.ceil(estimateCents / 500) * 500, Math.ceil(estimateCents / 1000) * 1000, Math.ceil(estimateCents / 2000) * 2000].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`${label} · ${money(estimateCents)}`}
      width={440}
      footer={
        <>
          <Button kind="secondary" title="Back" onPress={onClose} />
          <Button
            title="Complete Sale"
            icon="check"
            disabled={method === 'cash' && cents != null && cents < estimateCents}
            onPress={async () => {
              setError(null);
              try {
                await onPay(method === 'cash' ? cents : undefined);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </>
      }
    >
      {method === 'cash' ? (
        <>
          <ChipRow>
            {quick.map((q) => (
              <Chip key={q} label={money(q)} selected={cents === q} onPress={() => setTendered(q / 100)} />
            ))}
          </ChipRow>
          <NumberField label="Cash Given" suffix="$" allowEmpty value={tendered} onChange={setTendered} />
          {cents != null && cents >= estimateCents ? <Banner tone="success">Change: {money(cents - estimateCents)}</Banner> : null}
        </>
      ) : method === 'card' ? (
        <Small>Run the card on your terminal for {money(estimateCents)}, then complete the sale here.</Small>
      ) : method === 'account' ? (
        <Small>{money(estimateCents)} is added to the member’s account at {club.name}, to be paid with their next invoice.</Small>
      ) : (
        <Small>For gift cards, checks and anything else. Add a note on the receipt if you need one.</Small>
      )}
      <ErrorText error={error} />
    </Sheet>
  );
}

function ReceiptSheet({ club, sale, onClose }: { club: api.Club; sale: api.Sale; onClose: () => void }) {
  const tz = club.timezone;
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Receipt #${sale.number}`}
      width={420}
      footer={
        <>
          {Platform.OS === 'web' ? <Button kind="secondary" title="Print" onPress={() => window.print()} /> : null}
          <Button title="Next Sale" onPress={onClose} />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={type.headline}>{club.name}</Text>
        {club.address ? <Small>{club.address}</Small> : null}
        <Small>
          {dayLabel(dayOf(sale.createdAt, tz))} {timeOf(sale.createdAt, tz)}
          {sale.customerName ? ` · ${sale.customerName}` : ''}
        </Small>
      </View>
      <Divider />
      {sale.items.map((i, n) => (
        <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Small muted={false} style={{ flex: 1 }}>
            {i.quantity} × {i.name}
            {i.discountCents ? ` (−${money(i.discountCents)})` : ''}
          </Small>
          <Small muted={false}>{money(i.totalCents)}</Small>
        </View>
      ))}
      <Divider />
      <Line label="Subtotal" value={money(sale.subtotalCents)} />
      {sale.discountCents ? <Line label="Discounts" value={`−${money(sale.discountCents)}`} /> : null}
      <Line label="Tax" value={money(sale.taxCents)} />
      <Line label="Total" value={money(sale.totalCents)} bold />
      <Line label={METHODS.find((m) => m.value === sale.paymentMethod)?.label ?? sale.paymentMethod} value={sale.tenderedCents ? `${money(sale.tenderedCents)} given · ${money(sale.tenderedCents - sale.totalCents)} change` : money(sale.totalCents)} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Products and stock
// ---------------------------------------------------------------------------

function Products({ club, catalog, setCatalog }: { club: api.Club; catalog: api.Pos; setCatalog: (p: api.Pos) => void }) {
  const [editing, setEditing] = useState<(Partial<api.Product> & { name: string; priceCents: number }) | null>(null);
  const [restock, setRestock] = useState<api.Product | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [taxName, setTaxName] = useState('Sales tax');
  const [taxRate, setTaxRate] = useState<number | null>(null);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const manager = api.isManager(club.myRole);
  const sorted = [...catalog.products].sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name));
  const run = (p: Promise<api.Pos>) => p.then(setCatalog, (e: Error) => toast(e.message));

  return (
    <Page>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={type.title2}>Products</Text>
        <Button small icon="plus" title="Product" onPress={() => setEditing({ name: '', priceCents: 0, trackInventory: true, stock: 0 })} />
      </View>
      {catalog.lowStock ? (
        <Banner tone="warning" icon="list">
          Time to reorder: {catalog.products.filter((p) => p.low).map((p) => `${p.name} (${p.stock})`).join(', ')}.
        </Banner>
      ) : null}
      <Card padded={false}>
        {sorted.length === 0 ? <Empty icon="list" title="No products yet" /> : null}
        {sorted.map((p, i) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle={[
              money(p.priceCents),
              catalog.categories.find((k) => k.id === p.categoryId)?.name,
              p.trackInventory ? `${p.stock} in stock${p.reorderLevel != null ? ` · reorder at ${p.reorderLevel}` : ''}` : 'Not tracked',
              p.sku ? `SKU ${p.sku}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                {p.low ? <Tag label="Reorder" tone="danger" /> : null}
                {p.trackInventory ? <Button small kind="secondary" title="Restock" onPress={() => setRestock(p)} /> : null}
              </View>
            }
            onPress={() => setEditing(p)}
            last={i === sorted.length - 1}
          />
        ))}
      </Card>

      <Text style={type.title3}>Categories</Text>
      <Card style={{ gap: 10 }}>
        <ChipRow>
          {catalog.categories.map((k) => (
            <Chip key={k.id} small label={`${k.name}  ✕`} onPress={() => run(api.deleteProductCategory(k.id))} />
          ))}
        </ChipRow>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field style={{ flex: 1 }} placeholder="Paddles, Balls, Apparel, Snacks…" value={newCategory} onChangeText={setNewCategory} />
          <Button kind="secondary" title="Add" disabled={!newCategory.trim()} onPress={() => run(api.saveProductCategory(club.id, { name: newCategory })).then(() => setNewCategory(''))} />
        </View>
      </Card>

      <Text style={type.title3}>Tax Rates</Text>
      <Card style={{ gap: 10 }}>
        {catalog.taxRates.map((t) => (
          <Small key={t.id} muted={false}>
            {t.name}: {(t.rateBp / 100).toFixed(2)}% {t.inclusive ? '(included in prices)' : '(added at checkout)'}
          </Small>
        ))}
        {manager ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Field style={{ flex: 2, minWidth: 140 }} label="Name" value={taxName} onChangeText={setTaxName} />
              <NumberField style={{ flex: 1, minWidth: 100 }} label="Rate" suffix="%" value={taxRate} onChange={setTaxRate} />
            </View>
            <Toggle label="Included in Prices" hint="Off: added on top at checkout (US sales tax)." value={taxInclusive} onChange={setTaxInclusive} />
            <Button small kind="secondary" title="Add Tax Rate" disabled={taxRate == null || !taxName.trim()} style={{ alignSelf: 'flex-start' }} onPress={() => run(api.saveTaxRate(club.id, { name: taxName, ratePercent: taxRate ?? 0, inclusive: taxInclusive })).then(() => setTaxRate(null))} />
          </>
        ) : null}
      </Card>

      {editing ? <ProductEditor club={club} catalog={catalog} draft={editing} onClose={() => setEditing(null)} onSaved={(p) => { setCatalog(p); setEditing(null); }} /> : null}
      {restock ? <RestockSheet product={restock} onClose={() => setRestock(null)} onSaved={(p) => { setCatalog(p); setRestock(null); }} /> : null}
    </Page>
  );
}

function ProductEditor({ club, catalog, draft, onClose, onSaved }: { club: api.Club; catalog: api.Pos; draft: Partial<api.Product> & { name: string; priceCents: number }; onClose: () => void; onSaved: (p: api.Pos) => void }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<api.Product>) => setD({ ...d, ...p });
  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? `Edit ${draft.name}` : 'New Product'}
      footer={
        <>
          {d.id ? (
            <Button
              kind="destructiveSoft"
              title="Remove"
              onPress={async () => {
                if (await confirm(`Remove ${d.name}?`, 'It comes off the register; past sales keep it.', { confirmLabel: 'Remove', destructive: true })) {
                  api.deleteProduct(d.id!).then(onSaved, (e: Error) => setError(e.message));
                }
              }}
            />
          ) : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" disabled={!d.name.trim()} onPress={() => api.saveProduct(club.id, d).then(onSaved, (e: Error) => setError(e.message))} />
        </>
      }
    >
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} maxLength={80} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <NumberField style={{ flex: 1 }} label="Price" suffix="$" value={d.priceCents / 100} onChange={(v) => set({ priceCents: Math.round((v ?? 0) * 100) })} />
        <NumberField style={{ flex: 1 }} label="Cost" suffix="$" allowEmpty value={d.costCents == null ? null : d.costCents / 100} onChange={(v) => set({ costCents: v == null ? null : Math.round(v * 100) })} />
      </View>
      <Small style={{ fontWeight: '600' }}>CATEGORY</Small>
      <ChipRow>
        <Chip small label="None" selected={!d.categoryId} onPress={() => set({ categoryId: null })} />
        {catalog.categories.map((k) => (
          <Chip key={k.id} small label={k.name} selected={d.categoryId === k.id} onPress={() => set({ categoryId: k.id })} />
        ))}
      </ChipRow>
      <Small style={{ fontWeight: '600' }}>TAX</Small>
      <ChipRow>
        <Chip small label="No tax" selected={!d.taxRateId} onPress={() => set({ taxRateId: null })} />
        {catalog.taxRates.map((t) => (
          <Chip key={t.id} small label={`${t.name} ${(t.rateBp / 100).toFixed(2)}%`} selected={d.taxRateId === t.id} onPress={() => set({ taxRateId: t.id })} />
        ))}
      </ChipRow>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Field style={{ flex: 1 }} label="SKU" value={d.sku ?? ''} onChangeText={(t) => set({ sku: t })} />
        <Field style={{ flex: 1 }} label="Barcode" value={d.barcode ?? ''} onChangeText={(t) => set({ barcode: t })} />
      </View>
      <Toggle label="Track Stock" value={d.trackInventory ?? true} onChange={(v) => set({ trackInventory: v })} />
      {d.trackInventory ?? true ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <NumberField style={{ flex: 1 }} label="In Stock" value={d.stock ?? 0} onChange={(v) => set({ stock: v ?? 0 })} />
          <NumberField style={{ flex: 1 }} label="Reorder At" allowEmpty value={d.reorderLevel ?? null} onChange={(v) => set({ reorderLevel: v })} hint="Alert at this many or fewer." />
        </View>
      ) : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

function RestockSheet({ product, onClose, onSaved }: { product: api.Product; onClose: () => void; onSaved: (p: api.Pos) => void }) {
  const [count, setCount] = useState<number | null>(12);
  const [mode, setMode] = useState<'restock' | 'adjustment'>('restock');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={product.name}
      width={420}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button
            title="Save"
            disabled={!count}
            onPress={() => api.adjustStock(product.id, mode === 'restock' ? Math.abs(count ?? 0) : -Math.abs(count ?? 0), mode, note).then(onSaved, (e: Error) => setError(e.message))}
          />
        </>
      }
    >
      <Small>{product.stock} in stock now.</Small>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'restock', label: 'Received' },
          { value: 'adjustment', label: 'Remove (damaged, lost)' },
        ]}
      />
      <NumberField label="How Many" value={count} onChange={setCount} />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Supplier, invoice number…" />
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

function Sales({ club, onRefund }: { club: api.Club; onRefund: () => void }) {
  const c = useColors();
  const tz = club.timezone;
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const [report, setReport] = useState<api.SalesReport | null>(null);
  const [receipt, setReceipt] = useState<api.Sale | null>(null);
  const from = zonedMs(range === 'today' ? today(tz) : range === 'week' ? addDays(today(tz), -6) : `${today(tz).slice(0, 8)}01`, 0, tz);
  const to = zonedMs(addDays(today(tz), 1), 0, tz);
  const load = useCallback(() => {
    api.sales(club.id, from, to).then(setReport, (e: Error) => toast(e.message));
  }, [club.id, from, to]);
  useEffect(load, [load]);

  const refund = async (s: api.Sale) => {
    if (!(await confirm(`Refund sale #${s.number}?`, `${money(s.totalCents)}${s.paymentMethod === 'account' ? ' is credited to their account' : ' to be returned to the customer'}; products go back in stock.`, { confirmLabel: 'Refund', destructive: true }))) return;
    try {
      await api.refundSale(s.id);
      toast('Refunded.');
      load();
      onRefund();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Page>
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Last 7 Days' },
          { value: 'month', label: 'This Month' },
        ]}
      />
      {!report ? (
        <Loading />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {[
              ['Net sales', money(report.summary.netCents)],
              ['Sales', String(report.summary.count)],
              ['Discounts', money(report.summary.discountCents)],
              ['Tax collected', money(report.summary.taxCents)],
              ['Refunds', money(report.summary.refundCents)],
            ].map(([label, value]) => (
              <Card key={label} style={{ flexGrow: 1, flexBasis: 150, gap: 2 }}>
                <Text style={[type.title2, { color: c.label }]}>{value}</Text>
                <Small>{label}</Small>
              </Card>
            ))}
          </View>
          {Object.keys(report.summary.byMethod).length ? (
            <Small>
              {Object.entries(report.summary.byMethod)
                .map(([m, v]) => `${METHODS.find((x) => x.value === m)?.label ?? m} ${money(v)}`)
                .join(' · ')}
            </Small>
          ) : null}
          {report.byCategory.length ? (
            <Card style={{ gap: 8 }}>
              <Body style={{ fontWeight: '600' }}>By Category</Body>
              {report.byCategory.map((k) => (
                <View key={k.name} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Small muted={false}>
                      {k.name} · {k.quantity} sold
                    </Small>
                    <Small muted={false}>{money(k.totalCents)}</Small>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: c.fill }}>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.tint, width: `${(100 * k.totalCents) / Math.max(1, report.byCategory[0].totalCents)}%` }} />
                  </View>
                </View>
              ))}
              {report.topItems.length ? <Small>Best sellers: {report.topItems.slice(0, 5).map((t) => `${t.name} (${t.quantity})`).join(', ')}</Small> : null}
            </Card>
          ) : null}
          <Card padded={false}>
            {report.sales.length === 0 ? <Empty icon="list" title="No sales yet" /> : null}
            {report.sales.map((s, i) => (
              <Row
                key={s.id}
                title={`#${s.number} · ${money(s.totalCents)}`}
                subtitle={`${dayLabel(dayOf(s.createdAt, tz))} ${timeOf(s.createdAt, tz)} · ${METHODS.find((m) => m.value === s.paymentMethod)?.label}${s.customerName ? ` · ${s.customerName}` : ''} · ${s.items.map((x) => `${x.quantity}× ${x.name}`).join(', ')}`}
                right={
                  s.status === 'refunded' ? (
                    <Tag label="Refunded" tone="danger" />
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Button small kind="plain" title="Receipt" onPress={() => setReceipt(s)} />
                      <Button small kind="destructiveSoft" title="Refund" onPress={() => refund(s)} />
                    </View>
                  )
                }
                last={i === report.sales.length - 1}
              />
            ))}
          </Card>
        </>
      )}
      {receipt ? <ReceiptSheet club={club} sale={receipt} onClose={() => setReceipt(null)} /> : null}
    </Page>
  );
}
