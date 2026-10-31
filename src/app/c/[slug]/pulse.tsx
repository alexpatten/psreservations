import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { BarList, change, Columns, Heatmap, StatTile } from '@/components/Charts';
import { toast } from '@/components/Dialogs';
import { Banner, Button, Card, Chip, ChipRow, Empty, Loading, Page, Row, Segmented, Sheet, Small, Tag, Toggle } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { addDays, dayLabel, dayOf, money, today } from '@/lib/time';

type Tab = 'overview' | 'financials' | 'utilization' | 'engagement' | 'demographics' | 'instructors';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'financials', label: 'Financials' },
  { value: 'utilization', label: 'Utilization' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'demographics', label: 'Demographics' },
  { value: 'instructors', label: 'Instructors' },
];
const CARDS = ['Net sales', 'Utilization', 'Revenue per player', 'Active players', 'Unsold time', 'New players'];
type Range = '7' | '30' | '90' | 'month' | 'year';

/** Whole dollars from $1,000 up, so headline numbers fit their tiles. */
const big = (cents: number) => (Math.abs(cents) >= 100_000 ? `$${Math.round(cents / 100).toLocaleString('en-US')}` : money(cents));

const csvDownload = (name: string, rows: (string | number | null)[][]) => {
  if (Platform.OS !== 'web') return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name;
  a.click();
};

