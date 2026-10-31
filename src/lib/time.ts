/**
 * Times in a club's own time zone. Moments are epoch milliseconds (as the database sends
 * them); days are 'YYYY-MM-DD' strings in the club's zone; times of day are minutes since
 * midnight.
 */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const p: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute };
}

/** How far the zone is ahead of UTC at a moment, in ms. */
function offsetAt(ms: number, tz: string) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(ms / 60000) * 60000;
}

/** The moment a day and time of day happen in the zone. */
export function zonedMs(day: string, minutes: number, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return second;
}

export function dayOf(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function minutesOf(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return p.hour * 60 + p.minute;
}

export function today(tz: string): string {
  return dayOf(Date.now(), tz);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "07:30" → 450; "24:00" → 1440. */
export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function hm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 450 → "7:30 AM", 720 → "12 PM" when short. */
export function clock(minutes: number, short = false): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (short && min === 0) return `${h12} ${suffix}`;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

export function timeOf(ms: number, tz: string, short = false): string {
  return clock(minutesOf(ms, tz), short);
}

export function timeRange(startMs: number, endMs: number, tz: string): string {
  return `${timeOf(startMs, tz)} – ${timeOf(endMs, tz)}`;
}

/** "Tue, Jul 20" (with the year when it isn't this year). */
export function dayLabel(day: string, opts: { long?: boolean } = {}): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: opts.long ? 'long' : 'short',
    month: opts.long ? 'long' : 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "Today", "Tomorrow", or the day's label. */
export function relativeDay(day: string, tz: string): string {
  const t = today(tz);
  if (day === t) return 'Today';
  if (day === addDays(t, 1)) return 'Tomorrow';
  if (day === addDays(t, -1)) return 'Yesterday';
  return dayLabel(day);
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function money(cents: number, currency = 'usd'): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() });
}

/** The browser's time zone, for new clubs. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Australia/Sydney',
];
