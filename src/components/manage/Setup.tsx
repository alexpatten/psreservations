import { useState } from 'react';
import { View } from 'react-native';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useLessons } from '@/lib/lessons';
import { useColors } from '@/lib/theme';
import { clock, DAY_SHORT, parseHm } from '@/lib/time';
import { confirm, toast } from '../Dialogs';
import { Icon } from '../Icon';
import { Button, Card, Chip, ChipRow, Empty, ErrorText, Field, NumberField, Row, Segmented, Sheet, Small, Tag, TimeField, Toggle } from '../ui';
import { Pair, SectionHeader } from './Settings';

/** Runs a settings call that returns the club, then closes the editor. */
function useClubAction() {
  const { setClub } = useClub();
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<api.Club>, done: string) => {
    setError(null);
    try {
      setClub(await action());
      toast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return { run, error, setError };
}

const daysLabel = (days: number[]) =>
  days.length === 7 ? 'Every day' : days.join() === '1,2,3,4,5' ? 'Weekdays' : days.join() === '0,6' ? 'Weekends' : days.map((d) => DAY_SHORT[d]).join(', ');

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <ChipRow>
      {DAY_SHORT.map((d, i) => (
        <Chip key={d} small label={d} selected={value.includes(i)} onPress={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())} />
      ))}
    </ChipRow>
  );
}

