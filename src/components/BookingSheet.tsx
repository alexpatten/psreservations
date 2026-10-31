import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as api from '@/lib/api';
import { conflictAt, maxMinutesFor, minMinutesFor, primeTimesFor, schedulerCourts, slotStarts } from '@/lib/schedule';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, DAY_SHORT, dayLabel, dayOf, duration, hm, parseHm, weekday, zonedMs } from '@/lib/time';
import { notice, toast } from './Dialogs';
import { Banner, Body, Button, Chip, ChipRow, DateField, Divider, ErrorText, Field, Segmented, Small, Sheet, Toggle } from './ui';

/** Who a staff booking is for. */
type For = 'me' | 'member' | 'none';

export function BookingSheet({
  club,
  scheduler,
  schedule,
  day,
  court: initialCourt,
  startMin: initialStart,
  onClose,
  onBooked,
}: {
  club: api.Club;
  scheduler: api.Scheduler;
  schedule: api.Schedule;
  day: string;
  court: api.Court;
  startMin: number;
  onClose: () => void;
  onBooked: () => void;
}) {
  const c = useColors();
  const tz = club.timezone;
  const staff = api.isStaff(club.myRole);
  const courts = schedulerCourts(club, scheduler).filter((ct) => staff || ct.membersCanBook);
  const types = club.types.filter((t) => staff || t.membersCanBook);

  const [courtId, setCourtId] = useState(initialCourt.id);
  const court = club.courts.find((ct) => ct.id === courtId) ?? initialCourt;
  const [startMin, setStartMin] = useState(initialStart);
  const [minutes, setMinutes] = useState(() => Math.max(minMinutesFor(club, initialCourt), 60 - (60 % scheduler.slotMinutes)));
  const [typeId, setTypeId] = useState(() => (initialCourt.kind === 'ball_machine' ? types.find((t) => /ball/i.test(t.name)) : undefined)?.id ?? types[0]?.id);
  const rtype = club.types.find((t) => t.id === typeId);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [guests, setGuests] = useState<string[]>([]);
  const [guest, setGuest] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [bookFor, setBookFor] = useState<For>('me');
  const [ownerCode, setOwnerCode] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>([weekday(day)]);
  const [until, setUntil] = useState(addDays(day, 56));
  const [error, setError] = useState<string | null>(null);

  const startsAt = zonedMs(day, startMin, tz);
  const endsAt = startsAt + minutes * 60_000;
  const primes = primeTimesFor(club, courtId, day, startMin, startMin + minutes);
  const minLen = staff ? scheduler.slotMinutes : minMinutesFor(club, court);
  // Staff aren't held to limits; longer bookings than this can be stretched with Move.
  const maxLen = staff ? 4 * 60 : maxMinutesFor(club, court, primeTimesFor(club, courtId, day, startMin, startMin + scheduler.slotMinutes));

  // Start times on this court that aren't taken.
  const starts = useMemo(() => {
    const now = Date.now();
    return slotStarts(scheduler).filter((m) => {
      const s = zonedMs(day, m, tz);
      return s + scheduler.slotMinutes * 60_000 > now && !conflictAt(club, schedule, courtId, s, s + scheduler.slotMinutes * 60_000);
    });
  }, [scheduler, day, tz, club, schedule, courtId]);

  const lengths = useMemo(() => {
    const out: { minutes: number; free: boolean }[] = [];
    const closes = staff ? 1440 : parseHm(scheduler.closes);
    for (let m = Math.max(minLen, scheduler.slotMinutes); m <= maxLen && startMin + m <= closes; m += scheduler.slotMinutes) {
      out.push({ minutes: m, free: !conflictAt(club, schedule, courtId, startsAt, startsAt + m * 60_000) });
    }
    return out;
  }, [minLen, maxLen, scheduler, startMin, club, schedule, courtId, startsAt, staff]);

  // Keep the length valid when the court or start changes.
  useEffect(() => {
    const ok = lengths.filter((l) => l.free);
    if (ok.length && !ok.some((l) => l.minutes === minutes)) setMinutes(ok[Math.min(ok.length - 1, 1)].minutes);
  }, [lengths, minutes]);

  const playerCount = (bookFor === 'none' ? 0 : 1) + codes.length + guests.length;

  const addCode = () => {
    const v = code.trim().toUpperCase();
    if (!v) return;
    if (!codes.includes(v)) setCodes([...codes, v]);
    setCode('');
  };
  const addGuest = () => {
    const v = guest.trim();
    if (!v) return;
    setGuests([...guests, v]);
    setGuest('');
  };

  const submit = async () => {
    setError(null);
    if (!rtype) return setError('Choose a reservation type.');
    try {
      if (repeat && staff) {
        const result = await api.createSeries({
          courtId,
          typeId: rtype.id,
          days: repeatDays,
          startTime: hm(startMin),
          minutes,
          from: day,
          until,
          title,
          ownerCode: bookFor === 'member' ? ownerCode : undefined,
        });
        onBooked();
        await notice(
          `Booked ${result.created} reservation${result.created === 1 ? '' : 's'}`,
          result.skipped.length
            ? `Skipped ${result.skipped.length} date${result.skipped.length === 1 ? '' : 's'} that weren't free:\n` +
                result.skipped.map((s) => `${dayLabel(s.date)}: ${s.reason}`).join('\n')
            : undefined,
        );
      } else {
        await api.book({
          courtId,
          typeId: rtype.id,
          startsAt,
          endsAt,
          playerCodes: [...codes, code.trim()].filter(Boolean),
          guests: [...guests, guest.trim()].filter(Boolean),
          title,
          notes,
          custom,
          ownerCode: staff && bookFor === 'member' ? ownerCode : undefined,
          noOwner: staff && bookFor === 'none',
        });
        toast(`Booked ${court.name}, ${dayLabel(day)} at ${clock(startMin)}.`);
        onBooked();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Book ${court.name}`}
      accent={rtype?.color}
      footer={
        <>
          <View style={{ flex: 1, minWidth: 180, justifyContent: 'center' }}>
            <Small muted={false}>
              {dayLabel(day)} · {clock(startMin)} – {clock(startMin + minutes)}
            </Small>
            <Small>{duration(minutes)}{primes.length ? ' · prime time' : ''}</Small>
          </View>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title={repeat ? 'Book Series' : 'Book Court'} onPress={submit} disabled={!lengths.some((l) => l.free && l.minutes === minutes)} />
        </>
      }
    >
      {club.suspendedUntil && !staff ? (
        <Banner tone="error" icon="ban">
          Your booking at {club.name} is paused until {dayLabel(dayOf(club.suspendedUntil, tz))} because of late
          cancellations or no-shows.
        </Banner>
      ) : null}

      <Section label="Court">
        <ChipRow>
          {courts.map((ct) => (
            <Chip key={ct.id} label={ct.name} selected={ct.id === courtId} onPress={() => setCourtId(ct.id)} icon={ct.kind === 'ball_machine' ? 'machine' : undefined} />
          ))}
        </ChipRow>
      </Section>

      <Section label={`Start · ${dayLabel(day, { long: true })}`}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(starts.includes(startMin) ? starts : [startMin, ...starts].sort((a, b) => a - b)).map((m) => (
            <Chip key={m} small label={clock(m)} selected={m === startMin} onPress={() => setStartMin(m)} />
          ))}
        </ScrollView>
      </Section>

      <Section label="Length">
        <ChipRow>
          {lengths.map((l) => (
            <Chip key={l.minutes} small label={duration(l.minutes)} selected={l.minutes === minutes} onPress={l.free ? () => setMinutes(l.minutes) : undefined} />
          ))}
        </ChipRow>
        {lengths.length === 0 ? <Small style={{ color: c.destructive }}>This court isn’t free long enough at {clock(startMin)}.</Small> : null}
        {primes.map((p) => (
          <Banner key={p.id} tone="warning" icon="star">
            {p.name} ({clock(parseHm(p.starts))} – {clock(parseHm(p.ends))}):{' '}
            {[
              p.maxMinutes ? `up to ${duration(p.maxMinutes)}` : null,
              p.maxPerWeek ? `${p.maxPerWeek} per week` : null,
              p.advanceDays != null ? `book up to ${p.advanceDays} days ahead` : null,
            ]
              .filter(Boolean)
              .join(', ') || 'busy hours'}
            .
          </Banner>
        ))}
      </Section>

      <Section label="Type">
        <ChipRow>
          {types.map((t) => (
            <Chip key={t.id} label={t.name} color={t.color} selected={t.id === typeId} onPress={() => setTypeId(t.id)} />
          ))}
        </ChipRow>
        {rtype ? (
          <Small>
            {rtype.minPlayers > 1 ? `${rtype.minPlayers}–${rtype.maxPlayers}` : `Up to ${rtype.maxPlayers}`} players · {playerCount} so far
            {!rtype.membersCanBook ? ' · staff only' : ''}
          </Small>
        ) : null}
      </Section>

      {staff ? (
        <Section label="Book For">
          <Segmented<For>
            value={bookFor}
            onChange={setBookFor}
            options={[
              { value: 'me', label: 'Me' },
              { value: 'member', label: 'A Player' },
              { value: 'none', label: 'No One (Club Event)' },
            ]}
          />
          {bookFor === 'member' ? (
            <Field placeholder="Their Player ID, e.g. K7RM2QXP" value={ownerCode} onChangeText={setOwnerCode} autoCapitalize="characters" hint="They're added to the club if they aren't a member yet." />
          ) : null}
        </Section>
      ) : null}

      {!repeat ? (
        <Section label="Players">
          <Small>Add Pickle Spots players by their Player ID (in the app under Profile), or guests by name.</Small>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field style={{ flex: 1 }} placeholder="Player ID" value={code} onChangeText={setCode} autoCapitalize="characters" onSubmitEditing={addCode} />
            <Button kind="secondary" title="Add" onPress={addCode} disabled={!code.trim()} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field style={{ flex: 1 }} placeholder="Guest name" value={guest} onChangeText={setGuest} onSubmitEditing={addGuest} />
            <Button kind="secondary" title="Add" onPress={addGuest} disabled={!guest.trim()} />
          </View>
          {codes.length || guests.length ? (
            <ChipRow>
              {codes.map((x) => (
                <Chip key={x} small label={`${x} ✕`} selected onPress={() => setCodes(codes.filter((y) => y !== x))} />
              ))}
              {guests.map((x, i) => (
                <Chip key={`${x}-${i}`} small label={`${x} (guest) ✕`} selected onPress={() => setGuests(guests.filter((_, j) => j !== i))} />
              ))}
            </ChipRow>
          ) : null}
        </Section>
      ) : null}

      <Field label="Title (optional)" value={title} onChangeText={setTitle} placeholder={rtype?.name} maxLength={80} />
      {!repeat ? <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={500} /> : null}

      {!repeat && club.customFields.length ? (
        <>
          <Divider />
          {club.customFields.map((f) => (
            <CustomFieldInput key={f.id} field={f} value={custom[f.id]} onChange={(v) => setCustom({ ...custom, [f.id]: v })} />
          ))}
        </>
      ) : null}

      {staff ? (
        <>
          <Divider />
          <Toggle label="Repeat Weekly" hint="Recurring or seasonal reservations. Dates already taken are skipped." value={repeat} onChange={setRepeat} />
          {repeat ? (
            <>
              <ChipRow>
                {DAY_SHORT.map((d, i) => (
                  <Chip
                    key={d}
                    small
                    label={d}
                    selected={repeatDays.includes(i)}
                    onPress={() => setRepeatDays(repeatDays.includes(i) ? repeatDays.filter((x) => x !== i) : [...repeatDays, i].sort())}
                  />
                ))}
              </ChipRow>
              <DateField label="Through" value={until} min={day} max={addDays(day, 366)} onChange={setUntil} />
            </>
          ) : null}
        </>
      ) : (
        <Small>
          {club.rules.cancelCutoffHours > 0
            ? `Cancel at least ${club.rules.cancelCutoffHours} hours ahead; later cancellations and no-shows count as strikes.`
            : 'No-shows count as strikes.'}
        </Small>
      )}

      <ErrorText error={error} />
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.footnote, { color: c.secondaryLabel, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }]}>{label}</Text>
      {children}
    </View>
  );
}

export function CustomFieldInput({ field, value, onChange }: { field: api.CustomField; value: unknown; onChange: (v: unknown) => void }) {
  const label = field.label + (field.required ? ' *' : '');
  if (field.type === 'checkbox') return <Toggle label={label} value={value === true} onChange={onChange} />;
  if (field.type === 'select') {
    return (
      <View style={{ gap: 8 }}>
        <Body>{label}</Body>
        <ChipRow>
          {(field.options ?? []).map((o) => (
            <Chip key={o} small label={o} selected={value === o} onPress={() => onChange(o)} />
          ))}
        </ChipRow>
      </View>
    );
  }
  return (
    <Field
      label={label}
      value={value == null ? '' : String(value)}
      keyboardType={field.type === 'number' ? 'number-pad' : 'default'}
      onChangeText={(t) => onChange(field.type === 'number' ? (t === '' ? '' : Number(t.replace(/[^0-9.]/g, ''))) : t)}
    />
  );
}
