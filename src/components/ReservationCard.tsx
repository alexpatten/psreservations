import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type, useColors } from '@/lib/theme';
import { dayOf, duration, relativeDay, timeRange } from '@/lib/time';
import { confirm, toast } from './Dialogs';
import { Icon } from './Icon';
import { Button, Card, Small, Tag } from './ui';

/** One of your reservations: when, where, who, with Check In and Cancel. */
export function ReservationCard({ reservation: r, onChange, showClub }: { reservation: api.MyReservation; onChange: () => void; showClub?: boolean }) {
  const c = useColors();
  const { session } = useAuth();
  const me = session?.user.id;
  const mine = r.ownerId === me;
  const myPlayer = r.players.find((p) => p.userId === me);
  const now = Date.now();
  const canCheckIn = !!myPlayer && !myPlayer.checkedInAt && now >= r.startsAt - r.checkInMinutesBefore * 60_000 && now < r.endsAt;
  const late = r.cancelCutoffHours > 0 && r.startsAt - now < r.cancelCutoffHours * 3_600_000;

  const cancel = async () => {
    const message = late
      ? `It's less than ${r.cancelCutoffHours} hours before the start, so this counts as a late cancellation (a strike on your account at ${r.clubName}).`
      : 'Your court will be released for others to book.';
    if (!(await confirm('Cancel this reservation?', message, { confirmLabel: 'Cancel Reservation', cancelLabel: 'Keep It', destructive: true }))) return;
    try {
      await api.cancelReservation(r.id);
      toast('Reservation cancelled.');
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const leave = async () => {
    if (!(await confirm('Leave this reservation?', 'You’ll be taken off the list of players.', { confirmLabel: 'Leave', destructive: true }))) return;
    try {
      await api.leaveReservation(r.id);
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const checkIn = async () => {
    try {
      await api.checkIn(r.id);
      toast('You’re checked in. Have a great game!');
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Card padded={false} style={{ flexDirection: 'row', overflow: 'hidden' }}>
      <View style={{ width: 6, backgroundColor: r.color }} />
      <View style={{ flex: 1, padding: 14, gap: 8 }}>
        <Pressable onPress={() => router.push(`/c/${r.clubSlug}?day=${dayOf(r.startsAt, r.timezone)}`)} style={{ gap: 2 }}>
          {showClub ? <Text style={[type.footnote, { color: c.tint, fontWeight: '600' }]}>{r.clubName}</Text> : null}
          <Text style={[type.headline, { color: c.label }]}>{r.title || r.typeName}</Text>
          <Small>{r.courtName}</Small>
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          <Meta icon="calendar" text={relativeDay(dayOf(r.startsAt, r.timezone), r.timezone)} />
          <Meta icon="clock" text={`${timeRange(r.startsAt, r.endsAt, r.timezone)} · ${duration(Math.round((r.endsAt - r.startsAt) / 60_000))}`} />
          {r.players.length ? <Meta icon="users" text={r.players.map((p) => p.name).join(', ')} /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {r.isPrime ? <Tag label="Prime time" tone="warning" /> : null}
          {r.seriesId ? <Tag label="Recurring" tone="violet" /> : null}
          {myPlayer?.checkedInAt ? <Tag label="Checked in" tone="tint" /> : null}
          {!mine ? <Tag label="You're playing" tone="teal" /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {canCheckIn ? <Button small title="Check In" icon="checkCircle" onPress={checkIn} /> : null}
          {mine ? <Button small kind="destructiveSoft" title="Cancel" onPress={cancel} /> : <Button small kind="destructiveSoft" title="Leave" onPress={leave} />}
        </View>
        {mine && late && r.startsAt > now ? (
          <Small style={{ color: c.warning }}>Cancelling now is a late cancellation.</Small>
        ) : null}
      </View>
    </Card>
  );
}

function Meta({ icon, text }: { icon: 'calendar' | 'clock' | 'users'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <Icon name={icon} size={15} color={c.secondaryLabel} />
      <Small muted={false} numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Small>
    </View>
  );
}
