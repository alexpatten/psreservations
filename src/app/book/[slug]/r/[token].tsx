import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { confirm } from '@/components/Dialogs';
import { Icon } from '@/components/Icon';
import { PublicHeader } from '@/components/PublicHeader';
import { Banner, Button, Card, Empty, ErrorText, Loading, Page, Small } from '@/components/ui';
import * as api from '@/lib/api';
import { type, useColors } from '@/lib/theme';
import { dayLabel, dayOf, duration, money, timeOf, timeRange } from '@/lib/time';

/** A guest's booking from the public page: the confirmation, and where they come back to cancel. */
export default function PublicBookingPage() {
  const c = useColors();
  const { token, paid } = useLocalSearchParams<{ token: string; paid?: string }>();
  const [b, setB] = useState<api.PublicBooking | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.publicBooking(String(token)).then(setB, () => setB(null)), [token]);
  useEffect(() => {
    load();
  }, [load]);

  // Back from Stripe: the webhook usually confirms within seconds.
  useEffect(() => {
    if (!paid || b?.status !== 'held') return;
    const t = setInterval(load, 2500);
    const stop = setTimeout(() => clearInterval(t), 90_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [paid, b?.status, load]);

  if (b === undefined) return <Loading />;
  if (b === null) return <Empty icon="search" title="We couldn’t find that booking">Check the link in your text message.</Empty>;

  const tz = b.club.timezone;
  const minutes = Math.round((b.endsAt - b.startsAt) / 60_000);
  const confirmed = b.status === 'booked';
  const waiting = b.status === 'held';

  const cancel = async () => {
    const msg = b.paidCents
      ? b.refundable
        ? `You’ll get ${money(b.paidCents - b.refundedCents, b.club.currency)} back on your card.`
        : `It’s less than ${b.cancelCutoffHours} hours before your booking, so it can’t be refunded.`
      : 'Your court is released for others.';
    if (!(await confirm('Cancel your booking?', msg, { confirmLabel: 'Cancel Booking', cancelLabel: 'Keep It', destructive: true }))) return;
    setError(null);
    try {
      await api.cancelPublic(b.token);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <PublicHeader name={b.club.name} address={b.club.address} />
      <Page maxWidth={560}>
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
          {confirmed ? (
            <>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="checkCircle" size={36} color={c.tint} />
              </View>
              <Text style={[type.title1, { color: c.label, textAlign: 'center' }]}>Booking Confirmed!</Text>
              <Small style={{ textAlign: 'center' }}>We texted your confirmation. Show it at the front desk when you arrive.</Small>
            </>
          ) : waiting ? (
            <>
              <Loading />
              <Text style={[type.title2, { color: c.label, textAlign: 'center' }]}>{paid ? 'Confirming your payment…' : 'Waiting for payment'}</Text>
              <Small style={{ textAlign: 'center' }}>
                {b.holdExpiresAt ? `Your court is held until ${timeOf(b.holdExpiresAt, tz)}.` : ''} This page updates by itself.
              </Small>
            </>
          ) : (
            <>
              <Icon name="xCircle" size={48} color={c.secondaryLabel} />
              <Text style={[type.title2, { color: c.label, textAlign: 'center' }]}>{b.status === 'expired' ? 'This hold ran out' : 'Booking cancelled'}</Text>
              <Small style={{ textAlign: 'center' }}>
                {b.status === 'expired' ? 'Payment wasn’t completed in time, so the court was released. Nothing was charged.' : b.cancelReason ?? ''}
                {b.refundedCents ? ` We refunded ${money(b.refundedCents, b.club.currency)}.` : ''}
              </Small>
            </>
          )}
        </Card>

        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: b.color }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: c.label }]}>{b.typeName}</Text>
              <Small>{b.courtName}</Small>
            </View>
          </View>
          <Line icon="calendar" text={dayLabel(dayOf(b.startsAt, tz), { long: true })} />
          <Line icon="clock" text={`${timeRange(b.startsAt, b.endsAt, tz)} · ${duration(minutes)}`} />
          <Line icon="users" text={`${b.guestName} · ${b.players} player${b.players === 1 ? '' : 's'}`} />
          {b.amountCents ? (
            <Line icon="dollar" text={`${money(b.amountCents, b.club.currency)}${b.paidCents ? ' paid' : ''}${b.refundedCents ? ` · ${money(b.refundedCents, b.club.currency)} refunded` : ''}`} />
          ) : null}
          {confirmed && b.startsAt > Date.now() ? (
            <>
              <Small>
                {b.paidCents
                  ? b.refundable
                    ? `Cancel at least ${b.cancelCutoffHours} hours ahead for a full refund.`
                    : 'It’s inside the cancellation window, so cancelling now isn’t refunded.'
                  : 'Can’t make it? Cancel so someone else can play.'}
              </Small>
              <Button kind="destructiveSoft" title="Cancel Booking" onPress={cancel} />
            </>
          ) : null}
          <ErrorText error={error} />
        </Card>

        {confirmed ? (
          <Banner tone="success" icon="star">
            Enjoyed it? Join {b.club.name} with a free Pickle Spots account to book faster next time and see who’s playing.
          </Banner>
        ) : null}
        <Button kind="secondary" title={confirmed ? `Join ${b.club.name}` : 'Book Another Time'} onPress={() => router.push(confirmed ? `/c/${b.club.slug}` : `/book/${b.club.slug}`)} />
      </Page>
    </View>
  );
}

function Line({ icon, text }: { icon: 'calendar' | 'clock' | 'users' | 'dollar'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={18} color={c.tint} />
      <Text style={[type.body, { color: c.label, flex: 1 }]}>{text}</Text>
    </View>
  );
}
