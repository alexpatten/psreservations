import { useCallback, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useLessons } from '@/lib/lessons';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, DAY_SHORT, dayLabel, dayOf, money, parseHm, timeOf, today, weekday, zonedMs } from '@/lib/time';
import { Avatar } from '../Avatar';
import { confirm, notice, toast } from '../Dialogs';
import { Banner, Body, Button, Card, Chip, ChipRow, DateField, Empty, ErrorText, Field, Loading, NumberField, Row, Segmented, Sheet, Small, Tag, TimeField, Toggle } from '../ui';
import { Pair, SectionHeader } from './Settings';

const COLORS = ['#F2711C', '#0A8754', '#2F6BFF', '#6A4FC8', '#C24AB0', '#E5484D', '#1D9BD1', '#D9A400'];

const daysLabel = (days: number[]) =>
  days.length === 7 ? 'Every day' : days.join() === '1,2,3,4,5' ? 'Weekdays' : days.join() === '0,6' ? 'Weekends' : days.map((d) => DAY_SHORT[d]).join(', ');

function DayPicker({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  return (
    <ChipRow>
      {DAY_SHORT.map((d, i) => (
        <Chip key={d} small label={d} selected={value.includes(i)} onPress={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())} />
      ))}
    </ChipRow>
  );
}

const Label = ({ text }: { text: string }) => <Small style={{ fontWeight: '600' }}>{text.toUpperCase()}</Small>;

// ---------------------------------------------------------------------------
// Instructors and instructor types
// ---------------------------------------------------------------------------

type InstructorDraft = Omit<Partial<api.Instructor>, 'account'> & { name: string; account?: string; availability: api.AvailabilityWindow[] };

