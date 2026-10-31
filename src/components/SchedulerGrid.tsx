import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Club, Court, Reservation, Schedule, Scheduler } from '@/lib/api';
import { conflictAt, isOpenOn, linkedCourts, primeTimesFor, spanOnDay, takesCourt } from '@/lib/schedule';
import { textOn, type, useColors } from '@/lib/theme';
import { clock, minutesOf, parseHm, timeRange, today, zonedMs } from '@/lib/time';
import { Icon } from './Icon';

/** Pixels per minute: a 30-minute slot is 48 px tall. */
const PPM = 1.6;
const TIME_COL = 64;
const HEADER = 52;

export interface DropTarget {
  /** The reservation being moved. */
  id: string;
  courtId: string;
  startsAt: number;
  endsAt: number;
}

/**
 * The day's scheduler: a column per court, a row per slot. Tap an open slot to book it, a
 * reservation to see it. Staff drag reservations to another court or time (when `draggable`).
 */
export function SchedulerGrid({
  club,
  scheduler,
  courts,
  day,
  schedule,
  onSlot,
  onReservation,
  onMove,
  draggable,
}: {
  club: Club;
  scheduler: Scheduler;
  courts: Court[];
  day: string;
  schedule: Schedule;
  onSlot: (court: Court, startMin: number) => void;
  onReservation: (r: Reservation) => void;
  onMove: (r: Reservation, target: DropTarget) => void;
  draggable: boolean;
}) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const tz = club.timezone;
  const slot = scheduler.slotMinutes;
  const open = isOpenOn(scheduler, day);

  const courtIds = useMemo(() => new Set(courts.flatMap((ct) => linkedCourts(club, ct.id))), [club, courts]);
  const reservations = schedule.reservations.filter((r) => takesCourt(r) && courtIds.has(r.courtId));

  // The scheduler's hours, stretched to show anything booked outside them.
  let rangeStart = parseHm(scheduler.opens);
  let rangeEnd = parseHm(scheduler.closes);
  for (const r of reservations) {
    const span = spanOnDay(r.startsAt, r.endsAt, day, tz);
    rangeStart = Math.min(rangeStart, Math.floor(span.start / slot) * slot);
    rangeEnd = Math.max(rangeEnd, Math.min(1440, Math.ceil(span.end / slot) * slot));
  }
  const rows: number[] = [];
  for (let m = rangeStart; m < rangeEnd; m += slot) rows.push(m);
  const height = (rangeEnd - rangeStart) * PPM;

  const colWidth = Math.max(132, Math.floor((Math.min(width, 1400) - 32 - TIME_COL) / Math.max(courts.length, 1)));
  const isToday = day === today(tz);
  const nowMin = isToday ? minutesOf(Date.now(), tz) : day < today(tz) ? 1440 : -1;
  const dayStart = zonedMs(day, 0, tz);
  const msAt = (min: number) => zonedMs(day, min, tz);

  const [target, setTarget] = useState<DropTarget | null>(null);

  const dropTarget = (r: Reservation, dx: number, dy: number): DropTarget => {
    const fromCol = courts.findIndex((ct) => ct.id === r.courtId);
    const col = Math.min(courts.length - 1, Math.max(0, fromCol + Math.round(dx / colWidth)));
    const shift = Math.round(dy / PPM / slot) * slot;
    return { id: r.id, courtId: courts[col].id, startsAt: r.startsAt + shift * 60_000, endsAt: r.endsAt + shift * 60_000 };
  };

  return (
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ minWidth: TIME_COL + colWidth * courts.length, flex: 1 }}>
        {/* Court names */}
        <View style={{ flexDirection: 'row', height: HEADER, borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.card }}>
          <View style={{ width: TIME_COL }} />
          {courts.map((ct) => (
            <View key={ct.id} style={{ width: colWidth, flexGrow: 1, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.gridLine, paddingHorizontal: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {ct.kind === 'ball_machine' ? <Icon name="machine" size={14} color={c.secondaryLabel} /> : null}
                <Text style={[type.subheadline, { color: c.label, fontWeight: '600' }]} numberOfLines={1}>
                  {ct.name}
                </Text>
              </View>
              <Text style={[type.caption, { color: c.secondaryLabel }]} numberOfLines={1}>
                {[ct.kind === 'ball_machine' ? 'Ball machine' : ct.sport[0].toUpperCase() + ct.sport.slice(1), ct.indoor ? 'Indoor' : null, !ct.membersCanBook ? 'Staff only' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 10, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', height }}>
            {/* Times */}
            <View style={{ width: TIME_COL }}>
              {rows.map((m) => (
                <View key={m} style={{ height: slot * PPM, paddingRight: 8, alignItems: 'flex-end' }}>
                  {m % 60 === 0 || slot >= 60 ? (
                    <Text style={[type.caption, { color: c.secondaryLabel, marginTop: -7 }]}>{clock(m, true)}</Text>
                  ) : null}
                </View>
              ))}
            </View>

            {courts.map((ct) => {
              const linked = linkedCourts(club, ct.id).filter((id) => id !== ct.id);
              return (
                <View key={ct.id} style={{ width: colWidth, flexGrow: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.gridLine }}>
                  {/* Open slots */}
                  {rows.map((m) => {
                    const inHours = open && m >= parseHm(scheduler.opens) && m + slot <= parseHm(scheduler.closes);
                    const past = m + slot <= nowMin;
                    const prime = primeTimesFor(club, ct.id, day, m, m + slot).length > 0;
                    const free = !conflictAt(club, schedule, ct.id, msAt(m), msAt(m + slot));
                    return (
                      <Pressable
                        key={m}
                        disabled={!free || past}
                        onPress={() => onSlot(ct, m)}
                        accessibilityLabel={`Book ${ct.name} at ${clock(m)}`}
                        style={({ hovered }: { hovered?: boolean }) => ({
                          height: slot * PPM,
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: m % 60 === 0 ? c.gridLine : c.gridHalfLine,
                          backgroundColor: !inHours || past ? c.closed : hovered && free ? c.tintSoft : prime ? c.warningFill + '99' : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        })}
                      >
                        {({ hovered }: { hovered?: boolean }) =>
                          hovered && free && !past ? (
                            <Text style={[type.caption, { color: c.tint, fontWeight: '600' }]}>+ {clock(m)}</Text>
                          ) : null
                        }
                      </Pressable>
                    );
                  })}

                  {/* Closures */}
                  {schedule.closures
                    .filter((x) => x.courtIds.length === 0 || x.courtIds.some((id) => id === ct.id || linked.includes(id)))
                    .map((x) => {
                      const span = spanOnDay(x.startsAt, x.endsAt, day, tz);
                      const top = Math.max(span.start, rangeStart);
                      const bottom = Math.min(span.end, rangeEnd);
                      if (bottom <= top) return null;
                      return (
                        <View
                          key={x.id}
                          pointerEvents="none"
                          style={{
                            position: 'absolute',
                            left: 2,
                            right: 2,
                            top: (top - rangeStart) * PPM,
                            height: (bottom - top) * PPM,
                            borderRadius: 8,
                            backgroundColor: c.slateFill,
                            borderWidth: 1,
                            borderColor: c.cardBorder,
                            borderStyle: 'dashed',
                            padding: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Icon name="ban" size={12} color={c.slateText} />
                            <Text style={[type.caption, { color: c.slateText, fontWeight: '600' }]} numberOfLines={2}>
                              Closed{x.reason ? `: ${x.reason}` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    })}

                  {/* Blocked by a linked (combo) court */}
                  {reservations
                    .filter((r) => linked.includes(r.courtId))
                    .map((r) => {
                      const span = spanOnDay(r.startsAt, r.endsAt, day, tz);
                      const other = club.courts.find((x) => x.id === r.courtId);
                      return (
                        <View
                          key={`linked-${r.id}`}
                          pointerEvents="none"
                          style={{
                            position: 'absolute',
                            left: 2,
                            right: 2,
                            top: (span.start - rangeStart) * PPM,
                            height: (Math.min(span.end, rangeEnd) - span.start) * PPM - 2,
                            borderRadius: 8,
                            backgroundColor: c.fill,
                            padding: 6,
                          }}
                        >
                          <Text style={[type.caption, { color: c.secondaryLabel }]} numberOfLines={2}>
                            In use ({other?.name})
                          </Text>
                        </View>
                      );
                    })}

                  {/* Reservations */}
                  {reservations
                    .filter((r) => r.courtId === ct.id)
                    .map((r) => (
                      <ReservationBlock
                        key={r.id}
                        club={club}
                        reservation={r}
                        top={(spanOnDay(r.startsAt, r.endsAt, day, tz).start - rangeStart) * PPM}
                        height={(Math.min(spanOnDay(r.startsAt, r.endsAt, day, tz).end, rangeEnd) - spanOnDay(r.startsAt, r.endsAt, day, tz).start) * PPM}
                        draggable={draggable}
                        onPress={() => onReservation(r)}
                        onDrag={(dx, dy) => setTarget(dx || dy ? dropTarget(r, dx, dy) : null)}
                        onDrop={(dx, dy) => {
                          setTarget(null);
                          const t = dropTarget(r, dx, dy);
                          if (t.courtId !== r.courtId || t.startsAt !== r.startsAt) onMove(r, t);
                        }}
                        compact={colWidth < 150}
                      />
                    ))}

                  {/* Where a dragged reservation would land */}
                  {target && target.courtId === ct.id ? (() => {
                    const blocked = !!conflictAt(club, schedule, target.courtId, target.startsAt, target.endsAt, target.id);
                    return (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: 2,
                        right: 2,
                        top: ((target.startsAt - dayStart) / 60_000 - rangeStart) * PPM,
                        height: ((target.endsAt - target.startsAt) / 60_000) * PPM - 2,
                        borderRadius: 8,
                        borderWidth: 2,
                        borderStyle: 'dashed',
                        borderColor: blocked ? c.destructive : c.tint,
                        backgroundColor: blocked ? c.destructive + '22' : c.tintSoft + '88',
                        zIndex: 5,
                      }}
                    />
                    );
                  })() : null}
                </View>
              );
            })}

            {isToday && nowMin >= rangeStart && nowMin <= rangeEnd ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: TIME_COL - 6, right: 0, top: (nowMin - rangeStart) * PPM - 1, flexDirection: 'row', alignItems: 'center', zIndex: 10 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.now }} />
                <View style={{ flex: 1, height: 2, backgroundColor: c.now }} />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function ReservationBlock({
  club,
  reservation: r,
  top,
  height,
  draggable,
  onPress,
  onDrag,
  onDrop,
  compact,
}: {
  club: Club;
  reservation: Reservation;
  top: number;
  height: number;
  draggable: boolean;
  onPress: () => void;
  onDrag: (dx: number, dy: number) => void;
  onDrop: (dx: number, dy: number) => void;
  compact: boolean;
}) {
  const t = club.types.find((x) => x.id === r.typeId);
  const color = t?.color ?? '#0A8754';
  // A public booking waiting for payment: outlined, not filled.
  const held = r.status === 'held';
  const fg = held ? '#10241A' : textOn(color);
  const tz = club.timezone;
  const pan = useRef(new Animated.ValueXY()).current;
  const [dragging, setDragging] = useState(false);
  const handlers = useRef({ onDrag, onDrop });
  handlers.current = { onDrag, onDrop };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => draggable && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
        onMoveShouldSetPanResponderCapture: (_, g) => draggable && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: (_, g) => {
          pan.setValue({ x: g.dx, y: g.dy });
          handlers.current.onDrag(g.dx, g.dy);
        },
        onPanResponderRelease: (_, g) => {
          pan.setValue({ x: 0, y: 0 });
          setDragging(false);
          handlers.current.onDrop(g.dx, g.dy);
        },
        onPanResponderTerminate: () => {
          pan.setValue({ x: 0, y: 0 });
          setDragging(false);
          handlers.current.onDrag(0, 0);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [draggable, pan],
  );

  const checkedIn = r.players.length > 0 && r.players.every((p) => p.checkedInAt);
  const names = r.players.map((p) => p.name).join(', ');
  const short = height < 44;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={{
        position: 'absolute',
        left: 3,
        right: 3,
        top: top + 1,
        height: Math.max(height - 3, 18),
        transform: pan.getTranslateTransform(),
        zIndex: dragging ? 20 : 2,
        opacity: dragging ? 0.85 : 1,
        // The web shows a grab hand on draggable blocks.
        ...({ cursor: draggable ? (dragging ? 'grabbing' : 'grab') : 'pointer', userSelect: draggable ? 'none' : undefined } as object),
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityLabel={`${t?.name ?? 'Reservation'} ${timeRange(r.startsAt, r.endsAt, tz)}`}
        style={({ hovered }: { hovered?: boolean }) => ({
          flex: 1,
          borderRadius: 8,
          backgroundColor: held ? color + '22' : color,
          borderWidth: held ? 1.5 : 0,
          borderStyle: 'dashed',
          borderColor: color,
          paddingHorizontal: 7,
          paddingVertical: short ? 2 : 5,
          overflow: 'hidden',
          boxShadow: hovered || dragging ? '0 4px 14px rgba(14,42,34,0.3)' : '0 1px 2px rgba(14,42,34,0.2)',
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {checkedIn ? <Icon name="checkCircle" size={12} color={fg} /> : null}
          {r.seriesId ? <Icon name="repeat" size={11} color={fg} /> : null}
          {r.isPublic ? <Icon name="link" size={11} color={fg} /> : null}
          <Text style={[type.caption, { color: fg, fontWeight: '700', flex: 1 }]} numberOfLines={1}>
            {held ? 'Awaiting payment' : r.title || t?.name}
          </Text>
          {r.isPrime && !compact ? <Text style={[type.caption, { color: fg, opacity: 0.85 }]}>★</Text> : null}
        </View>
        {!short ? (
          <Text style={[type.caption, { color: fg, opacity: 0.9 }]} numberOfLines={1}>
            {timeRange(r.startsAt, r.endsAt, tz)}
          </Text>
        ) : null}
        {height > 70 && names ? (
          <Text style={[type.caption, { color: fg, opacity: 0.9 }]} numberOfLines={Math.max(1, Math.floor((height - 46) / 16))}>
            {names}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
