import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { dayLabel, money, today } from '@/lib/time';
import { confirm, notice, toast } from '../Dialogs';
import { Button, Card, Chip, ChipRow, DateField, Empty, ErrorText, Field, Loading, NumberField, Row, Segmented, Sheet, Small, Tag, Toggle } from '../ui';
import { Pair, SectionHeader } from './Settings';

const FILTERS: { value: string | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];
const TONE: Record<api.Invoice['status'], 'tint' | 'danger' | 'slate' | 'warning'> = { paid: 'tint', overdue: 'danger', open: 'warning', draft: 'slate', void: 'slate' };

/** Batch billing: run billing (dues + unbilled charges into invoices), issue, collect, autopay, adjust, and the invoice template. */
export function BillingSection() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const manager = api.isManager(club.myRole);
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<api.InvoiceList | null>(null);
  const [through, setThrough] = useState(today(tz));
  const [issueNow, setIssueNow] = useState(false);
  const [open, setOpen] = useState<api.Invoice | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.invoices(club.id, filter, query).then(setData, (e: Error) => setError(e.message));
  }, [club.id, filter, query]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const run = async () => {
    if (!(await confirm(`Run billing through ${dayLabel(through)}?`, `Membership dues that have come due are charged, and each member’s unbilled charges become ${issueNow ? 'an invoice, sent to them now' : 'a draft invoice to review'}.`, { confirmLabel: 'Run Billing' }))) return;
    try {
      const r = await api.runBilling(club.id, through, issueNow);
      await notice('Billing done', `${r.dues} dues charged · ${r.invoices} invoice${r.invoices === 1 ? '' : 's'} for ${money(r.totalCents)}${issueNow ? ', sent' : ' (drafts)'}.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <SectionHeader title="Billing & Invoices">
        Charges collect on members’ accounts as they happen: lessons, events, pro shop sales charged to account, fees and dues. A billing run turns them into
        invoices (members get a notification and can pay online, or autopay with a saved card).
      </SectionHeader>
      {data ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {[
            ['Outstanding', money(data.outstandingCents)],
            ['Overdue', money(data.overdueCents)],
            ['Collected this month', money(data.collectedThisMonthCents)],
            ['Not yet invoiced', money(data.unbilledCents)],
            ['Drafts', String(data.draftCount)],
          ].map(([label, value]) => (
            <Card key={label} style={{ flexGrow: 1, flexBasis: 140, gap: 2 }}>
              <Text style={[type.title3, { color: label === 'Overdue' && data.overdueCents ? c.destructive : c.label }]}>{value}</Text>
              <Small>{label}</Small>
            </Card>
          ))}
        </View>
      ) : null}

      {manager ? (
        <Card style={{ gap: 12 }}>
          <Text style={[type.headline, { color: c.label }]}>Run Billing</Text>
          <Pair>
            <View style={{ flex: 1 }}>
              <DateField label="Through" value={through} onChange={setThrough} />
            </View>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <Toggle label="Send invoices now" hint="Off: drafts to review first." value={issueNow} onChange={setIssueNow} />
            </View>
          </Pair>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button title="Run Billing" icon="dollar" onPress={run} />
            {data?.draftCount ? (
              <Button kind="secondary" title={`Send ${data.draftCount} Draft${data.draftCount === 1 ? '' : 's'}`} onPress={() => api.issueInvoices(club.id).then((n) => { toast(`Sent ${n}.`); load(); }, (e: Error) => toast(e.message))} />
            ) : null}
            <Button
              kind="secondary"
              title="Run Autopay"
              onPress={async () => {
                try {
                  const r = await api.runAutopay(club.id);
                  await notice('Autopay done', `Charged ${r.charged}.${r.failed.length ? ` Didn’t go through: ${r.failed.join(', ')} (members were notified).` : ''}`);
                  load();
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            />
            <Button kind="plain" title="Charge or Credit a Member" onPress={() => setAdjusting(true)} />
          </View>
        </Card>
      ) : null}
      <ErrorText error={error} />

      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.label} small label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </ChipRow>
      <Field placeholder="Search by member or player ID" value={query} onChangeText={setQuery} />
      <Card padded={false}>
        {data === null ? <Loading /> : data.invoices.length === 0 ? <Empty icon="list" title="No invoices" /> : null}
        {data?.invoices.map((i, n) => (
          <Row
            key={i.id}
            title={`${i.number} · ${i.memberName}`}
            subtitle={`${money(i.totalCents)}${i.paidCents ? ` · ${money(i.paidCents)} paid` : ''}${i.dueOn ? ` · due ${dayLabel(i.dueOn)}` : ''}${i.autopay ? ' · autopay' : ''}`}
            right={<Tag label={i.status[0].toUpperCase() + i.status.slice(1)} tone={TONE[i.status]} />}
            onPress={() => setOpen(i)}
            last={n === data.invoices.length - 1}
          />
        ))}
      </Card>

      {manager ? <TemplateCard clubId={club.id} /> : null}
      {open ? <InvoiceSheet club={club} invoice={open} onClose={() => setOpen(null)} onChanged={load} /> : null}
      {adjusting ? <AdjustSheet club={club} onClose={() => setAdjusting(false)} onDone={load} /> : null}
    </>
  );
}

function InvoiceSheet({ club, invoice: i, onClose, onChanged }: { club: api.Club; invoice: api.Invoice; onClose: () => void; onChanged: () => void }) {
  const [amount, setAmount] = useState<number | null>((i.totalCents - i.paidCents) / 100);
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => {
    toast(msg);
    onChanged();
    onClose();
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`${i.number} · ${i.memberName}`}
      footer={
        <>
          {i.status !== 'void' && !i.paidCents ? (
            <Button kind="destructiveSoft" title="Void" onPress={async () => { if (await confirm('Void this invoice?', 'Its charges go back to unbilled for the next run.', { confirmLabel: 'Void', destructive: true })) api.voidInvoice(i.id).then(() => done('Voided.'), (e: Error) => setError(e.message)); }} />
          ) : null}
          <Button kind="secondary" title="View / Print" onPress={() => router.push(`/c/${club.slug}/invoice/${i.id}`)} />
          {i.status === 'draft' ? <Button title="Send" onPress={() => api.issueInvoices(club.id, [i.id]).then(() => done('Sent.'), (e: Error) => setError(e.message))} /> : null}
        </>
      }
    >
      <Small>
        {money(i.totalCents)} · {i.paidCents ? `${money(i.paidCents)} paid · ` : ''}
        {i.status}
      </Small>
      {i.status === 'open' || i.status === 'overdue' || i.status === 'draft' ? (
        <Card style={{ gap: 10 }}>
          <Text style={type.headline}>Record a Payment</Text>
          <NumberField label="Amount" suffix="$" value={amount} onChange={setAmount} />
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'check', label: 'Check' },
              { value: 'card', label: 'Card' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Button small title="Record Payment" style={{ alignSelf: 'flex-start' }} disabled={!amount} onPress={() => api.recordPayment(i.id, Math.round((amount ?? 0) * 100), method).then(() => done('Payment recorded.'), (e: Error) => setError(e.message))} />
        </Card>
      ) : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

function AdjustSheet({ club, onClose, onDone }: { club: api.Club; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [kind, setKind] = useState<'charge' | 'credit'>('charge');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const list = await api.members(club.id, code);
      const m = list.find((x) => x.playerCode === code.trim().toUpperCase());
      if (!m) throw new Error('No member has that player ID.');
      const cents = Math.round((amount ?? 0) * 100);
      await api.adjustAccount(club.id, m.userId, kind === 'charge' ? cents : -cents, description);
      toast(`${kind === 'charge' ? 'Charged' : 'Credited'} ${m.name}.`);
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Charge or Credit a Member"
      width={460}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" disabled={!code.trim() || !amount || !description.trim()} onPress={save} />
        </>
      }
    >
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'charge', label: 'Charge' },
          { value: 'credit', label: 'Credit' },
        ]}
      />
      <Field label="Player ID" value={code} onChangeText={setCode} autoCapitalize="characters" />
      <NumberField label="Amount" suffix="$" value={amount} onChange={setAmount} />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Locker rental, court damage, goodwill credit…" />
      <ErrorText error={error} />
    </Sheet>
  );
}

function TemplateCard({ clubId }: { clubId: string }) {
  const [s, setS] = useState<api.InvoiceSettings | null>(null);
  useEffect(() => {
    api.invoiceSettings(clubId).then(setS, () => {});
  }, [clubId]);
  if (!s) return null;
  const COLORS = ['#0A8754', '#10241A', '#2F6BFF', '#6A4FC8', '#F2711C', '#C0352B'];
  return (
    <>
      <SectionHeader title="Invoice Template">Your branding and payment instructions on every invoice.</SectionHeader>
      <Card style={{ gap: 12 }}>
        <Pair>
          <Field style={{ flex: 1 }} label="Number Prefix" value={s.prefix} onChangeText={(t) => setS({ ...s, prefix: t.toUpperCase() })} />
          <NumberField style={{ flex: 1 }} label="Due After" suffix="days" value={s.dueDays} onChange={(v) => setS({ ...s, dueDays: v ?? 0 })} />
        </Pair>
        <ChipRow>
          {COLORS.map((col) => (
            <Chip key={col} small label={col === s.color ? '✓' : ' '} color={col} selected={col === s.color} onPress={() => setS({ ...s, color: col })} />
          ))}
        </ChipRow>
        <Field label="Header Line" value={s.header ?? ''} onChangeText={(t) => setS({ ...s, header: t })} placeholder="Phone · website · tax ID" />
        <Field label="How to Pay" value={s.footer ?? ''} onChangeText={(t) => setS({ ...s, footer: t })} multiline placeholder="Pay online from your Billing page, or by check to… at the front desk." />
        <Button small title="Save Template" style={{ alignSelf: 'flex-start' }} onPress={() => api.saveInvoiceSettings(clubId, s).then(() => toast('Saved.'), (e: Error) => toast(e.message))} />
      </Card>
    </>
  );
}
