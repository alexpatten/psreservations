import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { BookingSheet } from '@/components/BookingSheet';
import { confirm, toast } from '@/components/Dialogs';
import { InstructorGrid } from '@/components/InstructorGrid';
import { LessonBookingSheet } from '@/components/LessonBookingSheet';
import { ReservationSheet } from '@/components/ReservationSheet';
import { SchedulerGrid, type DropTarget } from '@/components/SchedulerGrid';
import { Banner, Button, Card, Chip, DateField, Empty, ErrorText, IconButton, Loading, Small, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useLessons } from '@/lib/lessons';
import { conflictAt, isOpenOn, schedulerCourts, visibleSchedulers } from '@/lib/schedule';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, DAY_SHORT, dayLabel, dayOf, duration, parseHm, relativeDay, timeOf, today, zonedMs } from '@/lib/time';

/** How often the schedule refreshes while it's open. */
const REFRESH_MS = 30_000;

export default function ClubSchedule() {
  const c = useColors();
  const wide = useWide();
  const { club, setClub } = useClub();
  const params = useLocalSearchParams<{ day?: string; view?: string }>();
  const tz = club.timezone;
  const staff = api.isStaff(club.myRole);
  const member = !!club.myRole;

  const [day, setDay] = useState(() => (typeof params.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today(tz)));
  const schedulers = visibleSchedulers(club);
  const [schedulerId, setSchedulerId] = useState(() => (typeof params.view === 'string' && schedulers.some((s) => s.id === params.view) ? params.view : schedulers[0]?.id));
  const scheduler = schedulers.find((s) => s.id === schedulerId) ?? schedulers[0];
  const courts = useMemo(() => (scheduler ? schedulerCourts(club, scheduler) : []), [club, scheduler]);

  const [schedule, setSchedule] = useState<api.Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ court: api.Court; startMin: number } | null>(null);
  const [selected, setSelected] = useState<api.Reservation | null>(null);
  // Courts, or the instructor scheduler (a column per pro).
  const [view, setView] = useState<'courts' | 'instructors'>(params.view === 'instructors' ? 'instructors' : 'courts');
  const { data: lessons } = useLessons(club.id);
  const instructors = lessons?.instructors ?? [];
  const [timeOff, setTimeOff] = useState<Awaited<ReturnType<typeof api.instructorTimeOff>>>([]);
  const [lessonSlot, setLessonSlot] = useState<{ instructor: api.Instructor; startsAt: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setSchedule(await api.schedule(club.id, zonedMs(day, 0, tz), zonedMs(addDays(day, 1), 0, tz)));
      if (member) api.instructorTimeOff(club.id, zonedMs(day, 0, tz), zonedMs(addDays(day, 1), 0, tz)).then(setTimeOff, () => {});
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [club.id, day, tz, member]);

  useEffect(() => {
    setSchedule(null);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    router.setParams({ day, view: view === 'instructors' ? 'instructors' : scheduler?.id });
  }, [day, scheduler?.id, view]);

  const join = async () => {
    const ok = await confirm(`Join ${club.name}?`, 'Club staff will see your full name and email so they can run your reservations.', { confirmLabel: 'Join Club' });
    if (!ok) return;
    try {
      setClub(await api.joinClub(club.id));
      toast(`Welcome to ${club.name}!`);
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const onSlot = (court: api.Court, startMin: number) => {
    if (!member) {
      join();
      return;
    }
    setBooking({ court, startMin });
  };

  const onMove = async (r: api.Reservation, target: DropTarget) => {
    if (!schedule) return;
    const conflict = conflictAt(club, schedule, target.courtId, target.startsAt, target.endsAt, r.id);
    if (conflict) {
      toast(`${club.courts.find((x) => x.id === target.courtId)?.name ?? 'That court'} isn’t free then.`);
      return;
    }
    // Show it moved right away, and put it back if the server says no.
    const before = schedule;
    setSchedule({ ...schedule, reservations: schedule.reservations.map((x) => (x.id === r.id ? { ...x, courtId: target.courtId, startsAt: target.startsAt, endsAt: target.endsAt } : x)) });
    try {
      await api.moveReservation(r.id, target.courtId, target.startsAt, target.endsAt);
      toast(`Moved to ${club.courts.find((x) => x.id === target.courtId)?.name} at ${timeOf(target.startsAt, tz)}.`);
      load();
    } catch (e) {
      setSchedule(before);
      toast((e as Error).message);
    }
  };

  const isToday = day === today(tz);
  const rules = club.rules;
  const lastBookable = addDays(today(tz), rules.advanceDays);

  return (
    <View style={{ flex: 1 }}>
      {/* Toolbar */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10, width: '100%', maxWidth: 1400, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="chevronLeft" label="Previous day" onPress={() => setDay(addDays(day, -1))} />
            <IconButton icon="chevronRight" label="Next day" onPress={() => setDay(addDays(day, 1))} />
          </View>
          <View style={{ minWidth: 150 }}>
            <Text style={[type.title3, { color: c.label }]}>{relativeDay(day, tz)}</Text>
            <Small>{dayLabel(day, { long: true })}</Small>
          </View>
          {!isToday ? <Button small kind="secondary" title="Today" onPress={() => setDay(today(tz))} /> : null}
          <View style={{ flex: 1 }} />
          {wide ? (
            <View style={{ width: 180 }}>
              <DateField value={day} onChange={setDay} />
            </View>
          ) : null}
        </View>

        {/* Next week at a glance */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {Array.from({ length: 14 }, (_, i) => addDays(today(tz), i)).map((d) => {
            const on = d === day;
            const [, , dd] = d.split('-');
            return (
              <Chip
                key={d}
                small
                label={`${DAY_SHORT[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(dd)}`}
                selected={on}
                onPress={() => setDay(d)}
              />
            );
          })}
        </ScrollView>

        {schedulers.length > 1 || (member && instructors.length > 0) ? (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {schedulers.map((s) => (
              <Chip key={s.id} icon="grid" label={s.name} selected={view === 'courts' && s.id === scheduler?.id} onPress={() => { setView('courts'); setSchedulerId(s.id); }} />
            ))}
            {member && instructors.length > 0 ? (
              <Chip icon="users" label="Instructors" selected={view === 'instructors'} onPress={() => setView('instructors')} />
            ) : null}
          </View>
        ) : null}

        {!member ? (
          <Banner tone="info" icon="users">
            You can see when courts are free. Join {club.name} to book.{' '}
            <Text onPress={join} style={{ color: c.tint, fontWeight: '700' }}>
              Join Club
            </Text>
          </Banner>
        ) : null}
        {member && !staff && club.suspendedUntil ? (
          <Banner tone="error" icon="ban">
            Your booking is paused until {dayLabel(dayOf(club.suspendedUntil, tz))} because of late cancellations or no-shows.
          </Banner>
        ) : null}
        {member && !staff && day > lastBookable ? (
          <Banner tone="info" icon="calendar">
            Members can book up to {rules.advanceDays} days ahead (through {dayLabel(lastBookable)}).
          </Banner>
        ) : null}
        {scheduler && !isOpenOn(scheduler, day) ? (
          <Banner tone="info" icon="clock">
            {scheduler.name} isn’t open on {dayLabel(day, { long: true }).split(',')[0]}s{staff ? '. Staff can still book.' : '.'}
          </Banner>
        ) : null}
        <ErrorText error={error} />
      </View>

      {view === 'instructors' && schedule && lessons ? (
        <View style={{ flex: 1, marginHorizontal: wide ? 16 : 0, marginBottom: wide ? 12 : 0, backgroundColor: c.card, borderRadius: wide ? 16 : 0, borderWidth: wide ? 1 : 0, borderTopWidth: 1, borderColor: c.cardBorder, overflow: 'hidden' }}>
          <InstructorGrid
            club={club}
            instructors={staff ? instructors : instructors.filter((i) => i.membersCanBook)}
            day={day}
            schedule={schedule}
            timeOff={timeOff}
            onSlot={(instructor, startsAt) => setLessonSlot({ instructor, startsAt })}
            onReservation={setSelected}
          />
        </View>
      ) : !scheduler || courts.length === 0 ? (
        <Card style={{ margin: 16 }}>
          <Empty icon="grid" title="No courts to book yet">
            {staff ? 'Add courts and a scheduler under Manage.' : 'This club hasn’t opened any courts for booking yet.'}
          </Empty>
          {api.isManager(club.myRole) ? <Button title="Set Up Courts" onPress={() => router.push(`/c/${club.slug}/manage`)} /> : null}
        </Card>
      ) : !schedule ? (
        <Loading />
      ) : (
        <View style={{ flex: 1, marginHorizontal: wide ? 16 : 0, marginBottom: wide ? 12 : 0, backgroundColor: c.card, borderRadius: wide ? 16 : 0, borderWidth: wide ? 1 : 0, borderTopWidth: 1, borderColor: c.cardBorder, overflow: 'hidden' }}>
          <SchedulerGrid
            club={club}
            scheduler={scheduler}
            courts={courts}
            day={day}
            schedule={schedule}
            onSlot={onSlot}
            onReservation={setSelected}
            onMove={onMove}
            draggable={staff && wide}
          />
        </View>
      )}

      {scheduler && member && view === 'courts' ? <Legend club={club} scheduler={scheduler} /> : null}
      {lessonSlot && lessons ? (
        <LessonBookingSheet
          club={club}
          lessons={lessons}
          instructor={lessonSlot.instructor}
          initialDay={day}
          initialStart={lessonSlot.startsAt}
          onClose={() => setLessonSlot(null)}
          onBooked={() => {
            setLessonSlot(null);
            load();
          }}
        />
      ) : null}

      {booking && scheduler && schedule ? (
        <BookingSheet
          club={club}
          scheduler={scheduler}
          schedule={schedule}
          day={day}
          court={booking.court}
          startMin={booking.startMin}
          onClose={() => setBooking(null)}
          onBooked={() => {
            setBooking(null);
            load();
          }}
        />
      ) : null}
      {selected && schedule ? (
        <ReservationSheet club={club} reservation={selected} schedule={schedule} onClose={() => setSelected(null)} onChanged={load} />
      ) : null}
    </View>
  );
}

/** The types' colors and the rules, under the grid. */
function Legend({ club, scheduler }: { club: api.Club; scheduler: api.Scheduler }) {
  const c = useColors();
  const wide = useWide();
  if (!wide) return null;
  const r = club.rules;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 20, paddingBottom: 14, alignItems: 'center', maxWidth: 1400, width: '100%', alignSelf: 'center' }}>
      {club.types.map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.color }} />
          <Small>{t.name}</Small>
        </View>
      ))}
      {club.primeTimes.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.warningFill, borderWidth: 1, borderColor: c.warning }} />
          <Small>Prime time</Small>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Small>
        {clock(parseHm(scheduler.opens), true)} – {clock(parseHm(scheduler.closes), true)} · {scheduler.slotMinutes}-min slots · {duration(r.minMinutes)}–{duration(r.maxMinutes)} · book {r.advanceDays} days ahead
      </Small>
    </View>
  );
}
