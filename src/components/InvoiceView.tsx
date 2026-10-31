import { Text, View } from 'react-native';
import type { Invoice } from '@/lib/api';
import { type, useColors } from '@/lib/theme';
import { dayLabel, money } from '@/lib/time';

const STATUS: Record<Invoice['status'], string> = { draft: 'Draft', open: 'Due', overdue: 'Overdue', paid: 'Paid', void: 'Void' };

/** An invoice in the club's template: color band, header, member, lines, totals, payment instructions. Prints cleanly. */
export function InvoiceView({ invoice: i }: { invoice: Invoice }) {
  const c = useColors();
  const k = i.club;
  const accent = k?.color ?? c.tint;
  const due = i.totalCents - i.paidCents;
  const currency = k?.currency ?? 'usd';
  return (
    <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: c.cardBorder }}>
      <View style={{ height: 8, backgroundColor: accent }} />
      <View style={{ padding: 28, gap: 22 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <View style={{ gap: 2, flex: 1, minWidth: 200 }}>
            <Text style={[type.title2, { color: '#10241A' }]}>{k?.name}</Text>
            {k?.address ? <Text style={[type.footnote, { color: '#5b6b63' }]}>{k.address}</Text> : null}
            {k?.header ? <Text style={[type.footnote, { color: '#5b6b63' }]}>{k.header}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={[type.title3, { color: accent, letterSpacing: 1 }]}>INVOICE</Text>
            <Text style={[type.subheadline, { color: '#10241A' }]}>{i.number}</Text>
            <View style={{ marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: i.status === 'paid' ? '#DDF2E6' : i.status === 'overdue' ? '#FDE3E1' : '#ECF0F2' }}>
              <Text style={[type.caption, { fontWeight: '700', color: i.status === 'paid' ? '#0A8754' : i.status === 'overdue' ? '#C0352B' : '#4A5763' }]}>{STATUS[i.status].toUpperCase()}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
          <Meta label="Billed to" value={`${i.memberName}\n${i.email ?? ''}`} />
          <Meta label="Issued" value={i.issuedOn ? dayLabel(i.issuedOn) : '—'} />
          <Meta label="Due" value={i.dueOn ? dayLabel(i.dueOn) : '—'} />
          <Meta label="Through" value={dayLabel(i.periodEnd)} />
        </View>

        <View>
          <View style={{ flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: accent }}>
            <Text style={[type.caption, { color: '#5b6b63', fontWeight: '700', width: 90 }]}>DATE</Text>
            <Text style={[type.caption, { color: '#5b6b63', fontWeight: '700', flex: 1 }]}>DESCRIPTION</Text>
            <Text style={[type.caption, { color: '#5b6b63', fontWeight: '700', width: 100, textAlign: 'right' }]}>AMOUNT</Text>
          </View>
          {(i.lines ?? []).map((l, n) => (
            <View key={l.id} style={{ flexDirection: 'row', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#E3EBE6', backgroundColor: n % 2 ? '#F7FAF8' : '#FFFFFF' }}>
              <Text style={[type.footnote, { color: '#10241A', width: 90 }]}>{dayLabel(l.date).replace(/^\w+, /, '')}</Text>
              <Text style={[type.footnote, { color: '#10241A', flex: 1 }]}>{l.description}</Text>
              <Text style={[type.footnote, { color: l.amountCents < 0 ? '#0A8754' : '#10241A', width: 100, textAlign: 'right' }]}>
                {l.amountCents < 0 ? `−${money(-l.amountCents, currency)}` : money(l.amountCents, currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ alignSelf: 'flex-end', minWidth: 240, gap: 6 }}>
          <Total label="Total" value={money(i.totalCents, currency)} />
          {i.paidCents ? <Total label="Paid" value={`−${money(i.paidCents, currency)}`} /> : null}
          <Total label={due > 0 ? 'Amount due' : 'Balance'} value={money(Math.max(0, due), currency)} strong accent={accent} />
        </View>

        {k?.footer ? (
          <View style={{ borderTopWidth: 1, borderTopColor: '#E3EBE6', paddingTop: 14 }}>
            <Text style={[type.caption, { color: '#5b6b63', fontWeight: '700', marginBottom: 4 }]}>HOW TO PAY</Text>
            <Text style={[type.footnote, { color: '#10241A' }]}>{k.footer}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2, minWidth: 110 }}>
      <Text style={[type.caption, { color: '#5b6b63', fontWeight: '700' }]}>{label.toUpperCase()}</Text>
      <Text style={[type.footnote, { color: '#10241A' }]}>{value}</Text>
    </View>
  );
}

function Total({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 24, borderTopWidth: strong ? 2 : 0, borderTopColor: accent, paddingTop: strong ? 6 : 0 }}>
      <Text style={[strong ? type.headline : type.subheadline, { color: '#10241A' }]}>{label}</Text>
      <Text style={[strong ? type.title3 : type.subheadline, { color: '#10241A' }]}>{value}</Text>
    </View>
  );
}