function CourtPicker({ value, onChange, emptyMeansAll }: { value: string[]; onChange: (ids: string[]) => void; emptyMeansAll?: boolean }) {
  const { club } = useClub();
  return (
    <View style={{ gap: 6 }}>
      <ChipRow>
        {club.courts.map((ct) => (
          <Chip
            key={ct.id}
            small
            label={ct.name}
            icon={ct.kind === 'ball_machine' ? 'machine' : undefined}
            selected={value.includes(ct.id)}
            onPress={() => onChange(value.includes(ct.id) ? value.filter((x) => x !== ct.id) : [...value, ct.id])}
          />
        ))}
      </ChipRow>
      {emptyMeansAll && value.length === 0 ? <Small>None chosen: applies to all courts.</Small> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Courts and ball machines
// ---------------------------------------------------------------------------

type CourtDraft = Partial<api.Court> & { name: string; schedulerIds: string[] };

export function CourtsSection() {
  const c = useColors();
  const { club } = useClub();
  const [editing, setEditing] = useState<CourtDraft | null>(null);
  const top = club.courts.filter((ct) => !ct.parentId);
  const childrenOf = (id: string) => club.courts.filter((ct) => ct.parentId === id);
  const schedulersFor = (id: string) => club.schedulers.filter((s) => s.courtIds.includes(id)).map((s) => s.id);

  const describe = (ct: api.Court) =>
    [
      ct.kind === 'ball_machine' ? 'Ball machine' : ct.sport[0].toUpperCase() + ct.sport.slice(1),
      ct.kind === 'ball_machine' ? null : ct.indoor ? 'Indoor' : 'Outdoor',
      ct.minMinutes || ct.maxMinutes ? `${ct.minMinutes ?? club.rules.minMinutes}–${ct.maxMinutes ?? club.rules.maxMinutes} min` : null,
      club.schedulers.filter((s) => s.courtIds.includes(ct.id)).map((s) => s.name).join(', ') || 'Not in a scheduler',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <SectionHeader
        title="Courts & Ball Machines"
        action={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small kind="secondary" icon="machine" title="Ball Machine" onPress={() => setEditing({ name: `Ball Machine ${club.courts.filter((x) => x.kind === 'ball_machine').length + 1}`, kind: 'ball_machine', sport: 'other', maxMinutes: 60, schedulerIds: club.schedulers.map((s) => s.id) })} />
            <Button small icon="plus" title="Court" onPress={() => setEditing({ name: `Court ${club.courts.filter((x) => x.kind === 'court').length + 1}`, kind: 'court', sport: 'pickleball', schedulerIds: club.schedulers.map((s) => s.id) })} />
          </View>
        }
      >
        Combo courts: split a court (say, tennis) into smaller ones (two pickleball courts) by making them part of it. Booking the whole court
        blocks its parts, and the other way around.
      </SectionHeader>
      <Card padded={false}>
        {top.length === 0 ? <Empty icon="grid" title="No courts yet" /> : null}
        {top.map((ct) => (
          <View key={ct.id}>
            <Row
              left={<Icon name={ct.kind === 'ball_machine' ? 'machine' : 'grid'} color={c.tint} />}
              title={ct.name}
              subtitle={describe(ct)}
              right={!ct.membersCanBook ? <Tag label="Staff only" /> : undefined}
              onPress={() => setEditing({ ...ct, schedulerIds: schedulersFor(ct.id) })}
            />
            {childrenOf(ct.id).map((child) => (
              <View key={child.id} style={{ paddingLeft: 28 }}>
                <Row
                  left={<Icon name="chevronRight" color={c.tertiaryLabel} size={16} />}
                  title={child.name}
                  subtitle={`Part of ${ct.name} · ${describe(child)}`}
                  onPress={() => setEditing({ ...child, schedulerIds: schedulersFor(child.id) })}
                />
              </View>
            ))}
          </View>
        ))}
      </Card>
      {editing ? <CourtEditor draft={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CourtEditor({ draft, onClose }: { draft: CourtDraft; onClose: () => void }) {
  const { club } = useClub();
  const { run, error } = useClubAction();
  const [d, setD] = useState(draft);
  const set = (p: Partial<CourtDraft>) => setD({ ...d, ...p });
  // One level only: a court that's split into others can't itself be part of one.
  const hasParts = !!d.id && club.courts.some((x) => x.parentId === d.id);
  const parents = hasParts ? [] : club.courts.filter((ct) => ct.id !== d.id && !ct.parentId && ct.kind === 'court');

  const save = async () => {
    const ok = await run(
      () =>
        api.saveCourt(club.id, {
          ...(d.id ? { id: d.id } : {}),
          name: d.name,
          kind: d.kind ?? 'court',
          sport: d.sport ?? 'pickleball',
          indoor: d.indoor ?? false,
          parentId: d.parentId ?? null,
          minMinutes: d.minMinutes ?? null,
          maxMinutes: d.maxMinutes ?? null,
          membersCanBook: d.membersCanBook ?? true,
          schedulerIds: d.schedulerIds,
        }),
      `${d.name} saved.`,
    );
    if (ok) onClose();
  };
  const remove = async () => {
    if (!d.id) return;
    if (!(await confirm(`Remove ${d.name}?`, 'Past reservations on it stay in your history.', { confirmLabel: 'Remove', destructive: true }))) return;
    if (await run(() => api.deleteCourt(d.id!), `${d.name} removed.`)) onClose();
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? `Edit ${draft.name}` : d.kind === 'ball_machine' ? 'New Ball Machine' : 'New Court'}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" icon="trash" title="Remove" onPress={remove} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} disabled={!d.name.trim()} />
        </>
      }
    >
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} maxLength={40} />
      <Segmented
        value={d.kind ?? 'court'}
        onChange={(k) => set({ kind: k })}
        options={[
          { value: 'court', label: 'Court' },
          { value: 'ball_machine', label: 'Ball Machine' },
        ]}
      />
      {d.kind !== 'ball_machine' ? (
        <>
          <ChipRow>
            {(['pickleball', 'tennis', 'padel', 'other'] as const).map((s) => (
              <Chip key={s} small label={s[0].toUpperCase() + s.slice(1)} selected={(d.sport ?? 'pickleball') === s} onPress={() => set({ sport: s })} />
            ))}
          </ChipRow>
          <Toggle label="Indoor" value={d.indoor ?? false} onChange={(v) => set({ indoor: v })} />
          <View style={{ gap: 8 }}>
            <Small style={{ fontWeight: '600' }}>PART OF (COMBO COURT)</Small>
            <ChipRow>
              <Chip small label="None" selected={!d.parentId} onPress={() => set({ parentId: null })} />
              {parents.map((p) => (
                <Chip key={p.id} small label={p.name} selected={d.parentId === p.id} onPress={() => set({ parentId: p.id })} />
              ))}
            </ChipRow>
          </View>
        </>
      ) : null}
      <Pair>
        <NumberField style={{ flex: 1 }} label="Shortest" suffix="min" allowEmpty value={d.minMinutes ?? null} onChange={(v) => set({ minMinutes: v })} hint={`Club default: ${club.rules.minMinutes}`} />
        <NumberField style={{ flex: 1 }} label="Longest" suffix="min" allowEmpty value={d.maxMinutes ?? null} onChange={(v) => set({ maxMinutes: v })} hint={`Club default: ${club.rules.maxMinutes}`} />
      </Pair>
      <Toggle label="Members Can Book" hint="Off: only staff can put reservations on it." value={d.membersCanBook ?? true} onChange={(v) => set({ membersCanBook: v })} />
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>SHOWN IN SCHEDULERS</Small>
        <ChipRow>
          {club.schedulers.map((s) => (
            <Chip
              key={s.id}
              small
              label={s.name}
              selected={d.schedulerIds.includes(s.id)}
              onPress={() => set({ schedulerIds: d.schedulerIds.includes(s.id) ? d.schedulerIds.filter((x) => x !== s.id) : [...d.schedulerIds, s.id] })}
            />
          ))}
        </ChipRow>
      </View>
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Reservation types
// ---------------------------------------------------------------------------

const COLORS = ['#0A8754', '#7CC24A', '#2F6BFF', '#1D9BD1', '#6A4FC8', '#C24AB0', '#F2711C', '#E5484D', '#D9A400', '#6B7780'];

type TypeDraft = Partial<api.ReservationType> & { name: string };

export function TypesSection() {
  const { club } = useClub();
  const { data: lessons, reload: reloadLessons } = useLessons(club.id);
  const [editing, setEditing] = useState<TypeDraft | null>(null);
  return (
    <>
      <SectionHeader title="Reservation Types" action={<Button small icon="plus" title="Type" onPress={() => setEditing({ name: '', color: COLORS[club.types.length % COLORS.length] })} />}>
        Categories with their own color on the scheduler and their own player limits. Staff-only types are for lessons, clinics and maintenance.
      </SectionHeader>
      <Card padded={false}>
        {club.types.map((t, i) => (
          <Row
            key={t.id}
            left={<View style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: t.color }} />}
            title={t.name}
            subtitle={`${t.minPlayers}–${t.maxPlayers} players`}
            right={!t.membersCanBook ? <Tag label="Staff only" /> : undefined}
            onPress={() => setEditing(t)}
            last={i === club.types.length - 1}
          />
        ))}
      </Card>
      {editing ? (
        <TypeEditor
          draft={editing}
          isLesson={!!editing.id && !!lessons?.lessonTypeIds.includes(editing.id)}
          onClose={() => {
            setEditing(null);
            reloadLessons();
          }}
        />
      ) : null}
    </>
  );
}

function TypeEditor({ draft, isLesson, onClose }: { draft: TypeDraft; isLesson: boolean; onClose: () => void }) {
  const [lesson, setLesson] = useState(isLesson);
  const { club } = useClub();
  const { run, error } = useClubAction();
  const [d, setD] = useState(draft);
  const set = (p: Partial<TypeDraft>) => setD({ ...d, ...p });
  const save = async () => {
    if (!(await run(() => api.saveType(club.id, { ...d, name: d.name.trim() }), `${d.name} saved.`))) return;
    if (d.id && lesson !== isLesson) await api.setLessonType(d.id, lesson).catch(() => {});
    onClose();
  };
  const remove = async () => {
    if (!d.id) return;
    if (!(await confirm(`Remove ${d.name}?`, 'Existing reservations keep it.', { confirmLabel: 'Remove', destructive: true }))) return;
    if (await run(() => api.deleteType(d.id!), `${d.name} removed.`)) onClose();
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? `Edit ${draft.name}` : 'New Reservation Type'}
      accent={d.color}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" icon="trash" title="Remove" onPress={remove} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} disabled={!d.name.trim()} />
        </>
      }
    >
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} placeholder="Round Robin" maxLength={40} />
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>COLOR</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {COLORS.map((col) => (
            <Chip key={col} small label={col === d.color ? '✓' : ' '} color={col} selected={col === d.color} onPress={() => set({ color: col })} />
          ))}
        </View>
        <Field value={d.color ?? ''} onChangeText={(t) => set({ color: t })} placeholder="#0A8754" autoCapitalize="characters" />
      </View>
      <Pair>
        <NumberField style={{ flex: 1 }} label="Fewest Players" value={d.minPlayers ?? 1} onChange={(v) => set({ minPlayers: v ?? 0 })} />
        <NumberField style={{ flex: 1 }} label="Most Players" value={d.maxPlayers ?? 4} onChange={(v) => set({ maxPlayers: v ?? 1 })} />
      </Pair>
      <Toggle label="Members Can Book" hint="Off: staff only. (Lessons are booked through Lessons either way.)" value={d.membersCanBook ?? true} onChange={(v) => set({ membersCanBook: v })} />
      {d.id ? <Toggle label="Lesson Type" hint="Booked with an instructor, priced by Pro Pricing, and used for clinics." value={lesson} onChange={setLesson} /> : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Schedulers
// ---------------------------------------------------------------------------

type SchedulerDraft = Partial<api.Scheduler> & { name: string; opens: string; closes: string; courtIds: string[]; days: number[] };

export function SchedulersSection() {
  const { club } = useClub();
  const [editing, setEditing] = useState<SchedulerDraft | null>(null);
  return (
    <>
      <SectionHeader
        title="Custom Schedulers"
        action={
          <Button
            small
            icon="plus"
            title="Scheduler"
            onPress={() => setEditing({ name: '', courtIds: [], days: [0, 1, 2, 3, 4, 5, 6], opens: '07:00', closes: '22:00', slotMinutes: 30, membersCanBook: true })}
          />
        }
      >
        Each scheduler is a view of some courts with its own days, hours and slot length. Members can book a court at times that fit a
        scheduler it’s in.
      </SectionHeader>
      <Card padded={false}>
        {club.schedulers.length === 0 ? <Empty icon="calendar" title="No schedulers">Add one so members can book.</Empty> : null}
        {club.schedulers.map((s, i) => (
          <Row
            key={s.id}
            title={s.name}
            subtitle={`${daysLabel(s.days)} · ${clock(parseHm(s.opens), true)} – ${clock(parseHm(s.closes), true)} · ${s.slotMinutes}-min slots · ${s.courtIds.length} courts`}
            right={!s.membersCanBook ? <Tag label="Staff only" /> : undefined}
            onPress={() => setEditing(s)}
            last={i === club.schedulers.length - 1}
          />
        ))}
      </Card>
      {editing ? <SchedulerEditor draft={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function SchedulerEditor({ draft, onClose }: { draft: SchedulerDraft; onClose: () => void }) {
  const { club } = useClub();
  const { run, error } = useClubAction();
  const [d, setD] = useState(draft);
  const set = (p: Partial<SchedulerDraft>) => setD({ ...d, ...p });
  const save = async () => {
    if (await run(() => api.saveScheduler(club.id, { ...d, name: d.name.trim() }), `${d.name} saved.`)) onClose();
  };
  const remove = async () => {
    if (!d.id) return;
    if (!(await confirm(`Remove ${d.name}?`, 'Reservations stay; members can’t book these hours through it anymore.', { confirmLabel: 'Remove', destructive: true }))) return;
    if (await run(() => api.deleteScheduler(d.id!), `${d.name} removed.`)) onClose();
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? `Edit ${draft.name}` : 'New Scheduler'}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" icon="trash" title="Remove" onPress={remove} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} disabled={!d.name.trim()} />
        </>
      }
    >
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} placeholder="Indoor Courts" maxLength={40} />
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>COURTS</Small>
        <CourtPicker value={d.courtIds} onChange={(ids) => set({ courtIds: ids })} />
      </View>
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>DAYS</Small>
        <DayPicker value={d.days} onChange={(days) => set({ days })} />
      </View>
      <Pair>
        <View style={{ flex: 1 }}>
          <TimeField label="Opens" value={d.opens} onChange={(t) => set({ opens: t })} />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField label="Closes" value={d.closes === '24:00' ? '23:59' : d.closes} onChange={(t) => set({ closes: t === '23:59' ? '24:00' : t })} />
        </View>
      </Pair>
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>SLOT LENGTH</Small>
        <Segmented
          value={d.slotMinutes ?? 30}
          onChange={(v) => set({ slotMinutes: v })}
          options={[
            { value: 15, label: '15 min' },
            { value: 30, label: '30 min' },
            { value: 60, label: '1 hour' },
          ]}
        />
      </View>
      <Toggle label="Members Can Book" hint="Off: a staff-only view." value={d.membersCanBook ?? true} onChange={(v) => set({ membersCanBook: v })} />
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Prime time
// ---------------------------------------------------------------------------

type PrimeDraft = Partial<api.PrimeTime> & { starts: string; ends: string; courtIds: string[]; days: number[] };

export function PrimeTimeSection() {
  const { club } = useClub();
  const [editing, setEditing] = useState<PrimeDraft | null>(null);
  const courtsLabel = (ids: string[]) => (ids.length === 0 ? 'All courts' : club.courts.filter((c) => ids.includes(c.id)).map((c) => c.name).join(', '));
  return (
    <>
      <SectionHeader
        title="Prime Time Intervals"
        action={
          <Button small icon="plus" title="Prime Time" onPress={() => setEditing({ name: 'Prime Time', days: [1, 2, 3, 4, 5], starts: '17:00', ends: '20:00', courtIds: [], maxMinutes: 60, maxPerWeek: 2, advanceDays: null })} />
        }
      >
        Stricter limits for your busiest hours, so everyone gets a turn. A reservation that touches prime time follows its limits.
      </SectionHeader>
      <Card padded={false}>
        {club.primeTimes.length === 0 ? <Empty icon="star" title="No prime time">Members book these hours under the usual rules.</Empty> : null}
        {club.primeTimes.map((p, i) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle={[
              `${daysLabel(p.days)} ${clock(parseHm(p.starts), true)} – ${clock(parseHm(p.ends), true)}`,
              courtsLabel(p.courtIds),
              p.maxMinutes ? `≤ ${p.maxMinutes} min` : null,
              p.maxPerWeek ? `${p.maxPerWeek}/week` : null,
              p.advanceDays != null ? `${p.advanceDays} days ahead` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => setEditing(p)}
            last={i === club.primeTimes.length - 1}
          />
        ))}
      </Card>
      {editing ? <PrimeEditor draft={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function PrimeEditor({ draft, onClose }: { draft: PrimeDraft; onClose: () => void }) {
  const { club } = useClub();
  const { run, error } = useClubAction();
  const [d, setD] = useState(draft);
  const set = (p: Partial<PrimeDraft>) => setD({ ...d, ...p });
  const save = async () => {
    if (await run(() => api.savePrimeTime(club.id, d), 'Prime time saved.')) onClose();
  };
  const remove = async () => {
    if (!d.id) return;
    if (await run(() => api.deletePrimeTime(d.id!), 'Prime time removed.')) onClose();
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? 'Edit Prime Time' : 'New Prime Time'}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" icon="trash" title="Remove" onPress={remove} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} />
        </>
      }
    >
      <Field label="Name" value={d.name ?? ''} onChangeText={(t) => set({ name: t })} maxLength={40} />
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>DAYS</Small>
        <DayPicker value={d.days} onChange={(days) => set({ days })} />
      </View>
      <Pair>
        <View style={{ flex: 1 }}>
          <TimeField label="Starts" value={d.starts} onChange={(t) => set({ starts: t })} />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField label="Ends" value={d.ends} onChange={(t) => set({ ends: t })} />
        </View>
      </Pair>
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>COURTS</Small>
        <CourtPicker value={d.courtIds} onChange={(ids) => set({ courtIds: ids })} emptyMeansAll />
      </View>
      <Pair>
        <NumberField style={{ flex: 1 }} label="Longest" suffix="min" allowEmpty value={d.maxMinutes ?? null} onChange={(v) => set({ maxMinutes: v })} />
        <NumberField style={{ flex: 1 }} label="Per Member per Week" allowEmpty value={d.maxPerWeek ?? null} onChange={(v) => set({ maxPerWeek: v })} />
        <NumberField style={{ flex: 1 }} label="Book Ahead" suffix="days" allowEmpty value={d.advanceDays ?? null} onChange={(v) => set({ advanceDays: v })} />
      </Pair>
      <Small>Empty limits use the club’s usual rules.</Small>
      <ErrorText error={error} />
    </Sheet>
  );
}
