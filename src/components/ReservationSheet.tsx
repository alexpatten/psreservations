import { useState } from 'react';
import { Text, View } from 'react-native';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLessons } from '@/lib/lessons';
import { conflictAt } from '@/lib/schedule';
import { type, useColors } from '@/lib/theme';
import { clock, dayLabel, dayOf, duration, hm, minutesOf, money, parseHm, timeOf, timeRange, zonedMs } from '@/lib/time';
import { CustomFieldInput } from './BookingSheet';
import { confirm, toast } from './Dialogs';
import { Icon } from './Icon';
import { Banner, Body, Button, Chip, ChipRow, DateField, Divider, ErrorText, Field, Sheet, Small, Tag, TimeField } from './ui';

type Mode = 'view' | 'edit' | 'move';

export function ReservationSheet({
  club,
  reservation: initial,
  schedule,
  onClose,
  onChanged,
}: {
  club: api.Club;
  reservation: api.Reservation;
  schedule: api.Schedule;
  onClose: () => void;
  onChanged: () => void;
}) {
  const c = useColors();
  const { session } = useAuth();
  const me = session?.user.id;
  const tz = club.timezone;
  const staff = api.isStaff(club.myRole);
  const [r, setR] = useState(initial);
  const [mode, setMode] = useState<Mode>('view');
  const [error, setError] = useState<string | null>(null);

  const rtype = club.types.find((t) => t.id === r.typeId);
  const { data: lessons } = useLessons(club.id);
  const instructorName = lessons?.instructors.find((i) => i.id === r.instructorId)?.name;
  const court = club.courts.find((x) => x.id === r.courtId);
  const mine = r.ownerId === me;
  const myPlayer = r.players.find((p) => p.userId === me);
  const now = Date.now();
  const started = now >= r.startsAt;
  const minutes = Math.round((r.endsAt - r.startsAt) / 60_000);
  const late = club.rules.cancelCutoffHours > 0 && r.startsAt - now < club.rules.cancelCutoffHours * 3_600_000;
  const canSelfCheckIn = !!myPlayer && !myPlayer.checkedInAt && now >= r.startsAt - club.rules.checkInMinutesBefore * 60_000 && now < r.endsAt;

  const run = async (action: () => Promise<api.Reservation | void>, done?: string) => {
    setError(null);
    try {
      const next = await action();
      if (next) setR(next);
      if (done) toast(done);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cancel = async () => {
    const note =
      late && mine && !staff
        ? `It's less than ${club.rules.cancelCutoffHours} hours before the start, so this is a late cancellation: a strike${club.rules.lateCancelFeeCents ? ` and a ${money(club.rules.lateCancelFeeCents)} fee` : ''}.`
        : staff
          ? 'Staff cancellations have no penalty.'
          : 'The court will be released for others to book.';
    if (r.isPublic) {
      // A guest's online booking: cancelling refunds what they paid and texts them.
      const paid = (r.paidCents ?? 0) - (r.refundedCents ?? 0);
      const msg = r.status === 'held' ? 'The guest hasn’t paid yet; the court is released.' : paid > 0 ? `${money(paid)} is refunded to the guest’s card, and they get a text.` : 'The guest gets a text.';
      if (!(await confirm('Cancel this online booking?', msg, { confirmLabel: 'Cancel Booking', cancelLabel: 'Keep It', destructive: true }))) return;
      setError(null);
      try {
        await api.staffCancelPublic(r.id);
        toast(paid > 0 && r.status !== 'held' ? `Cancelled and refunded ${money(paid)}.` : 'Booking cancelled.');
        onChanged();
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (!(await confirm('Cancel this reservation?', note, { confirmLabel: 'Cancel Reservation', cancelLabel: 'Keep It', destructive: true }))) return;
    await run(() => api.cancelReservation(r.id), 'Reservation cancelled.');
    onClose();
  };

  const cancelSeries = async () => {
    if (!r.seriesId) return;
    if (!(await confirm('Cancel the whole series?', 'Every upcoming reservation in this series will be cancelled.', { confirmLabel: 'Cancel Series', destructive: true }))) return;
    setError(null);
    try {
      const n = await api.cancelSeries(r.seriesId);
      toast(`Cancelled ${n} reservation${n === 1 ? '' : 's'}.`);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saved = (next: api.Reservation) => {
    setR(next);
    setMode('view');
    onChanged();
  };
  if (mode === 'edit') return <EditSheet club={club} reservation={r} onClose={() => setMode('view')} onSaved={saved} />;
  if (mode === 'move') return <MoveSheet club={club} reservation={r} schedule={schedule} onClose={() => setMode('view')} onSaved={saved} />;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={r.title || rtype?.name || 'Reservation'}
      accent={rtype?.color}
      footer={
        <>
          {myPlayer && !mine && !staff ? (
            <Button
              kind="destructiveSoft"
              title="Leave"
              onPress={async () => {
                await run(() => api.leaveReservation(r.id), 'You left the reservation.');
                onClose();
              }}
            />
          ) : null}
          {(mine || staff) && r.endsAt > now ? <Button kind="destructiveSoft" title="Cancel Reservation" onPress={cancel} /> : null}
          {(mine || staff) && r.endsAt > now && !r.isPublic ? <Button kind="secondary" icon="edit" title="Edit" onPress={() => setMode('edit')} /> : null}
          {staff ? <Button kind="secondary" icon="move" title="Move" onPress={() => setMode('move')} /> : null}
          {canSelfCheckIn ? <Button icon="checkCircle" title="Check In" onPress={() => run(() => api.checkIn(r.id), 'You’re checked in.')} /> : null}
        </>
      }
    >
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {rtype ? <Tag label={rtype.name} tone="tint" /> : null}
          {r.isPrime ? <Tag label="Prime time" tone="warning" /> : null}
          {r.seriesId ? <Tag label="Recurring" tone="violet" /> : null}
          {mine ? <Tag label="Your reservation" tone="teal" /> : null}
        </View>
        <InfoRow icon="calendar" text={dayLabel(dayOf(r.startsAt, tz), { long: true })} />
        <InfoRow icon="clock" text={`${timeRange(r.startsAt, r.endsAt, tz)} · ${duration(minutes)}`} />
        <InfoRow icon={court?.kind === 'ball_machine' ? 'machine' : 'grid'} text={court?.name ?? 'Court'} />
        {r.instructorId && instructorName ? <InfoRow icon="users" text={`With ${instructorName}`} /> : null}
      </View>

      {!r.isPublic && (r.amountCents ?? 0) > 0 && (staff || mine) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.slateFill, borderRadius: 12, padding: 12 }}>
          <Text style={[type.subheadline, { color: c.slateText, flex: 1 }]}>
            {money(r.amountCents ?? 0)} · {(r.paidCents ?? 0) >= (r.amountCents ?? 0) ? 'paid' : (r.paidCents ?? 0) > 0 ? `${money(r.paidCents ?? 0)} paid` : 'due at the front desk'}
          </Text>
          {staff && (r.paidCents ?? 0) < (r.amountCents ?? 0) ? (
            <Button small kind="secondary" title="Mark Paid" onPress={() => run(async () => { await api.setPaid({ reservationId: r.id }, r.amountCents ?? 0); return { ...r, paidCents: r.amountCents }; }, 'Marked paid.')} />
          ) : null}
        </View>
      ) : null}

      {r.isPublic && staff ? (
        <View style={{ gap: 6, backgroundColor: c.tealFill, borderRadius: 12, padding: 12 }}>
          <Text style={[type.headline, { color: c.tealText }]}>Booked online{r.status === 'held' ? ' · awaiting payment' : ''}</Text>
          {r.publicGuest ? (
            <Small muted={false}>
              {r.publicGuest.name} · {r.publicGuest.phone}
              {r.publicGuest.email ? ` · ${r.publicGuest.email}` : ''}
              {r.publicGuest.bookings > 1 ? ` · ${r.publicGuest.bookings} bookings` : ' · first booking'}
            </Small>
          ) : null}
          <Small muted={false}>
            {r.status === 'held' && r.holdExpiresAt
              ? `Held until ${timeOf(r.holdExpiresAt, tz)} for payment of ${money(r.amountCents ?? 0)}.`
              : `Paid ${money(r.paidCents ?? 0)}${r.refundedCents ? `, refunded ${money(r.refundedCents)}` : ''}.`}
          </Small>
        </View>
      ) : null}

      <Divider />
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[type.headline, { color: c.label }]}>Players</Text>
          {staff && r.players.some((p) => !p.checkedInAt) && now >= r.startsAt - 60 * 60_000 ? (
            <Button small kind="secondary" icon="checkCircle" title="Check In All" onPress={() => run(() => api.checkIn(r.id))} />
          ) : null}
        </View>
        {r.players.length === 0 ? <Small>No players listed{r.ownerId ? '' : ' (club event)'}.</Small> : null}
        {r.players.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, flexWrap: 'wrap' }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: p.checkedInAt ? c.tint : p.noShow ? c.destructive + '22' : c.fill,
              }}
            >
              {p.checkedInAt ? (
                <Icon name="check" size={16} color={c.onTint} />
              ) : p.noShow ? (
                <Icon name="x" size={16} color={c.destructive} />
              ) : (
                <Text style={[type.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>{p.name.slice(0, 1)}</Text>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 120 }}>
              <Body>
                {p.name}
                {p.userId && p.userId === r.ownerId ? <Text style={{ color: c.secondaryLabel }}> · booked it</Text> : null}
              </Body>
              <Small>
                {p.guest ? 'Guest' : (p.playerCode ?? '')}
                {p.checkedInAt ? ` · checked in ${timeOf(p.checkedInAt, tz)}` : p.noShow ? ' · no-show' : ''}
              </Small>
            </View>
            {staff ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {p.checkedInAt ? (
                  <Button small kind="plain" title="Undo" onPress={() => run(() => api.checkIn(r.id, p.id, true))} />
                ) : (
                  <Button small kind="secondary" title="Check In" onPress={() => run(() => api.checkIn(r.id, p.id))} />
                )}
                {started && !p.checkedInAt ? (
                  <Button
                    small
                    kind={p.noShow ? 'plain' : 'destructiveSoft'}
                    title={p.noShow ? 'Undo No-Show' : 'No-Show'}
                    onPress={() => run(() => api.markNoShow(r.id, p.id, p.noShow))}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {r.notes ? (
        <>
          <Divider />
          <View style={{ gap: 4 }}>
            <Text style={[type.headline, { color: c.label }]}>Notes</Text>
            <Body muted>{r.notes}</Body>
          </View>
        </>
      ) : null}

      {club.customFields.some((f) => r.custom[f.id] != null && r.custom[f.id] !== '') ? (
        <>
          <Divider />
          {club.customFields
            .filter((f) => r.custom[f.id] != null && r.custom[f.id] !== '')
            .map((f) => (
              <View key={f.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Small>{f.label}</Small>
                <Body>{f.type === 'checkbox' ? (r.custom[f.id] ? 'Yes' : 'No') : String(r.custom[f.id])}</Body>
              </View>
            ))}
        </>
      ) : null}

      {mine && !staff && late && r.startsAt > now ? (
        <Banner tone="warning" icon="clock">
          Cancelling now counts as a late cancellation.
        </Banner>
      ) : null}
      {staff && r.seriesId ? <Button kind="plain" icon="repeat" title="Cancel All Upcoming in This Series" onPress={cancelSeries} /> : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

function InfoRow({ icon, text }: { icon: 'calendar' | 'clock' | 'grid' | 'machine' | 'users'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={18} color={c.tint} />
      <Body>{text}</Body>
    </View>
  );
}

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function EditSheet({ club, reservation: r, onClose, onSaved }: { club: api.Club; reservation: api.Reservation; onClose: () => void; onSaved: (r: api.Reservation) => void }) {
  const staff = api.isStaff(club.myRole);
  const [typeId, setTypeId] = useState(r.typeId);
  const [title, setTitle] = useState(r.title ?? '');
  const [notes, setNotes] = useState(r.notes ?? '');
  const [custom, setCustom] = useState<Record<string, unknown>>(r.custom);
  const [codes, setCodes] = useState(
    r.players
      .filter((p) => !p.guest && p.userId !== r.ownerId)
      .map((p) => p.playerCode ?? '')
      .filter(Boolean)
      .join(', '),
  );
  const [guests, setGuests] = useState(
    r.players
      .filter((p) => p.guest)
      .map((p) => p.name)
      .join(', '),
  );
  const [error, setError] = useState<string | null>(null);
  const rtype = club.types.find((t) => t.id === typeId);

  const save = async () => {
    setError(null);
    try {
      onSaved(await api.editReservation(r.id, { ...(staff ? { typeId } : {}), title, notes, custom, playerCodes: splitList(codes), guests: splitList(guests) }));
      toast('Reservation updated.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Edit Reservation"
      accent={rtype?.color}
      footer={
        <>
          <Button kind="secondary" title="Back" onPress={onClose} />
          <Button title="Save" onPress={save} />
        </>
      }
    >
      {staff ? (
        <ChipRow>
          {club.types.map((t) => (
            <Chip key={t.id} label={t.name} color={t.color} selected={t.id === typeId} onPress={() => setTypeId(t.id)} />
          ))}
        </ChipRow>
      ) : null}
      <Field label="Title" value={title} onChangeText={setTitle} placeholder={rtype?.name} maxLength={80} />
      <Field label="Player IDs" value={codes} onChangeText={setCodes} autoCapitalize="characters" hint="Separate with commas. Whoever booked it stays on." />
      <Field label="Guests" value={guests} onChangeText={setGuests} hint="Names, separated with commas." />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={500} />
      {club.customFields.map((f) => (
        <CustomFieldInput key={f.id} field={f} value={custom[f.id]} onChange={(v) => setCustom({ ...custom, [f.id]: v })} />
      ))}
      <ErrorText error={error} />
    </Sheet>
  );
}

function MoveSheet({
  club,
  reservation: r,
  schedule,
  onClose,
  onSaved,
}: {
  club: api.Club;
  reservation: api.Reservation;
  schedule: api.Schedule;
  onClose: () => void;
  onSaved: (r: api.Reservation) => void;
}) {
  const tz = club.timezone;
  const [courtId, setCourtId] = useState(r.courtId);
  const [day, setDay] = useState(dayOf(r.startsAt, tz));
  const [start, setStart] = useState(hm(minutesOf(r.startsAt, tz)));
  const [minutes, setMinutes] = useState(Math.round((r.endsAt - r.startsAt) / 60_000));
  const [error, setError] = useState<string | null>(null);

  const startsAt = zonedMs(day, parseHm(start), tz);
  const endsAt = startsAt + minutes * 60_000;
  // Only the day on screen is loaded; the server checks other days.
  const known = day === dayOf(r.startsAt, tz) ? conflictAt(club, schedule, courtId, startsAt, endsAt, r.id) : null;
  const lengths = [...new Set([30, 60, 90, 120, 150, 180, 240, minutes])].sort((a, b) => a - b);

  const save = async () => {
    setError(null);
    try {
      onSaved(await api.moveReservation(r.id, courtId, startsAt, endsAt));
      toast(`Moved to ${club.courts.find((x) => x.id === courtId)?.name} at ${clock(parseHm(start))}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Move Reservation"
      footer={
        <>
          <Button kind="secondary" title="Back" onPress={onClose} />
          <Button title="Move" onPress={save} disabled={!!known} />
        </>
      }
    >
      <Small>Staff moves skip the booking rules but can’t overlap another reservation or a closure. On a computer you can also drag reservations on the schedule.</Small>
      <ChipRow>
        {club.courts.map((ct) => (
          <Chip key={ct.id} label={ct.name} selected={ct.id === courtId} onPress={() => setCourtId(ct.id)} />
        ))}
      </ChipRow>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <DateField label="Day" value={day} onChange={setDay} />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <TimeField label="Start" value={start} onChange={setStart} />
        </View>
      </View>
      <ChipRow>
        {lengths.map((n) => (
          <Chip key={n} small label={duration(n)} selected={n === minutes} onPress={() => setMinutes(n)} />
        ))}
      </ChipRow>
      {known ? <Banner tone="warning">{known} at that time.</Banner> : null}
      <ErrorText error={error} />
    </Sheet>
  );
}
