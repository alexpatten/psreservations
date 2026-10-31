import { isStaff, type Club, type Court, type PrimeTime, type Reservation, type Schedule, type Scheduler } from './api';
import { minutesOf, parseHm, weekday, zonedMs } from './time';

/** A court, the court it's part of and the courts that are part of it (combo courts): booking one blocks the others. */
export function linkedCourts(club: Club, courtId: string): string[] {
  const court = club.courts.find((c) => c.id === courtId);
  const ids = new Set([courtId]);
  if (court?.parentId) ids.add(court.parentId);
  for (const c of club.courts) if (c.parentId === courtId) ids.add(c.id);
  return [...ids];
}

/** Schedulers you can use: members see the ones open for member booking, staff see all. */
export function visibleSchedulers(club: Club): Scheduler[] {
  return isStaff(club.myRole) ? club.schedulers : club.schedulers.filter((s) => s.membersCanBook);
}

export function schedulerCourts(club: Club, scheduler: Scheduler): Court[] {
  const byId = new Map(club.courts.map((c) => [c.id, c]));
  return scheduler.courtIds.map((id) => byId.get(id)).filter((c): c is Court => !!c);
}

/** Booked, or a public booking still waiting for payment. */
export function takesCourt(r: Reservation): boolean {
  return r.status === 'booked' || (r.status === 'held' && (r.holdExpiresAt ?? 0) > Date.now());
}

/** Why a court isn't free then (a closure or another reservation), or null when it is. */
export function conflictAt(club: Club, schedule: Schedule, courtId: string, start: number, end: number, exceptId?: string): string | null {
  const linked = linkedCourts(club, courtId);
  for (const x of schedule.closures) {
    if (x.startsAt < end && x.endsAt > start && (x.courtIds.length === 0 || x.courtIds.some((id) => linked.includes(id)))) {
      return x.reason ? `Closed: ${x.reason}` : 'Closed';
    }
  }
  for (const r of schedule.reservations) {
    if (takesCourt(r) && r.id !== exceptId && linked.includes(r.courtId) && r.startsAt < end && r.endsAt > start) {
      return r.courtId === courtId ? 'Booked' : 'Part of this court is booked';
    }
  }
  return null;
}

/** Prime time windows a reservation on this court, day and minutes would overlap. */
export function primeTimesFor(club: Club, courtId: string, day: string, startMin: number, endMin: number): PrimeTime[] {
  const linked = linkedCourts(club, courtId);
  const dow = weekday(day);
  return club.primeTimes.filter(
    (p) =>
      p.days.includes(dow) &&
      (p.courtIds.length === 0 || p.courtIds.some((id) => linked.includes(id))) &&
      startMin < parseHm(p.ends) &&
      endMin > parseHm(p.starts),
  );
}

/** The longest a member may book on this court, counting the court's and prime time's limits. */
export function maxMinutesFor(club: Club, court: Court, primes: PrimeTime[]): number {
  let max = court.maxMinutes ?? club.rules.maxMinutes;
  for (const p of primes) if (p.maxMinutes != null) max = Math.min(max, p.maxMinutes);
  return max;
}

export function minMinutesFor(club: Club, court: Court): number {
  return court.minMinutes ?? club.rules.minMinutes;
}

/** Start times (minutes since midnight) on a scheduler for a day. */
export function slotStarts(scheduler: Scheduler): number[] {
  const out: number[] = [];
  for (let m = parseHm(scheduler.opens); m < parseHm(scheduler.closes); m += scheduler.slotMinutes) out.push(m);
  return out;
}

export function isOpenOn(scheduler: Scheduler, day: string) {
  return scheduler.days.includes(weekday(day));
}

/** A reservation's start and end in minutes since the day's midnight, in the club's zone (may run past 1440). */
export function spanOnDay(startsAt: number, endsAt: number, day: string, tz: string) {
  const dayStart = zonedMs(day, 0, tz);
  const start = startsAt < dayStart ? 0 : minutesOf(startsAt, tz);
  return { start, end: start + Math.round((endsAt - Math.max(startsAt, dayStart)) / 60_000) };
}