export function InstructorsSection() {
  const { club } = useClub();
  const { data, error, reload, setData } = useLessons(club.id);
  const [editing, setEditing] = useState<InstructorDraft | null>(null);
  const [newType, setNewType] = useState('');

  if (!data) return error ? <ErrorText error={error} /> : <Loading />;
  const typeName = (id: string | null | undefined) => data.instructorTypes.find((t) => t.id === id)?.name;

  return (
    <>
      <SectionHeader
        title="Instructors"
        action={<Button small icon="plus" title="Instructor" onPress={() => setEditing({ name: '', color: COLORS[data.instructors.length % COLORS.length], availability: [{ days: [1, 2, 3, 4, 5], starts: '08:00', ends: '17:00' }] })} />}
      >
        Your teaching pros: their weekly hours, time off and whether members can book them online. Link a pro’s Pickle Spots account so
        they can see their week and take attendance under Teaching.
      </SectionHeader>
      <Card padded={false}>
        {data.instructors.length === 0 ? <Empty icon="users" title="No instructors yet" /> : null}
        {data.instructors.map((i, n) => (
          <Row
            key={i.id}
            left={<Avatar name={i.name} color={i.color} size={36} />}
            title={i.name}
            subtitle={[
              typeName(i.typeId),
              i.availability.map((a) => `${daysLabel(a.days)} ${clock(parseHm(a.starts), true)}–${clock(parseHm(a.ends), true)}`).join('; ') || 'No hours set',
              i.account ? `Account: ${i.account.playerCode}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={!i.membersCanBook ? <Tag label="Desk only" /> : undefined}
            onPress={() => setEditing({ ...i, account: i.account?.playerCode ?? '', availability: i.availability })}
            last={n === data.instructors.length - 1}
          />
        ))}
      </Card>

      <SectionHeader title="Instructor Types">Roles at your club, like Head Pro or Coach, for reporting and pricing.</SectionHeader>
      <Card style={{ gap: 12 }}>
        <ChipRow>
          {data.instructorTypes.map((t) => (
            <Chip
              key={t.id}
              label={`${t.name}  ✕`}
              onPress={async () => {
                if (await confirm(`Remove ${t.name}?`, 'Instructors of this type keep their pricing from the club’s rates.', { confirmLabel: 'Remove', destructive: true })) {
                  api.deleteInstructorType(t.id).then(setData, (e: Error) => toast(e.message));
                }
              }}
            />
          ))}
          {data.instructorTypes.length === 0 ? <Small>No types yet.</Small> : null}
        </ChipRow>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field style={{ flex: 1 }} placeholder="Head Pro, Teaching Pro, Junior Coach…" value={newType} onChangeText={setNewType} />
          <Button
            kind="secondary"
            title="Add"
            disabled={!newType.trim()}
            onPress={async () => {
              try {
                setData(await api.saveInstructorType(club.id, { name: newType }));
                setNewType('');
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          />
        </View>
      </Card>
      {editing ? <InstructorEditor club={club} lessons={data} draft={editing} onClose={() => setEditing(null)} onSaved={(l) => { setData(l); setEditing(null); }} onReload={reload} /> : null}
    </>
  );
}

function InstructorEditor({
  club,
  lessons,
  draft,
  onClose,
  onSaved,
  onReload,
}: {
  club: api.Club;
  lessons: api.Lessons;
  draft: InstructorDraft;
  onClose: () => void;
  onSaved: (l: api.Lessons) => void;
  onReload: () => void;
}) {
  const tz = club.timezone;
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [offDay, setOffDay] = useState(today(tz));
  const [offUntil, setOffUntil] = useState(today(tz));
  const [offReason, setOffReason] = useState('');
  const set = (p: Partial<InstructorDraft>) => setD({ ...d, ...p });
  const setWindow = (n: number, p: Partial<api.AvailabilityWindow>) => set({ availability: d.availability.map((a, i) => (i === n ? { ...a, ...p } : a)) });

  const save = async () => {
    setError(null);
    try {
      onSaved(
        await api.saveInstructor(club.id, {
          ...(d.id ? { id: d.id } : {}),
          name: d.name,
          typeId: d.typeId ?? null,
          bio: d.bio ?? '',
          color: d.color,
          membersCanBook: d.membersCanBook ?? true,
          account: d.account ?? '',
          availability: d.availability.filter((a) => a.days.length),
        }),
      );
      toast(`${d.name} saved.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!d.id || !(await confirm(`Remove ${d.name}?`, 'Their past lessons stay in your history.', { confirmLabel: 'Remove', destructive: true }))) return;
    try {
      onSaved(await api.deleteInstructor(d.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addOff = async () => {
    if (!d.id) return;
    try {
      const next = await api.addTimeOff(d.id, zonedMs(offDay, 0, tz), zonedMs(addDays(offUntil, 1), 0, tz), offReason);
      set({ timeOff: next.instructors.find((i) => i.id === d.id)?.timeOff ?? [] });
      setOffReason('');
      onReload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? `Edit ${draft.name}` : 'New Instructor'}
      accent={d.color}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" title="Remove" onPress={remove} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} disabled={!d.name.trim()} />
        </>
      }
    >
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} maxLength={60} />
      {lessons.instructorTypes.length ? (
        <View style={{ gap: 8 }}>
          <Label text="Type" />
          <ChipRow>
            <Chip small label="None" selected={!d.typeId} onPress={() => set({ typeId: null })} />
            {lessons.instructorTypes.map((t) => (
              <Chip key={t.id} small label={t.name} selected={d.typeId === t.id} onPress={() => set({ typeId: t.id })} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        <Label text="Color" />
        <ChipRow>
          {COLORS.map((col) => (
            <Chip key={col} small label={col === d.color ? '✓' : ' '} color={col} selected={col === d.color} onPress={() => set({ color: col })} />
          ))}
        </ChipRow>
      </View>
      <Field label="Bio (members see it)" value={d.bio ?? ''} onChangeText={(t) => set({ bio: t })} multiline maxLength={500} />
      <Field
        label="Pickle Spots Account"
        value={d.account ?? ''}
        onChangeText={(t) => set({ account: t })}
        autoCapitalize="none"
        placeholder="Player ID or email"
        hint="So they can see their schedule and take attendance. Leave empty if they don’t have one."
      />
      <Toggle label="Members Can Book Online" hint="Off: lessons with them are booked by staff." value={d.membersCanBook ?? true} onChange={(v) => set({ membersCanBook: v })} />

      <View style={{ gap: 10 }}>
        <Label text="Teaching Hours" />
        {d.availability.map((a, n) => (
          <Card key={n} style={{ gap: 10 }}>
            <DayPicker value={a.days} onChange={(days) => setWindow(n, { days })} />
            <Pair>
              <View style={{ flex: 1 }}>
                <TimeField label="From" value={a.starts} onChange={(t) => setWindow(n, { starts: t })} />
              </View>
              <View style={{ flex: 1 }}>
                <TimeField label="To" value={a.ends === '24:00' ? '23:59' : a.ends} onChange={(t) => setWindow(n, { ends: t === '23:59' ? '24:00' : t })} />
              </View>
            </Pair>
            <Button small kind="plain" title="Remove these hours" onPress={() => set({ availability: d.availability.filter((_, i) => i !== n) })} style={{ alignSelf: 'flex-start' }} />
          </Card>
        ))}
        <Button small kind="secondary" icon="plus" title="Add Hours" onPress={() => set({ availability: [...d.availability, { days: [6, 0], starts: '08:00', ends: '12:00' }] })} style={{ alignSelf: 'flex-start' }} />
      </View>

      {d.id ? (
        <View style={{ gap: 10 }}>
          <Label text="Time Off" />
          {(d.timeOff ?? []).map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Small muted={false} style={{ flex: 1 }}>
                {dayLabel(dayOf(t.startsAt, tz))} – {dayLabel(dayOf(t.endsAt - 1, tz))}
                {t.reason ? ` · ${t.reason}` : ''}
              </Small>
              <Button
                small
                kind="plain"
                title="Remove"
                onPress={() =>
                  api.deleteTimeOff(t.id).then((next) => {
                    set({ timeOff: next.instructors.find((i) => i.id === d.id)?.timeOff ?? [] });
                    onReload();
                  })
                }
              />
            </View>
          ))}
          <Pair>
            <View style={{ flex: 1 }}>
              <DateField label="From" value={offDay} onChange={(x) => { setOffDay(x); if (offUntil < x) setOffUntil(x); }} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="Through" value={offUntil} min={offDay} onChange={setOffUntil} />
            </View>
          </Pair>
          <Field placeholder="Reason (optional)" value={offReason} onChangeText={setOffReason} maxLength={120} />
          <Button small kind="secondary" title="Add Time Off" onPress={addOff} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Pro pricing
// ---------------------------------------------------------------------------

type RateDraft = Partial<api.Rate> & { priceCents: number };

export function ProPricingSection() {
  const { club } = useClub();
  const { data, error, setData } = useLessons(club.id);
  const [editing, setEditing] = useState<RateDraft | null>(null);
  if (!data) return error ? <ErrorText error={error} /> : <Loading />;

  const whoFor = (r: api.Rate) =>
    r.instructorId ? data.instructors.find((i) => i.id === r.instructorId)?.name ?? 'Instructor' : r.instructorTypeId ? `All ${data.instructorTypes.find((t) => t.id === r.instructorTypeId)?.name ?? 'type'}s` : 'All instructors';

  return (
    <>
      <SectionHeader title="Pro Pricing" action={<Button small icon="plus" title="Rate" onPress={() => setEditing({ name: 'Private', maxPlayers: 1, days: [0, 1, 2, 3, 4, 5, 6], starts: '00:00', ends: '24:00', priceCents: 6000 })} />}>
        Hourly lesson rates for an instructor, an instructor type, or everyone, for some days and hours, and up to a number of players. A lesson
        uses the rate for the smallest group that fits, and of those the most specific (the instructor’s, then their type’s, then the club’s).
      </SectionHeader>
      <Card padded={false}>
        {data.rates.length === 0 ? <Empty icon="dollar" title="No rates yet">Without a rate, lessons are booked without a price.</Empty> : null}
        {data.rates.map((r, n) => (
          <Row
            key={r.id}
            title={`${r.name} · ${money(r.priceCents)}/hr`}
            subtitle={`${whoFor(r)} · up to ${r.maxPlayers} player${r.maxPlayers === 1 ? '' : 's'} · ${daysLabel(r.days)}${r.starts !== '00:00' || r.ends !== '24:00' ? ` ${clock(parseHm(r.starts), true)}–${clock(parseHm(r.ends), true)}` : ''}`}
            onPress={() => setEditing(r)}
            last={n === data.rates.length - 1}
          />
        ))}
      </Card>
      {editing ? <RateEditor club={club} lessons={data} draft={editing} onClose={() => setEditing(null)} onSaved={(l) => { setData(l); setEditing(null); }} /> : null}
    </>
  );
}

function RateEditor({ club, lessons, draft, onClose, onSaved }: { club: api.Club; lessons: api.Lessons; draft: RateDraft; onClose: () => void; onSaved: (l: api.Lessons) => void }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const scope = d.instructorId ? 'instructor' : d.instructorTypeId ? 'type' : 'club';
  const set = (p: Partial<RateDraft>) => setD({ ...d, ...p });
  const save = async () => {
    setError(null);
    try {
      onSaved(await api.saveRate(club.id, d));
      toast('Rate saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? 'Edit Rate' : 'New Rate'}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" title="Remove" onPress={() => api.deleteRate(d.id!).then(onSaved, (e: Error) => setError(e.message))} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} />
        </>
      }
    >
      <Field label="Name" value={d.name ?? ''} onChangeText={(t) => set({ name: t })} placeholder="Private, Semi-private, Weekend…" maxLength={40} />
      <Label text="Applies To" />
      <Segmented
        value={scope}
        onChange={(v) =>
          set(v === 'club' ? { instructorId: null, instructorTypeId: null } : v === 'type' ? { instructorId: null, instructorTypeId: lessons.instructorTypes[0]?.id ?? null } : { instructorTypeId: null, instructorId: lessons.instructors[0]?.id ?? null })
        }
        options={[
          { value: 'club', label: 'Everyone' },
          ...(lessons.instructorTypes.length ? [{ value: 'type' as const, label: 'A Type' }] : []),
          ...(lessons.instructors.length ? [{ value: 'instructor' as const, label: 'One Instructor' }] : []),
        ]}
      />
      {scope === 'type' ? (
        <ChipRow>
          {lessons.instructorTypes.map((t) => (
            <Chip key={t.id} small label={t.name} selected={d.instructorTypeId === t.id} onPress={() => set({ instructorTypeId: t.id })} />
          ))}
        </ChipRow>
      ) : scope === 'instructor' ? (
        <ChipRow>
          {lessons.instructors.map((i) => (
            <Chip key={i.id} small label={i.name} color={i.color} selected={d.instructorId === i.id} onPress={() => set({ instructorId: i.id })} />
          ))}
        </ChipRow>
      ) : null}
      <Pair>
        <NumberField style={{ flex: 1 }} label="Price per Hour" suffix="$" value={d.priceCents / 100} onChange={(v) => set({ priceCents: Math.round((v ?? 0) * 100) })} />
        <NumberField style={{ flex: 1 }} label="Up To Players" value={d.maxPlayers ?? 1} onChange={(v) => set({ maxPlayers: v ?? 1 })} />
      </Pair>
      <Label text="Days" />
      <DayPicker value={d.days ?? []} onChange={(days) => set({ days })} />
      <Pair>
        <View style={{ flex: 1 }}>
          <TimeField label="From" value={d.starts ?? '00:00'} onChange={(t) => set({ starts: t })} />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField label="To" value={(d.ends ?? '24:00') === '24:00' ? '23:59' : d.ends!} onChange={(t) => set({ ends: t === '23:59' ? '24:00' : t })} />
        </View>
      </Pair>
      <Small>For a lesson starting in these hours. Use 00:00 to 23:59 for all day.</Small>
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Clinics
// ---------------------------------------------------------------------------

export function ClinicsSection() {
  const { club } = useClub();
  const tz = club.timezone;
  const { data: lessons } = useLessons(club.id);
  const [list, setList] = useState<api.Clinic[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<api.Clinic | null>(null);
  const [categories, setCategories] = useState<api.EventCategory[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const load = useCallback(() => {
    api.clinics(club.id).then(setList, () => setList([]));
    api.eventCategories(club.id).then(setCategories, () => {});
  }, [club.id]);
  useEffect(load, [load]);
  if (!lessons) return <Loading />;
  const origin = Platform.OS === 'web' ? window.location.origin : '';
  const publicUrl = `${origin}/events/${club.slug}`;

  return (
    <>
      <SectionHeader title="Events & Clinics" action={<Button small icon="plus" title="Event" onPress={() => setCreating(true)} />}>
        Programs, socials, tournaments and clinics on one or more dates, with spots, a price for the whole program (and optionally per date), a
        waitlist that moves players up automatically, and in Settings: who can register (gender, age, rating), terms to accept, questions, a
        registration window and online payment.
      </SectionHeader>
      <Card padded={false}>
        {list === null ? <Loading /> : list.length === 0 ? <Empty icon="calendar" title="No upcoming events" /> : null}
        {list?.map((cl, n) => {
          const next = cl.sessions.find((s) => s.status === 'booked' && s.endsAt > Date.now());
          return (
            <Row
              key={cl.id}
              title={cl.title}
              subtitle={`${next ? `${dayLabel(dayOf(next.startsAt, tz))} ${timeOf(next.startsAt, tz)} · ` : ''}${cl.sessions.length} date${cl.sessions.length === 1 ? '' : 's'} · ${cl.registered}/${cl.maxPlayers} registered${cl.waitlisted ? ` · ${cl.waitlisted} waiting` : ''} · ${money(cl.priceCents)}`}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {cl.categoryId ? <Tag label={categories.find((k) => k.id === cl.categoryId)?.name ?? ''} tone="violet" /> : null}
                  {!cl.published ? <Tag label="Draft" /> : null}
                </View>
              }
              onPress={() => setOpen(cl)}
              last={n === list.length - 1}
            />
          );
        })}
      </Card>

      <SectionHeader title="Event Categories">Like Programs, Socials, Tournaments and Juniors. Players filter by them.</SectionHeader>
      <Card style={{ gap: 10 }}>
        <ChipRow>
          {categories.map((k) => (
            <Chip key={k.id} small color={k.color} label={`${k.name}  ✕`} onPress={() => api.deleteEventCategory(k.id).then(setCategories, (e: Error) => toast(e.message))} />
          ))}
        </ChipRow>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field style={{ flex: 1 }} placeholder="Category name" value={newCategory} onChangeText={setNewCategory} />
          <Button
            kind="secondary"
            title="Add"
            disabled={!newCategory.trim()}
            onPress={() =>
              api
                .saveEventCategory(club.id, { name: newCategory, color: COLORS[categories.length % COLORS.length] })
                .then((k) => {
                  setCategories(k);
                  setNewCategory('');
                }, (e: Error) => toast(e.message))
            }
          />
        </View>
      </Card>

      <SectionHeader title="On Your Website">
        List your published events on a public page anyone can browse; registering asks them to sign in. Link to it or embed it.
      </SectionHeader>
      <PublicEventsCard club={club} url={publicUrl} />
      {creating ? (
        <ClinicCreator
          club={club}
          lessons={lessons}
          categories={categories}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      ) : null}
      {open ? (
        <ClinicSheet
          club={club}
          lessons={lessons}
          categories={categories}
          clinic={open}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      ) : null}
    </>
  );
}

function ClinicCreator({ club, lessons, categories, onClose, onCreated }: { club: api.Club; lessons: api.Lessons; categories: api.EventCategory[]; onClose: () => void; onCreated: () => void }) {
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const tz = club.timezone;
  const lessonTypes = club.types.filter((t) => lessons.lessonTypeIds.includes(t.id));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructorId, setInstructorId] = useState<string | null>(lessons.instructors[0]?.id ?? null);
  const [typeId, setTypeId] = useState((lessonTypes.find((t) => /clinic/i.test(t.name)) ?? lessonTypes[0] ?? club.types[0])?.id);
  const [courtId, setCourtId] = useState(club.courts.find((c) => c.kind === 'court')?.id);
  const [from, setFrom] = useState(addDays(today(tz), 7));
  const [until, setUntil] = useState(addDays(today(tz), 7 + 21));
  const [days, setDays] = useState<number[]>([weekday(addDays(today(tz), 7))]);
  const [startTime, setStartTime] = useState('18:00');
  const [minutes, setMinutes] = useState(90);
  const [maxPlayers, setMaxPlayers] = useState<number | null>(8);
  const [price, setPrice] = useState<number | null>(120);
  const [dropIn, setDropIn] = useState<number | null>(null);
  const [waitlist, setWaitlist] = useState(true);
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!typeId || !courtId) return;
    setError(null);
    try {
      const r = await api.createClinic(club.id, {
        title,
        description,
        instructorId,
        typeId,
        courtId,
        days,
        startTime,
        minutes,
        from,
        until,
        maxPlayers: maxPlayers ?? 1,
        priceCents: Math.round((price ?? 0) * 100),
        dropInPriceCents: dropIn == null ? null : Math.round(dropIn * 100),
        waitlist,
        published,
      });
      if (categoryId) await api.updateClinic(r.clinicId, { categoryId });
      onCreated();
      await notice(
        `Created ${r.created} date${r.created === 1 ? '' : 's'}`,
        r.skipped.length ? `Skipped:\n${r.skipped.map((s) => `${dayLabel(s.date)}: ${s.reason}`).join('\n')}` : undefined,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="New Event"
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Create Event" onPress={create} disabled={!title.trim() || !courtId || !typeId} />
        </>
      }
    >
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Advanced Drill Session" maxLength={80} />
      <Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} placeholder="Who it’s for, what to bring…" />
      {categories.length ? (
        <>
          <Label text="Category" />
          <ChipRow>
            <Chip small label="None" selected={!categoryId} onPress={() => setCategoryId(null)} />
            {categories.map((k) => (
              <Chip key={k.id} small label={k.name} color={k.color} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
            ))}
          </ChipRow>
        </>
      ) : null}
      <Label text="Instructor" />
      <ChipRow>
        <Chip small label="None" selected={!instructorId} onPress={() => setInstructorId(null)} />
        {lessons.instructors.map((i) => (
          <Chip key={i.id} small label={i.name} color={i.color} selected={instructorId === i.id} onPress={() => setInstructorId(i.id)} />
        ))}
      </ChipRow>
      <Label text="Type" />
      <ChipRow>
        {(lessonTypes.length ? lessonTypes : club.types).map((t) => (
          <Chip key={t.id} small label={t.name} color={t.color} selected={typeId === t.id} onPress={() => setTypeId(t.id)} />
        ))}
      </ChipRow>
      <Label text="Court" />
      <ChipRow>
        {club.courts
          .filter((c) => c.kind === 'court')
          .map((c) => (
            <Chip key={c.id} small label={c.name} selected={courtId === c.id} onPress={() => setCourtId(c.id)} />
          ))}
      </ChipRow>
      <Pair>
        <View style={{ flex: 1 }}>
          <DateField label="First Date" value={from} min={today(tz)} onChange={(d) => { setFrom(d); if (until < d) setUntil(d); }} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="Last Date" value={until} min={from} max={addDays(from, 366)} onChange={setUntil} />
        </View>
      </Pair>
      <Label text="Every" />
      <DayPicker value={days} onChange={setDays} />
      <Pair>
        <View style={{ flex: 1 }}>
          <TimeField label="Starts" value={startTime} onChange={setStartTime} />
        </View>
        <NumberField style={{ flex: 1 }} label="Length" suffix="min" value={minutes} onChange={(v) => setMinutes(v ?? 60)} />
      </Pair>
      <Pair>
        <NumberField style={{ flex: 1 }} label="Spots" value={maxPlayers} onChange={setMaxPlayers} />
        <NumberField style={{ flex: 1 }} label="Program Price" suffix="$" value={price} onChange={setPrice} />
        <NumberField style={{ flex: 1 }} label="Drop-in Price" suffix="$" allowEmpty value={dropIn} onChange={setDropIn} />
      </Pair>
      <Small>Leave the drop-in price empty for program-only events. Restrictions, terms, questions and online payment are under Settings once it’s created.</Small>
      <Toggle label="Waitlist When Full" value={waitlist} onChange={setWaitlist} />
      <Toggle label="Publish Now" hint="Off: a draft only staff can see." value={published} onChange={setPublished} />
      <ErrorText error={error} />
    </Sheet>
  );
}

function ClinicSheet({ club, lessons, categories, clinic, onClose, onChanged }: { club: api.Club; lessons: api.Lessons; categories: api.EventCategory[]; clinic: api.Clinic; onClose: () => void; onChanged: () => void }) {
  const [settings, setSettings] = useState(false);
  const tz = club.timezone;
  const [cl, setCl] = useState(clinic);
  const [roster, setRoster] = useState<api.RosterEntry[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loadRoster = useCallback(() => {
    api.clinicRoster(cl.id).then(setRoster, (e: Error) => setError(e.message));
  }, [cl.id]);
  useEffect(loadRoster, [loadRoster]);

  const refresh = async () => {
    loadRoster();
    onChanged();
    const next = (await api.clinics(club.id)).find((x) => x.id === cl.id);
    if (next) setCl(next);
  };
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await action();
      if (done) toast(done);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const upcoming = cl.sessions.filter((s) => s.status === 'booked');
  if (settings) {
    return (
      <EventSettingsSheet
        club={club}
        categories={categories}
        clinic={cl}
        onClose={() => setSettings(false)}
        onSaved={(next) => {
          setCl({ ...cl, ...next });
          setSettings(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={cl.title}
      width={640}
      footer={
        <>
          <Button
            kind="destructiveSoft"
            title="Cancel Clinic"
            onPress={async () => {
              if (await confirm('Cancel this clinic?', 'Every upcoming date and registration is cancelled.', { confirmLabel: 'Cancel Clinic', destructive: true })) {
                await run(() => api.cancelClinic(cl.id), 'Clinic cancelled.');
                onClose();
              }
            }}
          />
          <Button kind="secondary" icon="settings" title="Settings" onPress={() => setSettings(true)} />
          <Button kind="secondary" title={cl.published ? 'Unpublish' : 'Publish'} onPress={() => run(() => api.updateClinic(cl.id, { published: !cl.published }), cl.published ? 'Now a draft.' : 'Published.')} />
          <Button title="Done" onPress={onClose} />
        </>
      }
    >
      <Small>
        {lessons.instructors.find((i) => i.id === cl.instructorId)?.name ?? 'No instructor'} · {cl.registered}/{cl.maxPlayers} registered · {money(cl.priceCents)}
        {cl.dropInPriceCents != null ? ` · drop-in ${money(cl.dropInPriceCents)}` : ''}
      </Small>
      <Label text="Dates" />
      {upcoming.map((s) => (
        <Small key={s.reservationId} muted={false}>
          {dayLabel(dayOf(s.startsAt, tz))}, {timeOf(s.startsAt, tz)} – {timeOf(s.endsAt, tz)} · {cl.maxPlayers - s.spots} players
          {s.checkedIn ? ` · ${s.checkedIn} checked in` : ''}
        </Small>
      ))}
      <Label text="Roster" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field style={{ flex: 1 }} placeholder="Add a player by ID" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Button kind="secondary" title="Add" disabled={!code.trim()} onPress={() => run(() => api.registerClinic(cl.id, { ownerCode: code }).then(() => setCode('')), 'Added.')} />
      </View>
      {roster === null ? <Loading /> : roster.length === 0 ? <Small>No one yet.</Small> : null}
      {roster?.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Body>{p.name}</Body>
            <Small>
              {p.playerCode}
              {p.dropInReservationId ? ' · drop-in' : ''} · attended {p.attended}
              {p.amountCents ? ` · ${money(p.paidCents)} of ${money(p.amountCents)} paid` : ''}
            </Small>
          </View>
          {p.status === 'waitlisted' ? <Tag label="Waitlist" tone="warning" /> : null}
          {p.status === 'registered' && p.amountCents > p.paidCents ? (
            <Button small kind="secondary" title="Mark Paid" onPress={() => run(() => api.setPaid({ registrationId: p.id }, p.amountCents), 'Marked paid.')} />
          ) : null}
          <Button small kind="plain" title="Remove" onPress={() => run(() => api.unregisterClinic(cl.id, { userId: p.userId, reservationId: p.dropInReservationId ?? undefined }), 'Removed.')} />
        </View>
      ))}
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Instructor report (time reporting)
// ---------------------------------------------------------------------------

export function InstructorReportSection() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const { data: lessons } = useLessons(club.id);
  const t = today(tz);
  const presets = {
    week: [addDays(t, -6), t],
    month: [`${t.slice(0, 8)}01`, t],
    last30: [addDays(t, -29), t],
    next30: [t, addDays(t, 29)],
  } as const;
  const [preset, setPreset] = useState<keyof typeof presets>('month');
  const [from, to] = presets[preset];
  const [rows, setRows] = useState<api.InstructorReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api.instructorReport(club.id, from, to).then(setRows, (e: Error) => setError(e.message));
  }, [club.id, from, to]);

  const typeName = (id: string | null) => lessons?.instructorTypes.find((x) => x.id === id)?.name;
  const exportCsv = () => {
    if (!rows || Platform.OS !== 'web') return;
    const head = ['Instructor', 'Type', 'Lessons', 'Clinic dates', 'Hours taught', 'Hours available', 'Utilization %', 'Billed', 'Paid', 'Students', 'Attendance %'];
    const body = rows.map((r) => [r.name, typeName(r.typeId) ?? '', r.lessons, r.clinicSessions, r.hours, r.availableHours, r.utilization ?? '', (r.revenueCents / 100).toFixed(2), (r.paidCents / 100).toFixed(2), r.students, r.attendance ?? '']);
    const csv = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${club.slug}-instructors-${from}-to-${to}.csv`;
    a.click();
  };

  return (
    <>
      <SectionHeader title="Instructor Report" action={Platform.OS === 'web' && rows?.length ? <Button small kind="secondary" title="Export CSV" onPress={exportCsv} /> : undefined}>
        How much time each pro spends on court, how full their schedule is, what they bill, and who shows up.
      </SectionHeader>
      <Segmented
        value={preset}
        onChange={setPreset}
        options={[
          { value: 'week', label: 'Last 7 Days' },
          { value: 'month', label: 'This Month' },
          { value: 'last30', label: 'Last 30 Days' },
          { value: 'next30', label: 'Next 30 Days' },
        ]}
      />
      <Small>
        {dayLabel(from)} – {dayLabel(to)}
      </Small>
      <ErrorText error={error} />
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <Empty icon="users" title="No instructors yet" />
        </Card>
      ) : (
        rows.map((r) => {
          const i = lessons?.instructors.find((x) => x.id === r.instructorId);
          return (
            <Card key={r.instructorId} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={r.name} color={i?.color ?? c.tint} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.label }]}>{r.name}</Text>
                  {typeName(r.typeId) ? <Small>{typeName(r.typeId)}</Small> : null}
                </View>
                {r.utilization != null ? <Tag label={`${r.utilization}% booked`} tone={r.utilization >= 75 ? 'tint' : r.utilization >= 40 ? 'warning' : 'slate'} /> : null}
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: c.fill, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, r.utilization ?? 0)}%`, height: 8, backgroundColor: i?.color ?? c.tint }} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
                <Stat label="On court" value={`${r.hours} hr`} sub={r.availableHours ? `of ${r.availableHours} available` : undefined} />
                <Stat label="Lessons" value={String(r.lessons)} />
                <Stat label="Clinic dates" value={String(r.clinicSessions)} />
                <Stat label="Billed" value={money(r.revenueCents)} sub={`${money(r.paidCents)} paid`} />
                <Stat label="Students" value={String(r.students)} />
                <Stat label="Attendance" value={r.attendance != null ? `${r.attendance}%` : '–'} />
              </View>
            </Card>
          );
        })
      )}
      <Banner tone="info">Hours available come from each pro’s weekly teaching hours. Utilization is hours taught over hours available.</Banner>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const c = useColors();
  return (
    <View style={{ minWidth: 90 }}>
      <Text style={[type.title3, { color: c.label }]}>{value}</Text>
      <Small>{label}</Small>
      {sub ? <Small style={{ fontSize: 11 }}>{sub}</Small> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Event settings and the public events page
// ---------------------------------------------------------------------------

const toLocalInput = (ms: number | null | undefined, tz: string) => (ms ? `${dayOf(ms, tz)}` : '');

function EventSettingsSheet({ club, categories, clinic: cl, onClose, onSaved }: { club: api.Club; categories: api.EventCategory[]; clinic: api.Clinic; onClose: () => void; onSaved: (c: api.Clinic) => void }) {
  const tz = club.timezone;
  const [d, setD] = useState({
    categoryId: cl.categoryId ?? null,
    gender: cl.gender ?? 'any',
    minAge: cl.minAge ?? null,
    maxAge: cl.maxAge ?? null,
    minRating: cl.minRating ?? null,
    maxRating: cl.maxRating ?? null,
    disclosure: cl.disclosure ?? '',
    customFields: cl.customFields ?? [],
    membersOnly: cl.membersOnly ?? true,
    requirePayment: cl.requirePayment ?? false,
    opens: toLocalInput(cl.registrationOpensAt, tz),
    closes: toLocalInput(cl.registrationClosesAt, tz),
    maxPlayers: cl.maxPlayers,
    priceCents: cl.priceCents,
    title: cl.title,
    description: cl.description ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof d>) => setD({ ...d, ...p });
  const setField = (i: number, f: Partial<api.CustomField>) => set({ customFields: d.customFields.map((x, j) => (j === i ? { ...x, ...f } : x)) });

  const save = async () => {
    setError(null);
    try {
      onSaved(
        await api.updateClinic(cl.id, {
          title: d.title,
          description: d.description,
          maxPlayers: d.maxPlayers,
          priceCents: d.priceCents,
          categoryId: d.categoryId,
          gender: d.gender,
          minAge: d.minAge,
          maxAge: d.maxAge,
          minRating: d.minRating,
          maxRating: d.maxRating,
          disclosure: d.disclosure,
          customFields: d.customFields.filter((f) => f.label.trim()).map((f) => ({ ...f, options: f.type === 'select' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })),
          membersOnly: d.membersOnly,
          requirePayment: d.requirePayment,
          registrationOpensAt: d.opens ? zonedMs(d.opens, 0, tz) : null,
          registrationClosesAt: d.closes ? zonedMs(addDays(d.closes, 1), 0, tz) : null,
        }),
      );
      toast('Event saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Event Settings"
      width={640}
      footer={
        <>
          <Button kind="secondary" title="Back" onPress={onClose} />
          <Button title="Save" onPress={save} />
        </>
      }
    >
      <Field label="Title" value={d.title} onChangeText={(t) => set({ title: t })} maxLength={80} />
      <Field label="Description" value={d.description} onChangeText={(t) => set({ description: t })} multiline maxLength={1000} />
      <Pair>
        <NumberField style={{ flex: 1 }} label="Spots" value={d.maxPlayers} onChange={(v) => set({ maxPlayers: v ?? 1 })} />
        <NumberField style={{ flex: 1 }} label="Program Price" suffix="$" value={d.priceCents / 100} onChange={(v) => set({ priceCents: Math.round((v ?? 0) * 100) })} />
      </Pair>
      {categories.length ? (
        <>
          <Label text="Category" />
          <ChipRow>
            <Chip small label="None" selected={!d.categoryId} onPress={() => set({ categoryId: null })} />
            {categories.map((k) => (
              <Chip key={k.id} small label={k.name} color={k.color} selected={d.categoryId === k.id} onPress={() => set({ categoryId: k.id })} />
            ))}
          </ChipRow>
        </>
      ) : null}

      <Label text="Who Can Register" />
      <Toggle label="Members Only" hint="Off: anyone with a Pickle Spots account can register (and joins the club)." value={d.membersOnly} onChange={(v) => set({ membersOnly: v })} />
      <Segmented
        value={d.gender}
        onChange={(g) => set({ gender: g })}
        options={[
          { value: 'any', label: 'Everyone' },
          { value: 'women', label: 'Women' },
          { value: 'men', label: 'Men' },
        ]}
      />
      <Pair>
        <NumberField style={{ flex: 1 }} label="Min Age" allowEmpty value={d.minAge} onChange={(v) => set({ minAge: v })} />
        <NumberField style={{ flex: 1 }} label="Max Age" allowEmpty value={d.maxAge} onChange={(v) => set({ maxAge: v })} />
        <NumberField style={{ flex: 1 }} label="Min Rating" allowEmpty value={d.minRating} onChange={(v) => set({ minRating: v })} />
        <NumberField style={{ flex: 1 }} label="Max Rating" allowEmpty value={d.maxRating} onChange={(v) => set({ maxRating: v })} />
      </Pair>
      <Small>Ages are on the first date. Ratings are players’ Pickle Spots doubles ratings (DUPR or self-rated).</Small>

      <Label text="Registration" />
      <Pair>
        <View style={{ flex: 1 }}>
          <DateField label="Opens" value={d.opens || today(tz)} onChange={(v) => set({ opens: v })} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="Closes (end of day)" value={d.closes || today(tz)} onChange={(v) => set({ closes: v })} />
        </View>
      </Pair>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {d.opens ? <Button small kind="plain" title="Open now instead" onPress={() => set({ opens: '' })} /> : null}
        {d.closes ? <Button small kind="plain" title="No closing date" onPress={() => set({ closes: '' })} /> : null}
      </View>
      <Toggle
        label="Pay Online to Register"
        hint={'Players pay when they register; their spot is held 15 minutes. Needs Stripe connected (Public Booking). Off: pay at the desk or on account.'}
        value={d.requirePayment}
        onChange={(v) => set({ requirePayment: v })}
      />

      <Label text="Terms to Accept" />
      <Field value={d.disclosure} onChangeText={(t) => set({ disclosure: t })} multiline maxLength={5000} placeholder="Waiver, refund policy, code of conduct… Leave empty for none." />

      <Label text="Questions" />
      {d.customFields.map((f, i) => (
        <Card key={f.id} style={{ gap: 10 }}>
          <Field value={f.label} onChangeText={(t) => setField(i, { label: t })} placeholder="Question" maxLength={60} />
          <Segmented
            value={f.type}
            onChange={(t) => setField(i, { type: t })}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'number', label: 'Number' },
              { value: 'checkbox', label: 'Checkbox' },
              { value: 'select', label: 'Choice' },
            ]}
          />
          {f.type === 'select' ? <Field value={(f.options ?? []).join(', ')} onChangeText={(t) => setField(i, { options: t.split(',').map((x) => x.trimStart()) })} placeholder="Choices, separated by commas" /> : null}
          <Toggle label="Required" value={!!f.required} onChange={(v) => setField(i, { required: v })} />
          <Button small kind="plain" title="Remove" onPress={() => set({ customFields: d.customFields.filter((_, j) => j !== i) })} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ))}
      <Button small kind="secondary" icon="plus" title="Add Question" style={{ alignSelf: 'flex-start' }} onPress={() => set({ customFields: [...d.customFields, { id: Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false }] })} />
      <ErrorText error={error} />
    </Sheet>
  );
}

function PublicEventsCard({ club, url }: { club: api.Club; url: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    api.publicEvents(club.slug).then((x) => setOn(!!x), () => setOn(false));
  }, [club.slug]);
  const frame = `<iframe src="${url}" title="Events at ${club.name.replace(/"/g, '&quot;')}" style="width:100%;height:900px;border:0"></iframe>`;
  const copy = (text: string) => {
    if (Platform.OS === 'web' && navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied.'));
  };
  return (
    <Card style={{ gap: 10 }}>
      <Toggle
        label="List Events Publicly"
        value={!!on}
        onChange={api.isManager(club.myRole) ? (v) => api.setPublicEvents(club.id, v).then(() => setOn(v), (e: Error) => toast(e.message)) : () => {}}
      />
      {on ? (
        <>
          <Field value={url} editable={false} selectTextOnFocus />
          <ChipRow>
            <Chip icon="link" label="Copy Link" onPress={() => copy(url)} />
            <Chip icon="tv" label="Open" onPress={() => Platform.OS === 'web' && window.open(url, '_blank')} />
            <Chip icon="link" label="Copy Embed Code" onPress={() => copy(frame)} />
          </ChipRow>
        </>
      ) : null}
    </Card>
  );
}
