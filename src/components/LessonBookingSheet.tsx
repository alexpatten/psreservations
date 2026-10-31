import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as api from '@/lib/api';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, DAY_SHORT, dayLabel, duration, minutesOf, money, timeOf, today, weekday } from '@/lib/time';
import { toast } from './Dialogs';
import { Banner, Body, Button, Chip, ChipRow, ErrorText, Field, Loading, Sheet, Small } from './ui';

const LENGTHS = [30, 45, 60, 90, 120];

/**
 * Books a private lesson: pick the length, players, day and one of the instructor's open
 * times (each with its price). Staff can also book it for a member by player ID.
 */
export function LessonBookingSheet({
  club,
  lessons,
  instructor,
  initialDay,
  initialStart,
  onClose,
  onBooked,
}: {
  club: api.Club;
  lessons: api.Lessons;
  instructor: api.Instructor;
  initialDay?: string;
  initialStart?: number;
  onClose: () => void;
  onBooked: () => void;
}) {
  const c = useColors();
  const tz = club.timezone;
  const staff = api.isStaff(club.myRole);
  const lessonTypes = club.types.filter((t) => lessons.lessonTypeIds.includes(t.id));
  const [typeId, setTypeId] = useState(lessonTypes[0]?.id);
  const rtype = lessonTypes.find((t) => t.id === typeId);
  const [minutes, setMinutes] = useState(60);
  const [players, setPlayers] = useState(1);
  const days = useMemo(() => Array.from({ length: (staff ? 30 : club.rules.advanceDays) + 1 }, (_, i) => addDays(today(tz), i)), [club.rules.advanceDays, staff, tz]);
  const [day, setDay] = useState(initialDay ?? days[0]);
  const [times, setTimes] = useState<{ startsAt: number; priceCents: number | null }[] | null>(null);
  const [startsAt, setStartsAt] = useState<number | null>(initialStart ?? null);
  const [codes, setCodes] = useState('');
  const [notes, setNotes] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTimes(null);
    api.lessonTimes(instructor.id, day, minutes, players).then(
      (t) => {
        setTimes(t);
        setStartsAt((s) => (s && t.some((x) => x.startsAt === s) ? s : null));
      },
      (e: Error) => {
        setTimes([]);
        setError(e.message);
      },
    );
  }, [instructor.id, day, minutes, players]);

  const chosen = times?.find((t) => t.startsAt === startsAt);
  const maxPlayers = rtype?.maxPlayers ?? 4;

  const book = async () => {
    if (!startsAt || !rtype) return;
    setError(null);
    try {
      const extra = codes
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      await api.bookLesson({
        instructorId: instructor.id,
        typeId: rtype.id,
        startsAt,
        minutes,
        playerCodes: extra,
        // Players beyond those with IDs come as guests.
        guests: Array.from({ length: Math.max(0, players - 1 - extra.length) }, (_, i) => `Guest ${i + 2}`),
        notes,
        ownerCode: staff && ownerCode.trim() ? ownerCode : undefined,
      });
      toast(`Lesson with ${instructor.name} booked for ${dayLabel(day)} at ${timeOf(startsAt, tz)}.`);
      onBooked();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Lesson with ${instructor.name}`}
      accent={instructor.color}
      footer={
        <>
          <View style={{ flex: 1, minWidth: 160, justifyContent: 'center' }}>
            {startsAt ? (
              <>
                <Small muted={false}>
                  {dayLabel(day)} · {clock(minutesOf(startsAt, tz))} – {clock(minutesOf(startsAt, tz) + minutes)}
                </Small>
                <Small>{chosen?.priceCents != null ? money(chosen.priceCents) : 'Price at the desk'}</Small>
              </>
            ) : (
              <Small>Pick a time</Small>
            )}
          </View>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Book Lesson" onPress={book} disabled={!startsAt || !rtype} />
        </>
      }
    >
      {instructor.bio ? <Body muted>{instructor.bio}</Body> : null}
      {lessonTypes.length === 0 ? <Banner tone="warning">The club hasn’t set up a lesson type yet.</Banner> : null}
      {lessonTypes.length > 1 ? (
        <ChipRow>
          {lessonTypes.map((t) => (
            <Chip key={t.id} label={t.name} color={t.color} selected={t.id === typeId} onPress={() => setTypeId(t.id)} />
          ))}
        </ChipRow>
      ) : null}
      <Label text="Length" />
      <ChipRow>
        {LENGTHS.map((m) => (
          <Chip key={m} small label={duration(m)} selected={m === minutes} onPress={() => setMinutes(m)} />
        ))}
      </ChipRow>
      {maxPlayers > 1 ? (
        <>
          <Label text="Players" />
          <ChipRow>
            {Array.from({ length: Math.min(maxPlayers, 6) }, (_, i) => i + 1).map((n) => (
              <Chip key={n} small label={n === 1 ? 'Just me' : String(n)} selected={n === players} onPress={() => setPlayers(n)} />
            ))}
          </ChipRow>
        </>
      ) : null}
      <Label text="Day" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d, i) => (
          <Chip key={d} small label={i === 0 ? 'Today' : `${DAY_SHORT[weekday(d)]} ${Number(d.slice(8))}`} selected={d === day} onPress={() => setDay(d)} />
        ))}
      </ScrollView>
      <Label text={`Open Times · ${dayLabel(day, { long: true })}`} />
      {times === null ? (
        <Loading />
      ) : times.length === 0 ? (
        <Small>{instructor.name} has no open times that day. Try another.</Small>
      ) : (
        <ChipRow>
          {times.map((t) => (
            <Chip
              key={t.startsAt}
              small
              label={`${timeOf(t.startsAt, tz)}${t.priceCents != null ? ` · ${money(t.priceCents)}` : ''}`}
              selected={t.startsAt === startsAt}
              onPress={() => setStartsAt(t.startsAt)}
            />
          ))}
        </ChipRow>
      )}
      {players > 1 ? <Field label="Other Players’ IDs (optional)" value={codes} onChangeText={setCodes} autoCapitalize="characters" hint="Separate with commas. Anyone else comes as a guest." /> : null}
      <Field label="Notes for the Pro (optional)" value={notes} onChangeText={setNotes} multiline maxLength={500} placeholder="What would you like to work on?" />
      {staff ? <Field label="Book For (Player ID)" value={ownerCode} onChangeText={setOwnerCode} autoCapitalize="characters" hint="Leave empty to book for yourself." /> : null}
      {!staff && club.rules.cancelCutoffHours > 0 ? (
        <Small>Cancel at least {club.rules.cancelCutoffHours} hours ahead; later cancellations and no-shows count as strikes.</Small>
      ) : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

function Label({ text }: { text: string }) {
  const c = useColors();
  return <Text style={[type.footnote, { color: c.secondaryLabel, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }]}>{text}</Text>;
}
