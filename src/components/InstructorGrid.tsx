import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Club, Instructor, Reservation, Schedule } from '@/lib/api';
import { spanOnDay, takesCourt } from '@/lib/schedule';
import { textOn, type, useColors } from '@/lib/theme';
import { clock, minutesOf, parseHm, timeRange, today, weekday, zonedMs } from '@/lib/time';
import { Avatar } from './Avatar';

const PPM = 1.6;
const TIME_COL = 64;
const SLOT = 30;

/**
 * The instructor scheduler: a column per pro for the day. Their teaching hours are open (tap to
 * book a lesson then), other hours and time off are gray, and their lessons and clinic dates
 * are blocks in the lesson type's color.
 */
export function InstructorGrid({
  club,
  instructors,
  day,
  schedule,
  timeOff,
  onSlot,
  onReservation,
}: {
  club: Club;
  instructors: Instructor[];
  day: string;
  schedule: Schedule;
  timeOff: { instructorId: string; startsAt: number; endsAt: number; reason: string | null }[];
  onSlot: (instructor: Instructor, startsAt: number) => void;
  onReservation: (r: Reservation) => void;
}) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const tz = club.timezone;
  const dow = weekday(day);
  const windows = instructors.flatMap((i) => i.availability.filter((a) => a.days.includes(dow)));
  const rangeStart = Math.min(7 * 60, ...windows.map((a) => Math.floor(parseHm(a.starts) / 60) * 60));
  const rangeEnd = Math.max(21 * 60, ...windows.map((a) => Math.ceil(parseHm(a.ends) / 60) * 60));
  const rows: number[] = [];
  for (let m = rangeStart; m < rangeEnd; m += SLOT) rows.push(m);
  const colWidth = Math.max(140, Math.floor((Math.min(width, 1400) - 32 - TIME_COL) / Math.max(instructors.length, 1)));
  const nowMin = day === today(tz) ? minutesOf(Date.now(), tz) : day < today(tz) ? 1440 : -1;

  const open = (i: Instructor, m: number) =>
    i.availability.some((a) => a.days.includes(dow) && m >= parseHm(a.starts) && m + SLOT <= parseHm(a.ends));
  const off = (i: Instructor, m: number) => {
    const s = zonedMs(day, m, tz);
    return timeOff.some((t) => t.instructorId === i.id && t.startsAt < s + SLOT * 60_000 && t.endsAt > s);
  };
  const teaching = (i: Instructor) => schedule.reservations.filter((r) => r.instructorId === i.id && takesCourt(r));
  const busy = (i: Instructor, m: number) => {
    const s = zonedMs(day, m, tz);
    return teaching(i).some((r) => r.startsAt < s + SLOT * 60_000 && r.endsAt > s);
  };

  return (
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ minWidth: TIME_COL + colWidth * instructors.length, flex: 1 }}>
        <View style={{ flexDirection: 'row', height: 60, borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.card }}>
          <View style={{ width: TIME_COL }} />
          {instructors.map((i) => (
            <View key={i.id} style={{ width: colWidth, flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.gridLine }}>
              <Avatar name={i.name} color={i.color} size={30} />
              <Text style={[type.subheadline, { color: c.label, fontWeight: '600' }]} numberOfLines={1}>
                {i.name}
              </Text>
            </View>
          ))}
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 10, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', height: (rangeEnd - rangeStart) * PPM }}>
            <View style={{ width: TIME_COL }}>
              {rows.map((m) => (
                <View key={m} style={{ height: SLOT * PPM, paddingRight: 8, alignItems: 'flex-end' }}>
                  {m % 60 === 0 ? <Text style={[type.caption, { color: c.secondaryLabel, marginTop: -7 }]}>{clock(m, true)}</Text> : null}
                </View>
              ))}
            </View>
            {instructors.map((i) => (
              <View key={i.id} style={{ width: colWidth, flexGrow: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.gridLine }}>
                {rows.map((m) => {
                  const bookable = open(i, m) && !off(i, m) && !busy(i, m) && m >= nowMin;
                  return (
                    <Pressable
                      key={m}
                      disabled={!bookable}
                      onPress={() => onSlot(i, zonedMs(day, m, tz))}
                      accessibilityLabel={`Book ${i.name} at ${clock(m)}`}
                      style={({ hovered }) => ({
                        height: SLOT * PPM,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: m % 60 === 0 ? c.gridLine : c.gridHalfLine,
                        backgroundColor: !open(i, m) || off(i, m) || m < nowMin ? c.closed : hovered && bookable ? c.tintSoft : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      })}
                    >
                      {({ hovered }) =>
                        hovered && bookable ? <Text style={[type.caption, { color: c.tint, fontWeight: '600' }]}>+ {clock(m)}</Text> : null
                      }
                    </Pressable>
                  );
                })}
                {timeOff
                  .filter((t) => t.instructorId === i.id)
                  .map((t, n) => {
                    const span = spanOnDay(t.startsAt, t.endsAt, day, tz);
                    const top = Math.max(span.start, rangeStart);
                    const bottom = Math.min(span.end, rangeEnd);
                    if (bottom <= top) return null;
                    return (
                      <View
                        key={n}
                        pointerEvents="none"
                        style={{ position: 'absolute', left: 2, right: 2, top: (top - rangeStart) * PPM, height: (bottom - top) * PPM, borderRadius: 8, backgroundColor: c.slateFill, padding: 6 }}
                      >
                        <Text style={[type.caption, { color: c.slateText, fontWeight: '600' }]}>Off{t.reason ? `: ${t.reason}` : ''}</Text>
                      </View>
                    );
                  })}
                {teaching(i).map((r) => {
                  const span = spanOnDay(r.startsAt, r.endsAt, day, tz);
                  const color = club.types.find((t) => t.id === r.typeId)?.color ?? i.color;
                  const fg = textOn(color);
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => onReservation(r)}
                      style={{
                        position: 'absolute',
                        left: 3,
                        right: 3,
                        top: (span.start - rangeStart) * PPM + 1,
                        height: (Math.min(span.end, rangeEnd) - span.start) * PPM - 3,
                        borderRadius: 8,
                        backgroundColor: color,
                        padding: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <Text style={[type.caption, { color: fg, fontWeight: '700' }]} numberOfLines={1}>
                        {r.title || 'Lesson'}
                      </Text>
                      <Text style={[type.caption, { color: fg, opacity: 0.9 }]} numberOfLines={1}>
                        {timeRange(r.startsAt, r.endsAt, tz)} · {club.courts.find((x) => x.id === r.courtId)?.name}
                      </Text>
                      <Text style={[type.caption, { color: fg, opacity: 0.85 }]} numberOfLines={2}>
                        {r.players.map((p) => p.name).join(', ')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}
