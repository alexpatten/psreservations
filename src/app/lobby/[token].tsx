import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Logo } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { Empty, Loading } from '@/components/ui';
import * as api from '@/lib/api';
import { textOn, type, useColors } from '@/lib/theme';
import { dayLabel, dayOf, timeOf, timeRange } from '@/lib/time';

const REFRESH_MS = 30_000;

/** The lobby board: big enough to read across the room, and it keeps itself current. No sign-in needed. */
export default function LobbyView() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [board, setBoard] = useState<api.Lobby | null | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // A failed refresh keeps the board on screen; a failed first load says the link doesn't work.
    const load = () => api.lobby(String(token)).then(setBoard, () => setBoard((b) => (b === undefined ? null : b)));
    load();
    const t = setInterval(load, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(t);
      clearInterval(clockTimer);
    };
  }, [token]);

  if (board === undefined) return <Loading />;
  if (board === null) {
    return (
      <Empty icon="tv" title="This lobby link doesn’t work">
        Ask the club for the current link.
      </Empty>
    );
  }

  const tz = board.club.timezone;
  const big = width >= 1100;
  const cols = width >= 1600 ? 4 : width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const linked = (courtId: string) => {
    const court = board.courts.find((x) => x.id === courtId);
    return [courtId, court?.parentId, ...board.courts.filter((x) => x.parentId === courtId).map((x) => x.id)].filter(Boolean) as string[];
  };

  const statusOf = (courtId: string) => {
    const ids = linked(courtId);
    const closure = board.closures.find((x) => x.startsAt <= now && x.endsAt > now && (x.courtIds.length === 0 || x.courtIds.some((id) => ids.includes(id))));
    const current = board.reservations.find((r) => r.courtId === courtId && r.startsAt <= now && r.endsAt > now);
    const blocked = board.reservations.find((r) => r.courtId !== courtId && ids.includes(r.courtId) && r.startsAt <= now && r.endsAt > now);
    const next = board.reservations.filter((r) => ids.includes(r.courtId) && r.startsAt > now).sort((a, b) => a.startsAt - b.startsAt);
    return { closure, current, blocked, next };
  };

  const upcoming = board.reservations.filter((r) => r.startsAt > now).slice(0, 12);

  return (
    <View style={{ flex: 1, padding: big ? 32 : 16, gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Logo size={big ? 64 : 44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: big ? 40 : 26, fontWeight: '800', color: c.label }} numberOfLines={1}>
            {board.club.name}
          </Text>
          <Text style={[big ? type.title3 : type.subheadline, { color: c.secondaryLabel, fontWeight: '400' }]}>{dayLabel(dayOf(now, tz), { long: true })}</Text>
        </View>
        <Text style={{ fontSize: big ? 56 : 30, fontWeight: '700', color: c.label, fontVariant: ['tabular-nums'] }}>{timeOf(now, tz)}</Text>
      </View>

      <View style={{ flex: 1, flexDirection: big ? 'row' : 'column', gap: 20 }}>
        <ScrollView style={{ flex: 3 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {board.courts.map((court) => {
            const s = statusOf(court.id);
            const busy = s.current ?? null;
            const bg = s.closure ? c.slateFill : busy ? busy.color : s.blocked ? c.fill : c.tint;
            const fg = s.closure || s.blocked ? c.label : textOn(bg);
            return (
              <View
                key={court.id}
                style={{
                  width: `${100 / cols - 2}%` as `${number}%`,
                  minHeight: big ? 180 : 130,
                  borderRadius: 20,
                  padding: big ? 22 : 16,
                  backgroundColor: bg,
                  gap: 6,
                  boxShadow: '0 4px 18px rgba(14,42,34,0.12)',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {court.kind === 'ball_machine' ? <Icon name="machine" size={big ? 26 : 20} color={fg} /> : null}
                  <Text style={{ fontSize: big ? 30 : 22, fontWeight: '800', color: fg, flex: 1 }} numberOfLines={1}>
                    {court.name}
                  </Text>
                  {busy?.checkedIn ? <Icon name="checkCircle" size={big ? 26 : 20} color={fg} /> : null}
                </View>
                {s.closure ? (
                  <>
                    <Text style={{ fontSize: big ? 24 : 18, fontWeight: '700', color: fg }}>Closed</Text>
                    <Text style={{ fontSize: big ? 18 : 15, color: fg, opacity: 0.8 }}>
                      {s.closure.reason ? `${s.closure.reason} · ` : ''}until {timeOf(s.closure.endsAt, tz)}
                    </Text>
                  </>
                ) : busy ? (
                  <>
                    <Text style={{ fontSize: big ? 22 : 17, fontWeight: '700', color: fg }} numberOfLines={1}>
                      {busy.title || busy.typeName}
                    </Text>
                    <Text style={{ fontSize: big ? 18 : 15, color: fg, opacity: 0.9 }}>Until {timeOf(busy.endsAt, tz)}</Text>
                    {busy.names.length ? (
                      <Text style={{ fontSize: big ? 17 : 14, color: fg, opacity: 0.85 }} numberOfLines={2}>
                        {busy.names.join(', ')}
                      </Text>
                    ) : null}
                  </>
                ) : s.blocked ? (
                  <Text style={{ fontSize: big ? 22 : 17, fontWeight: '700', color: fg }}>In use until {timeOf(s.blocked.endsAt, tz)}</Text>
                ) : (
                  <>
                    <Text style={{ fontSize: big ? 26 : 20, fontWeight: '800', color: fg }}>Available</Text>
                    <Text style={{ fontSize: big ? 18 : 15, color: fg, opacity: 0.9 }}>
                      {s.next[0] ? `Free until ${timeOf(s.next[0].startsAt, tz)}` : 'Free the rest of the day'}
                    </Text>
                  </>
                )}
                {s.next.length && (busy || s.closure) ? (
                  <Text style={{ fontSize: big ? 15 : 13, color: fg, opacity: 0.75, marginTop: 'auto' }} numberOfLines={1}>
                    Next: {s.next[0].title || s.next[0].typeName} at {timeOf(s.next[0].startsAt, tz)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <View style={{ flex: big ? 1.3 : undefined, backgroundColor: c.card, borderRadius: 20, padding: big ? 22 : 16, gap: 12, borderWidth: 1, borderColor: c.cardBorder }}>
          <Text style={{ fontSize: big ? 24 : 19, fontWeight: '800', color: c.label }}>Coming Up</Text>
          {upcoming.length === 0 ? <Text style={[type.body, { color: c.secondaryLabel }]}>Nothing else booked today.</Text> : null}
          {upcoming.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: r.color }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: big ? 18 : 15, fontWeight: '700', color: c.label }} numberOfLines={1}>
                  {r.title || r.typeName}
                </Text>
                <Text style={{ fontSize: big ? 15 : 13, color: c.secondaryLabel }} numberOfLines={1}>
                  {timeRange(r.startsAt, r.endsAt, tz)} · {board.courts.find((x) => x.id === r.courtId)?.name}
                </Text>
              </View>
            </View>
          ))}
          <View style={{ marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12 }}>
            <Logo size={22} />
            <Text style={[type.footnote, { color: c.secondaryLabel }]}>Book on Pickle Spots Reservations</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
