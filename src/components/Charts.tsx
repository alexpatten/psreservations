import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { type, useColors } from '@/lib/theme';
import { Card, Small } from './ui';

/**
 * Pulse's charts: one hue (Pickle Spots green) for magnitude, a light-to-dark ramp of it for
 * the heat map, recessive grid, values on hover (or tap) and in the CSV export.
 */

/** Light (near zero) to dark (full), one hue. */
export const GREEN_RAMP = ['#EAF6EF', '#CDEBDA', '#A6DABE', '#78C49D', '#4BAA7B', '#22905E', '#0A7349', '#065537'];
const rampAt = (pct: number) => GREEN_RAMP[Math.min(GREEN_RAMP.length - 1, Math.floor((Math.max(0, pct) / 100) * GREEN_RAMP.length))];

/** A headline number with its change from the period before (arrow and words, not just color). */
export function StatTile({ label, value, delta, goodWhenUp = true, hint }: { label: string; value: string; delta?: number | null; goodWhenUp?: boolean; hint?: string }) {
  const c = useColors();
  const tone = delta == null || delta === 0 ? c.secondaryLabel : (delta > 0) === goodWhenUp ? c.tint : c.warning;
  return (
    <Card style={{ flexGrow: 1, flexBasis: 160, gap: 4 }}>
      <Small>{label}</Small>
      <Text style={[type.title1, { color: c.label }]}>{value}</Text>
      {delta != null ? (
        <Text style={[type.footnote, { color: tone, fontWeight: '600' }]}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '–'} {delta === 0 ? 'No change' : `${Math.abs(delta)}%`} vs period before
        </Text>
      ) : hint ? (
        <Small>{hint}</Small>
      ) : null}
    </Card>
  );
}

/** Percent change, or null when there's nothing to compare against. */
export function change(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

/** Horizontal bars for one measure across categories, labels and values in ink, the bar in green. */
export function BarList({ rows, format, title }: { rows: { name: string; value: number; color?: string }[]; format: (v: number) => string; title: string }) {
  const c = useColors();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card style={{ gap: 10 }}>
      <Text style={[type.headline, { color: c.label }]}>{title}</Text>
      {rows.length === 0 ? <Small>Nothing yet in this period.</Small> : null}
      {rows.map((r) => (
        <View key={r.name} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Small muted={false} numberOfLines={1} style={{ flex: 1 }}>
              {r.name}
            </Small>
            <Small muted={false}>{format(r.value)}</Small>
          </View>
          <View style={{ height: 10, borderRadius: 4, backgroundColor: c.fill, overflow: 'hidden' }}>
            <View style={{ width: `${(100 * r.value) / max}%`, height: 10, borderRadius: 4, backgroundColor: r.color ?? c.tint }} />
          </View>
        </View>
      ))}
    </Card>
  );
}

/** Vertical columns over time (one measure), with the hovered value above. */
export function Columns({ rows, title, format }: { rows: { label: string; value: number }[]; title: string; format: (v: number) => string }) {
  const c = useColors();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.headline, { color: c.label }]}>{title}</Text>
        <Small muted={false}>{hover != null ? `${rows[hover].label}: ${format(rows[hover].value)}` : ''}</Small>
      </View>
      {rows.length === 0 ? <Small>Nothing yet in this period.</Small> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 4, borderBottomWidth: 1, borderBottomColor: c.gridLine }}>
        {rows.map((r, i) => (
          <Pressable
            key={r.label}
            onHoverIn={() => setHover(i)}
            onHoverOut={() => setHover(null)}
            onPress={() => setHover(i)}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
          >
            <View style={{ height: `${Math.max(2, (100 * r.value) / max)}%`, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: hover === i ? '#065537' : c.tint }} />
          </Pressable>
        ))}
      </View>
      {rows.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Small>{rows[0].label}</Small>
          <Small>{rows[rows.length - 1].label}</Small>
        </View>
      ) : null}
    </Card>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

/** Weekday × hour: share of open court-time booked. Closed hours are blank. */
export function Heatmap({ cells }: { cells: { dow: number; hour: number; pct: number }[] }) {
  const c = useColors();
  const [hover, setHover] = useState<{ dow: number; hour: number; pct: number } | null>(null);
  if (cells.length === 0) return <Small>No open hours in this period.</Small>;
  const hours = Array.from(new Set(cells.map((x) => x.hour))).sort((a, b) => a - b);
  const at = (dow: number, hour: number) => cells.find((x) => x.dow === dow && x.hour === hour);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <Text style={[type.headline, { color: c.label }]}>Busy Hours</Text>
        <Small muted={false}>{hover ? `${DAYS[hover.dow]} ${hourLabel(hover.hour)}: ${hover.pct}% booked` : 'Hover a square for its share booked'}</Small>
      </View>
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <View style={{ width: 34 }} />
          {hours.map((h) => (
            <Text key={h} style={[type.caption, { flex: 1, color: c.secondaryLabel, textAlign: 'center', fontSize: 10 }]}>
              {h % 3 === 0 ? hourLabel(h) : ''}
            </Text>
          ))}
        </View>
        {order.map((d) => (
          <View key={d} style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
            <Text style={[type.caption, { width: 34, color: c.secondaryLabel }]}>{DAYS[d]}</Text>
            {hours.map((h) => {
              const cell = at(d, h);
              return (
                <Pressable
                  key={h}
                  disabled={!cell}
                  onHoverIn={() => cell && setHover(cell)}
                  onHoverOut={() => setHover(null)}
                  onPress={() => cell && setHover(cell)}
                  accessibilityLabel={cell ? `${DAYS[d]} ${hourLabel(h)}: ${cell.pct}% booked` : undefined}
                  style={{ flex: 1, height: 22, borderRadius: 4, backgroundColor: cell ? rampAt(cell.pct) : 'transparent', borderWidth: hover === cell && cell ? 2 : 0, borderColor: c.label }}
                />
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Small>0%</Small>
        {GREEN_RAMP.map((col) => (
          <View key={col} style={{ width: 18, height: 10, borderRadius: 2, backgroundColor: col }} />
        ))}
        <Small>100% booked · blank = closed</Small>
      </View>
    </Card>
  );
}