/** Pulse: how the club is doing, all in one place, against the period before. */
export default function PulsePage() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const t = today(tz);
  const [range, setRange] = useState<Range>('30');
  const [tab, setTab] = useState<Tab>('overview');
  const [p, setP] = useState<api.Pulse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  const [from, to] = useMemo(() => {
    switch (range) {
      case '7':
        return [addDays(t, -6), t];
      case '90':
        return [addDays(t, -89), t];
      case 'month':
        return [`${t.slice(0, 8)}01`, t];
      case 'year':
        return [`${t.slice(0, 4)}-01-01`, t];
      default:
        return [addDays(t, -29), t];
    }
  }, [range, t]);

  const load = useCallback(() => {
    setP(null);
    api.pulse(club.id, from, to).then(setP, (e: Error) => setError(e.message));
  }, [club.id, from, to]);
  useEffect(load, [load]);

  if (error) return <Page><Empty icon="ban" title="Reports aren’t available">{error}</Empty></Page>;
  const hiddenTabs = p?.settings.hiddenTabs ?? [];
  const hiddenCards = p?.settings.hiddenCards ?? [];
  const tabs = TABS.filter((x) => !hiddenTabs.includes(x.value));
  const cur = p?.current;
  const prev = p?.previous;

  const exportTab = () => {
    if (!p || !cur) return;
    const name = `${club.slug}-pulse-${tab}-${from}-to-${to}.csv`;
    if (tab === 'financials') csvDownload(name, [['Category', 'This period', 'Period before'], ...Object.keys(cur.categories).map((k) => [k, cur.categories[k] / 100, (prev?.categories[k] ?? 0) / 100]), ['Refunds', -cur.refundCents / 100, -(prev?.refundCents ?? 0) / 100], ['Discounts', -cur.discountCents / 100, ''], ['Taxes', cur.taxCents / 100, '']]);
    else if (tab === 'utilization') csvDownload(name, [['Weekday', 'Hour', '% booked'], ...p.heatmap.map((h) => [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][h.dow], h.hour, h.pct])]);
    else if (tab === 'engagement') csvDownload(name, [['Week', 'Players', 'Reservations'], ...p.weekly.map((w) => [w.week, w.players, w.reservations]), [], ['At risk', 'Last seen'], ...p.atRisk.map((a) => [a.name, a.lastSeen ? dayOf(a.lastSeen, tz) : 'never'])]);
    else if (tab === 'demographics') csvDownload(name, [['Group', 'Bucket', 'Members'], ...(['age', 'gender', 'skill', 'zips'] as const).flatMap((g) => (p.demographics[g] ?? []).map((x) => [g, x.name, x.count]))]);
    else if (tab === 'instructors') csvDownload(name, [['Instructor', 'Lessons', 'Clinic dates', 'Hours', 'Available', 'Utilization %', 'Billed', 'Paid', 'Students', 'Attendance %'], ...p.instructors.map((r) => [r.name, r.lessons, r.clinicSessions, r.hours, r.availableHours, r.utilization, r.revenueCents / 100, r.paidCents / 100, r.students, r.attendance])]);
    else csvDownload(name, [['Measure', 'This period', 'Period before'], ...Object.entries(cur).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, v as number, (prev as unknown as Record<string, number>)?.[k] ?? ''])]);
  };

  return (
    <Page>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={[type.title1, { color: c.label }]}>Pulse</Text>
          <Small>
            {dayLabel(from)} – {dayLabel(to)} · compared with the {Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1} days before
          </Small>
        </View>
        {Platform.OS === 'web' ? (
          <>
            <Button small kind="secondary" title="Export CSV" onPress={exportTab} />
            <Button small kind="secondary" title="PDF" onPress={() => window.print()} />
          </>
        ) : null}
        {api.isManager(club.myRole) ? <Button small kind="plain" icon="settings" title="Settings" onPress={() => setSettings(true)} /> : null}
      </View>
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
          { value: 'month', label: 'This month' },
          { value: 'year', label: 'This year' },
        ]}
      />
      <ChipRow>
        {tabs.map((x) => (
          <Chip key={x.value} label={x.label} selected={tab === x.value} onPress={() => setTab(x.value)} />
        ))}
      </ChipRow>

      {!p || !cur || !prev ? (
        <Loading />
      ) : tab === 'overview' ? (
        <>
          {p.insights.map((i, n) => (
            <Banner key={n} tone={i.tone === 'good' ? 'success' : i.tone === 'warning' ? 'warning' : 'info'} icon={i.tone === 'good' ? 'checkCircle' : i.tone === 'warning' ? 'clock' : 'star'}>
              {i.text}
            </Banner>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {!hiddenCards.includes('Net sales') ? <StatTile label="Net sales" value={big(cur.netCents)} delta={change(cur.netCents, prev.netCents)} /> : null}
            {!hiddenCards.includes('Utilization') ? <StatTile label="Utilization" value={cur.utilization != null ? `${cur.utilization}%` : '–'} delta={change(cur.utilization, prev.utilization)} /> : null}
            {!hiddenCards.includes('Revenue per player') ? <StatTile label="Revenue per player" value={cur.revenuePerPlayerCents != null ? big(cur.revenuePerPlayerCents) : '–'} delta={change(cur.revenuePerPlayerCents, prev.revenuePerPlayerCents)} /> : null}
            {!hiddenCards.includes('Active players') ? <StatTile label="Active players" value={String(cur.activePlayers)} delta={change(cur.activePlayers, prev.activePlayers)} /> : null}
            {!hiddenCards.includes('Unsold time') ? <StatTile label="Unsold time" value={`${Math.round(cur.unsoldHours)} hrs`} delta={change(cur.unsoldHours, prev.unsoldHours)} goodWhenUp={false} /> : null}
            {!hiddenCards.includes('New players') ? <StatTile label="New players" value={String(cur.newMembers + cur.newGuests)} delta={change(cur.newMembers + cur.newGuests, prev.newMembers + prev.newGuests)} hint={`${cur.newMembers} members, ${cur.newGuests} guests`} /> : null}
          </View>
        </>
      ) : tab === 'financials' ? (
        <>
          <Card style={{ gap: 8 }}>
            <Text style={[type.headline, { color: c.label }]}>Sales Breakdown</Text>
            {[
              ['Gross sales', money(cur.grossCents)],
              ['Refunds', `−${money(cur.refundCents)}`],
              ['Discounts (pro shop)', `−${money(cur.discountCents)}`],
              ['Taxes collected (pro shop)', money(cur.taxCents)],
              ['Net sales', money(cur.netCents)],
            ].map(([k, v], i) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: i === 4 ? 1 : 0, borderTopColor: c.separator, paddingTop: i === 4 ? 8 : 0 }}>
                <Text style={[i === 4 ? type.headline : type.subheadline, { color: c.label }]}>{k}</Text>
                <Text style={[i === 4 ? type.headline : type.subheadline, { color: c.label }]}>{v}</Text>
              </View>
            ))}
            <Small>Sales are charges as they happen (lessons, events, dues, fees, court time) plus pro shop sales and online public bookings.</Small>
          </Card>
          <Card style={{ gap: 8 }}>
            <Text style={[type.headline, { color: c.label }]}>Sales Mix</Text>
            {cur.grossCents > 0 ? (
              <>
                <View style={{ flexDirection: 'row', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                  <View style={{ flex: Math.max(cur.recurringCents, 0.0001), backgroundColor: '#065537' }} />
                  <View style={{ flex: Math.max(cur.grossCents - cur.recurringCents, 0.0001), backgroundColor: '#78C49D' }} />
                </View>
                <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                  <Legend color="#065537" label={`Recurring (memberships) ${money(cur.recurringCents)} · ${Math.round((100 * cur.recurringCents) / cur.grossCents)}%`} />
                  <Legend color="#78C49D" label={`Transactional ${money(cur.grossCents - cur.recurringCents)} · ${Math.round((100 * (cur.grossCents - cur.recurringCents)) / cur.grossCents)}%`} />
                </View>
              </>
            ) : (
              <Small>No sales in this period.</Small>
            )}
          </Card>
          <BarList title="Sales by Category" format={money} rows={Object.entries(cur.categories).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))} />
        </>
      ) : tab === 'utilization' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatTile label="Courts booked" value={cur.utilization != null ? `${cur.utilization}%` : '–'} delta={change(cur.utilization, prev.utilization)} />
            <StatTile label="Hours booked" value={`${Math.round(cur.bookedHours)}`} hint={`of ${Math.round(cur.availableHours)} open`} />
            <StatTile label="Unsold hours" value={`${Math.round(cur.unsoldHours)}`} delta={change(cur.unsoldHours, prev.unsoldHours)} goodWhenUp={false} />
            <StatTile label="No-shows" value={String(cur.noShows)} hint={`${cur.lateCancels} late cancellations`} />
          </View>
          <Heatmap cells={p.heatmap} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 280 }}>
              <BarList title="Hours by Reservation Type" format={(v) => `${v} hr`} rows={p.byType.map((x) => ({ name: x.name, value: Number(x.hours) }))} />
            </View>
            <View style={{ flex: 1, minWidth: 280 }}>
              <BarList title="Hours by Sport" format={(v) => `${v} hr`} rows={p.bySport.map((x) => ({ name: x.name[0].toUpperCase() + x.name.slice(1), value: Number(x.hours) }))} />
            </View>
          </View>
          <Card style={{ gap: 4 }}>
            <Text style={[type.headline, { color: c.label }]}>Walk-up Play (Pickle Spots)</Text>
            {p.linkedToPickleSpots ? (
              <Small muted={false}>
                {cur.walkups.visits} check-ins by {cur.walkups.players} players, {cur.walkups.hours} hours on court, from players who checked in with the Pickle Spots app (vs {prev.walkups.visits} the period before).
              </Small>
            ) : (
              <Small>Link this club to its Pickle Spots court (Manage › Club Details) to count players who check in with the app.</Small>
            )}
          </Card>
        </>
      ) : tab === 'engagement' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatTile label="Active players" value={String(cur.activePlayers)} delta={change(cur.activePlayers, prev.activePlayers)} />
            <StatTile label="Retention" value={p.retention != null ? `${p.retention}%` : '–'} hint="Players from the period before who played again" />
            <StatTile label="Membership churn" value={p.churn != null ? `${p.churn}%` : '–'} hint={`${p.activeMemberships} active memberships`} />
            <StatTile label="Desk check-ins" value={String(cur.checkins)} delta={change(cur.checkins, prev.checkins)} />
          </View>
          <Columns title="Players per Week" format={(v) => `${v} players`} rows={p.weekly.map((w) => ({ label: dayLabel(w.week).replace(/^\w+, /, ''), value: w.players }))} />
          <Card padded={false}>
            <View style={{ padding: 16, paddingBottom: 4 }}>
              <Text style={[type.headline, { color: c.label }]}>At Risk</Text>
              <Small>Members with a plan who haven’t played or checked in for 30 days.</Small>
            </View>
            {p.atRisk.length === 0 ? <Empty icon="checkCircle" title="No one at risk" /> : null}
            {p.atRisk.map((a, i) => (
              <Row key={a.userId} title={a.name} subtitle={a.lastSeen ? `Last seen ${dayLabel(dayOf(a.lastSeen, tz))}` : 'No visits yet'} last={i === p.atRisk.length - 1} />
            ))}
          </Card>
        </>
      ) : tab === 'demographics' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {(
            [
              ['Age', p.demographics.age],
              ['Gender', p.demographics.gender],
              ['Skill (club rating or DUPR)', p.demographics.skill],
              ['Top ZIP Codes', p.demographics.zips],
            ] as const
          ).map(([title, rows]) => (
            <View key={title} style={{ flexBasis: 300, flexGrow: 1 }}>
              <BarList title={title} format={(v) => `${v}`} rows={(rows ?? []).map((x) => ({ name: x.name, value: x.count }))} />
            </View>
          ))}
          <Small>From {p.members} members’ details (My Details) and ratings. Members who haven’t filled theirs in show as Unknown.</Small>
        </View>
      ) : (
        <Card padded={false}>
          {p.instructors.length === 0 ? <Empty icon="users" title="No instructors yet" /> : null}
          {p.instructors.map((r, i) => (
            <Row
              key={r.instructorId}
              title={r.name}
              subtitle={`${r.hours} hr on court of ${r.availableHours} · ${r.lessons} lessons, ${r.clinicSessions} clinic dates · ${money(r.revenueCents)} billed · ${r.students} students${r.attendance != null ? ` · ${r.attendance}% attendance` : ''}`}
              right={r.utilization != null ? <Tag label={`${r.utilization}% booked`} tone={r.utilization >= 75 ? 'tint' : 'slate'} /> : undefined}
              last={i === p.instructors.length - 1}
            />
          ))}
        </Card>
      )}
      {settings && p ? <PulseSettings club={club} initial={p.settings} onClose={() => setSettings(false)} onSaved={load} /> : null}
    </Page>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Small muted={false}>{label}</Small>
    </View>
  );
}

