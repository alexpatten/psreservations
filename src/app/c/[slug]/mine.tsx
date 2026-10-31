import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { confirm, toast } from '@/components/Dialogs';
import { ReservationCard } from '@/components/ReservationCard';
import { Banner, Body, Button, Card, Empty, ErrorText, Heading, Loading, Page, Row, Small, Tag, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { dayLabel, dayOf, money, timeOf } from '@/lib/time';

export default function MyClubReservations() {
  const wide = useWide();
  const { club } = useClub();
  const tz = club.timezone;
  const [upcoming, setUpcoming] = useState<api.MyReservation[] | null>(null);
  const [strikes, setStrikes] = useState<api.Strike[]>([]);
  const [doorCodes, setDoorCodes] = useState<api.DoorCode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.myDoorCodes(club.id).then(setDoorCodes, () => {});
    Promise.all([api.myReservations(club.id), api.strikes(club.id)])
      .then(([u, s]) => {
        setUpcoming(u);
        setStrikes(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [club.id]);
  useFocusEffect(load);

  const r = club.rules;
  const windowStart = Date.now() - r.strikeWindowDays * 86_400_000;
  const active = strikes.filter((s) => !s.waivedAt && s.createdAt > windowStart);

  const leave = async () => {
    if (!(await confirm(`Leave ${club.name}?`, 'Your upcoming reservations here will be cancelled (without penalty).', { confirmLabel: 'Leave Club', destructive: true }))) return;
    try {
      await api.leaveClub(club.id);
      toast(`You left ${club.name}.`);
      router.replace('/');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Page>
      <ErrorText error={error} />
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 3 : undefined, gap: 12, width: '100%' }}>
          <Heading right={<Button small title="Book a Court" icon="plus" onPress={() => router.push(`/c/${club.slug}`)} />}>Upcoming</Heading>
          {doorCodes.length ? (
            <Card style={{ gap: 8 }}>
              <Body style={{ fontWeight: '600' }}>Door Codes</Body>
              {doorCodes.map((d, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 26, fontWeight: '800', letterSpacing: 4, color: d.pending ? '#999' : '#0A8754' }}>{d.code}</Text>
                  <Small style={{ flex: 1 }}>
                    {d.door} · {dayLabel(dayOf(d.startsAt, tz))} {timeOf(d.startsAt, tz)}–{timeOf(d.endsAt, tz)}
                    {d.pending ? ' · being set on the lock' : ''}
                  </Small>
                </View>
              ))}
            </Card>
          ) : null}
          {upcoming === null ? (
            <Loading />
          ) : upcoming.length === 0 ? (
            <Card>
              <Empty icon="calendar" title="Nothing booked">
                Open the schedule and tap a free time to book a court.
              </Empty>
            </Card>
          ) : (
            upcoming.map((x) => <ReservationCard key={x.id} reservation={x} onChange={load} />)
          )}
        </View>

        <View style={{ flex: wide ? 2 : undefined, gap: 12, width: '100%' }}>
          <Heading>Booking Rules</Heading>
          <Card padded={false}>
            <Row title="Book ahead" right={<Small muted={false}>{r.advanceDays} days</Small>} />
            <Row title="Length" right={<Small muted={false}>{r.minMinutes}–{r.maxMinutes} min</Small>} />
            <Row title="Upcoming reservations at once" right={<Small muted={false}>{r.maxUpcoming}</Small>} />
            <Row title="Reservations per day" right={<Small muted={false}>{r.maxPerDay}</Small>} />
            <Row
              title="Cancel without penalty"
              right={<Small muted={false}>{r.cancelCutoffHours ? `${r.cancelCutoffHours}+ hours ahead` : 'Any time'}</Small>}
            />
            <Row title="Self check-in opens" right={<Small muted={false}>{r.checkInMinutesBefore} min before</Small>} last={!club.primeTimes.length} />
            {club.primeTimes.map((p, i) => (
              <Row
                key={p.id}
                title={p.name}
                subtitle={[p.maxMinutes ? `up to ${p.maxMinutes} min` : null, p.maxPerWeek ? `${p.maxPerWeek} per week` : null, p.advanceDays != null ? `${p.advanceDays} days ahead` : null]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Tag label={`${p.starts}–${p.ends}`} tone="warning" />}
                last={i === club.primeTimes.length - 1}
              />
            ))}
          </Card>

          <Heading>Strikes</Heading>
          {r.strikeLimit > 0 ? (
            <Small>
              Late cancellations and no-shows are strikes. {r.strikeLimit} in {r.strikeWindowDays} days pauses booking for {r.suspensionDays} days.
            </Small>
          ) : (
            <Small>Late cancellations and no-shows are recorded, but don’t pause booking.</Small>
          )}
          {club.suspendedUntil ? (
            <Banner tone="error" icon="ban">
              Booking paused until {dayLabel(dayOf(club.suspendedUntil, tz))}.
            </Banner>
          ) : null}
          <Card padded={false}>
            {strikes.length === 0 ? (
              <Empty icon="checkCircle" title="No strikes">
                Thanks for keeping the courts moving.
              </Empty>
            ) : (
              strikes.map((s, i) => (
                <Row
                  key={s.id}
                  title={s.kind === 'late_cancel' ? 'Late cancellation' : 'No-show'}
                  subtitle={`${s.courtName ?? ''}${s.reservationStartsAt ? ` · ${dayLabel(dayOf(s.reservationStartsAt, tz))}` : ''}${s.feeCents ? ` · ${money(s.feeCents)} fee` : ''}`}
                  right={s.waivedAt ? <Tag label="Waived" tone="tint" /> : active.includes(s) ? <Tag label="Active" tone="danger" /> : <Tag label="Expired" />}
                  last={i === strikes.length - 1}
                />
              ))
            )}
          </Card>
          {club.myRole && club.myRole !== 'owner' ? <Button kind="destructiveSoft" title={`Leave ${club.name}`} onPress={leave} /> : null}
        </View>
      </View>
    </Page>
  );
}
