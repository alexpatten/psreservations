import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { toast } from '@/components/Dialogs';
import { Banner, Button, Card, Empty, Heading, Loading, Page, Row, Small, Tag, Toggle } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { dayLabel, dayOf, money } from '@/lib/time';

const TONE: Record<api.Invoice['status'], 'tint' | 'danger' | 'slate' | 'warning'> = { paid: 'tint', overdue: 'danger', open: 'warning', draft: 'slate', void: 'slate' };

/** Your bills at a club: balance, invoices to pay online, and autopay. */
export default function BillingPage() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const { paid } = useLocalSearchParams<{ paid?: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.myBilling>> | null>(null);
  const [account, setAccount] = useState<{ balanceCents: number; entries: api.LedgerEntry[] } | null>(null);
  const [saveCard, setSaveCard] = useState(false);
  const load = useCallback(() => {
    api.myBilling(club.id).then(setData, () => {});
    api.account(club.id).then(setAccount, () => {});
  }, [club.id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!paid) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [paid, load]);
  if (!data) return <Loading />;

  const pay = async (inv: api.Invoice) => {
    try {
      const { url } = await api.payInvoice(inv.id, saveCard);
      if (Platform.OS === 'web') window.location.assign(url);
      else Linking.openURL(url);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const open = data.invoices.filter((i) => i.status === 'open' || i.status === 'overdue');

  return (
    <Page maxWidth={760}>
      {paid ? <Banner tone="success" icon="checkCircle">Thanks! Your payment is being recorded.</Banner> : null}
      <Card style={{ gap: 4 }}>
        <Small>Account balance</Small>
        <Text style={[type.largeTitle, { color: data.balanceCents > 0 ? c.label : c.tint }]}>{money(Math.abs(data.balanceCents))}</Text>
        <Small>{data.balanceCents > 0 ? 'Owed, including charges not yet invoiced' : data.balanceCents < 0 ? 'Credit on your account' : 'You’re all paid up'}</Small>
      </Card>

      {open.length ? (
        <>
          <Heading>To Pay</Heading>
          {open.map((i) => (
            <Card key={i.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[type.headline, { color: c.label, flex: 1 }]}>
                  {i.number} · {money(i.totalCents - i.paidCents)}
                </Text>
                <Tag label={i.status === 'overdue' ? 'Overdue' : `Due ${dayLabel(i.dueOn ?? i.periodEnd)}`} tone={TONE[i.status]} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small kind="secondary" title="View" onPress={() => router.push(`/c/${club.slug}/invoice/${i.id}`)} />
                <Button small title="Pay Online" icon="dollar" onPress={() => pay(i)} />
              </View>
            </Card>
          ))}
          {!data.autopay?.on ? <Toggle label="Save my card and pay future invoices automatically" value={saveCard} onChange={setSaveCard} /> : null}
        </>
      ) : null}

      {data.autopay?.card ? (
        <Card>
          <Toggle
            label={`Autopay with ${data.autopay.card}`}
            hint="New invoices are charged to this card."
            value={data.autopay.on}
            onChange={(v) => api.setAutopay(club.id, v).then(load, (e: Error) => toast(e.message))}
          />
        </Card>
      ) : null}

      <Heading>Invoices</Heading>
      <Card padded={false}>
        {data.invoices.length === 0 ? <Empty icon="list" title="No invoices yet" /> : null}
        {data.invoices.map((i, n) => (
          <Row
            key={i.id}
            title={`${i.number} · ${money(i.totalCents)}`}
            subtitle={i.issuedOn ? `Issued ${dayLabel(i.issuedOn)}` : undefined}
            right={<Tag label={i.status[0].toUpperCase() + i.status.slice(1)} tone={TONE[i.status]} />}
            onPress={() => router.push(`/c/${club.slug}/invoice/${i.id}`)}
            last={n === data.invoices.length - 1}
          />
        ))}
      </Card>

      {account?.entries.length ? (
        <>
          <Heading>Activity</Heading>
          <Card padded={false}>
            {account.entries.slice(0, 25).map((e, n) => (
              <Row
                key={e.id}
                title={e.description}
                subtitle={dayLabel(dayOf(e.createdAt, tz))}
                right={<Small muted={false} style={{ color: e.amountCents < 0 ? c.tint : c.label }}>{e.amountCents < 0 ? `−${money(-e.amountCents)}` : money(e.amountCents)}</Small>}
                last={n === Math.min(account.entries.length, 25) - 1}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