/** Admins: which tabs and cards show, and which staff see Pulse. */
function PulseSettings({ club, initial, onClose, onSaved }: { club: api.Club; initial: api.Pulse['settings']; onClose: () => void; onSaved: () => void }) {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>(initial.hiddenTabs ?? []);
  const [hiddenCards, setHiddenCards] = useState<string[]>(initial.hiddenCards ?? []);
  const [staff, setStaff] = useState<api.Member[]>([]);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api.members(club.id).then((m) => setStaff(m.filter((x) => x.role === 'staff')), () => {});
    api.reportAccess(club.id).then((ids) => setAccess(Object.fromEntries(ids.map((id) => [id, true]))), () => {});
  }, [club.id]);
  const flip = (list: string[], set: (l: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Pulse Settings"
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button
            title="Save"
            onPress={() =>
              api.savePulseSettings(club.id, { hiddenTabs, hiddenCards }).then(() => {
                onSaved();
                onClose();
              }, (e: Error) => toast(e.message))
            }
          />
        </>
      }
    >
      <Small style={{ fontWeight: '600' }}>TABS</Small>
      {TABS.filter((t) => t.value !== 'overview').map((t) => (
        <Toggle key={t.value} label={t.label} value={!hiddenTabs.includes(t.value)} onChange={() => flip(hiddenTabs, setHiddenTabs, t.value)} />
      ))}
      <Small style={{ fontWeight: '600' }}>OVERVIEW CARDS</Small>
      {CARDS.map((k) => (
        <Toggle key={k} label={k} value={!hiddenCards.includes(k)} onChange={() => flip(hiddenCards, setHiddenCards, k)} />
      ))}
      <Small style={{ fontWeight: '600' }}>STAFF WHO CAN SEE PULSE</Small>
      <Small>Admins always can.</Small>
      {staff.length === 0 ? <Small>No staff yet.</Small> : null}
      {staff.map((m) => (
        <Toggle
          key={m.userId}
          label={m.name}
          value={!!access[m.userId]}
          onChange={(v) => api.setReportAccess(club.id, m.userId, v).then(() => setAccess({ ...access, [m.userId]: v }), (e: Error) => toast(e.message))}
        />
      ))}
    </Sheet>
  );
}
