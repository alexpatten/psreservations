import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { dayLabel, dayOf, money } from '@/lib/time';
import { confirm, toast } from '../Dialogs';
import { Banner, Body, Button, Card, Chip, ChipRow, Empty, ErrorText, Field, Loading, NumberField, Row, Segmented, Sheet, Small, Tag, Toggle } from '../ui';
import { Pair, SectionHeader } from './Settings';

const PERIODS: { value: api.PlanPeriod; label: string }[] = [
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
  { value: 'once', label: 'One time' },
];

function useMemberships() {
  const { club } = useClub();
  const [data, setData] = useState<api.MembershipsData | null>(null);
  const reload = useCallback(() => {
    api.memberships(club.id).then(setData, (e: Error) => toast(e.message));
  }, [club.id]);
  useEffect(reload, [reload]);
  return { data, setData, reload };
}

// ---------------------------------------------------------------------------
// Plans and families
// ---------------------------------------------------------------------------

export function PlansSection() {
  const { club } = useClub();
  const { data, setData, reload } = useMemberships();
  const [editing, setEditing] = useState<(Partial<api.Plan> & { name: string }) | null>(null);
  const [assign, setAssign] = useState(false);
  const [family, setFamily] = useState(false);
  if (!data) return <Loading />;
  const manager = api.isManager(club.myRole);

  return (
    <>
      <SectionHeader title="Membership Plans" action={manager ? <Button small icon="plus" title="Plan" onPress={() => setEditing({ name: '', priceCents: 0, period: 'month', maxMembers: 1, selfSignup: true })} /> : undefined}>
        Plans with a price and billing period, and booking perks: book further ahead, hold more reservations, or more a day. Family plans cover
        everyone in a family. Dues are billed under Billing.
      </SectionHeader>
      {manager ? (
        <Card>
          <Toggle
            label="Require a Membership to Book"
            hint="Members without an active plan can’t book courts (staff still can for them)."
            value={data.requireMembership}
            onChange={(v) => api.setRequireMembership(club.id, v).then(reload, (e: Error) => toast(e.message))}
          />
        </Card>
      ) : null}
      <Card padded={false}>
        {data.plans.length === 0 ? <Empty icon="star" title="No plans yet" /> : null}
        {data.plans.map((p, i) => (
          <Row
            key={p.id}
            title={`${p.name} · ${money(p.priceCents)} ${PERIODS.find((x) => x.value === p.period)?.label.toLowerCase()}`}
            subtitle={[
              p.maxMembers > 1 ? `Family (up to ${p.maxMembers})` : null,
              p.advanceDays ? `${p.advanceDays} days ahead` : null,
              p.maxUpcoming ? `${p.maxUpcoming} upcoming` : null,
              p.maxPerDay ? `${p.maxPerDay}/day` : null,
              `${p.activeMembers ?? 0} active`,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={!p.selfSignup ? <Tag label="Desk only" /> : undefined}
            onPress={manager ? () => setEditing(p) : undefined}
            last={i === data.plans.length - 1}
          />
        ))}
      </Card>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button kind="secondary" icon="plus" title="Start a Membership" onPress={() => setAssign(true)} disabled={!data.plans.length} />
        <Button kind="secondary" icon="users" title="Set Up a Family" onPress={() => setFamily(true)} />
      </View>
      {editing ? <PlanEditor club={club} draft={editing} onClose={() => setEditing(null)} onSaved={(d) => { setData(d); setEditing(null); }} /> : null}
      {assign ? <AssignPlanSheet plans={data.plans} onClose={() => setAssign(false)} onDone={() => { setAssign(false); reload(); }} /> : null}
      {family ? <FamilySheet club={club} onClose={() => setFamily(false)} /> : null}
    </>
  );
}

function PlanEditor({ club, draft, onClose, onSaved }: { club: api.Club; draft: Partial<api.Plan> & { name: string }; onClose: () => void; onSaved: (d: api.MembershipsData) => void }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<api.Plan>) => setD({ ...d, ...p });
  return (
    <Sheet
      visible
      onClose={onClose}
      title={d.id ? `Edit ${draft.name}` : 'New Plan'}
      footer={
        <>
          {d.id ? <Button kind="destructiveSoft" title="Retire" onPress={() => api.deletePlan(d.id!).then(onSaved, (e: Error) => setError(e.message))} /> : null}
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" disabled={!d.name.trim()} onPress={() => api.savePlan(club.id, d).then(onSaved, (e: Error) => setError(e.message))} />
        </>
      }
    >
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} placeholder="Individual, Family, Junior…" maxLength={60} />
      <Field label="Description" value={d.description ?? ''} onChangeText={(t) => set({ description: t })} multiline maxLength={1000} />
      <Pair>
        <NumberField style={{ flex: 1 }} label="Price" suffix="$" value={(d.priceCents ?? 0) / 100} onChange={(v) => set({ priceCents: Math.round((v ?? 0) * 100) })} />
        <NumberField style={{ flex: 1 }} label="People Covered" value={d.maxMembers ?? 1} onChange={(v) => set({ maxMembers: v ?? 1 })} hint="2+ for a family plan." />
      </Pair>
      <Segmented value={d.period ?? 'month'} onChange={(v) => set({ period: v })} options={PERIODS} />
      <Small style={{ fontWeight: '600' }}>BOOKING PERKS (EMPTY: CLUB RULES)</Small>
      <Pair>
        <NumberField style={{ flex: 1 }} label="Book Ahead" suffix="days" allowEmpty value={d.advanceDays ?? null} onChange={(v) => set({ advanceDays: v })} hint={`Club: ${club.rules.advanceDays}`} />
        <NumberField style={{ flex: 1 }} label="Upcoming" allowEmpty value={d.maxUpcoming ?? null} onChange={(v) => set({ maxUpcoming: v })} hint={`Club: ${club.rules.maxUpcoming}`} />
        <NumberField style={{ flex: 1 }} label="Per Day" allowEmpty value={d.maxPerDay ?? null} onChange={(v) => set({ maxPerDay: v })} hint={`Club: ${club.rules.maxPerDay}`} />
      </Pair>
      <Toggle label="Members Can Sign Up Themselves" value={d.selfSignup ?? true} onChange={(v) => set({ selfSignup: v })} />
      <ErrorText error={error} />
    </Sheet>
  );
}

function AssignPlanSheet({ plans, onClose, onDone }: { plans: api.Plan[]; onClose: () => void; onDone: () => void }) {
  const [planId, setPlanId] = useState(plans[0]?.id);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Start a Membership"
      width={460}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button
            title="Start"
            disabled={!planId || !code.trim()}
            onPress={() =>
              api.startMembership(planId!, { ownerCode: code }).then((m) => {
                toast(`${m.memberName} is on ${m.planName}.`);
                onDone();
              }, (e: Error) => setError(e.message))
            }
          />
        </>
      }
    >
      <ChipRow>
        {plans.map((p) => (
          <Chip key={p.id} label={p.name} selected={planId === p.id} onPress={() => setPlanId(p.id)} />
        ))}
      </ChipRow>
      <Field label="Member’s Player ID" value={code} onChangeText={setCode} autoCapitalize="characters" hint="For a family plan, set up the family first; the plan then covers everyone in it." />
      <ErrorText error={error} />
    </Sheet>
  );
}

function FamilySheet({ club, onClose }: { club: api.Club; onClose: () => void }) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState([{ code: '', relationship: 'Parent' }, { code: '', relationship: 'Child' }]);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Set Up a Family"
      width={520}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button
            title="Save Family"
            disabled={!name.trim()}
            onPress={() =>
              api.saveFamily(club.id, { name, members: rows.filter((r) => r.code.trim()) }).then(() => {
                toast(`${name} saved.`);
                onClose();
              }, (e: Error) => setError(e.message))
            }
          />
        </>
      }
    >
      <Small>Families share family plans and show together on members’ pages. Each person needs a Pickle Spots account (juniors too; a parent can make one).</Small>
      <Field label="Family Name" value={name} onChangeText={setName} placeholder="The Riveras" />
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Field style={{ flex: 2 }} placeholder="Player ID" value={r.code} onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, code: t } : x)))} autoCapitalize="characters" />
          <Field style={{ flex: 1 }} placeholder="Relationship" value={r.relationship} onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, relationship: t } : x)))} />
        </View>
      ))}
      <Button small kind="plain" icon="plus" title="Add Person" style={{ alignSelf: 'flex-start' }} onPress={() => setRows([...rows, { code: '', relationship: '' }])} />
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function GroupsSection() {
  const { club } = useClub();
  const { data, setData } = useMemberships();
  const [name, setName] = useState('');
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState<api.MemberGroup | null>(null);
  if (!data) return <Loading />;
  return (
    <>
      <SectionHeader title="Member Groups">Groups for communication and programming: email a group, or let members see and join groups marked visible.</SectionHeader>
      <Card padded={false}>
        {data.groups.length === 0 ? <Empty icon="users" title="No groups yet" /> : null}
        {data.groups.map((g, i) => (
          <Row key={g.id} title={g.name} subtitle={`${g.members} member${g.members === 1 ? '' : 's'}${g.description ? ` · ${g.description}` : ''}`} right={g.visible ? <Tag label="Visible" tone="teal" /> : <Tag label="Staff only" />} onPress={() => setOpen(g)} last={i === data.groups.length - 1} />
        ))}
      </Card>
      <Card style={{ gap: 10 }}>
        <Field label="New Group" value={name} onChangeText={setName} placeholder="Tuesday Ladies, Juniors, Board…" />
        <Toggle label="Visible to Members" hint="They can see it and join it themselves." value={visible} onChange={setVisible} />
        <Button small title="Add Group" disabled={!name.trim()} style={{ alignSelf: 'flex-start' }} onPress={() => api.saveGroup(club.id, { name, visible }).then((d) => { setData(d); setName(''); }, (e: Error) => toast(e.message))} />
      </Card>
      {open ? <GroupSheet group={open} onClose={() => setOpen(null)} onChanged={setData} clubId={club.id} /> : null}
    </>
  );
}

function GroupSheet({ clubId, group, onClose, onChanged }: { clubId: string; group: api.MemberGroup; onClose: () => void; onChanged: (d: api.MembershipsData) => void }) {
  const [list, setList] = useState<{ userId: string; name: string; playerCode: string }[] | null>(null);
  const [code, setCode] = useState('');
  const load = useCallback(() => {
    api.groupMembers(group.id).then(setList, () => setList([]));
  }, [group.id]);
  useEffect(load, [load]);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={group.name}
      footer={
        <>
          <Button
            kind="destructiveSoft"
            title="Delete Group"
            onPress={async () => {
              if (await confirm(`Delete ${group.name}?`, undefined, { confirmLabel: 'Delete', destructive: true })) api.deleteGroup(group.id).then((d) => { onChanged(d); onClose(); });
            }}
          />
          <Button title="Done" onPress={onClose} />
        </>
      }
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field style={{ flex: 1 }} placeholder="Add by Player ID" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Button kind="secondary" title="Add" disabled={!code.trim()} onPress={() => api.groupMember(group.id, true, code).then(() => { setCode(''); load(); api.memberships(clubId).then(onChanged); }, (e: Error) => toast(e.message))} />
      </View>
      {list === null ? <Loading /> : list.length === 0 ? <Small>No one yet.</Small> : null}
      {list?.map((m) => (
        <View key={m.userId} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Body style={{ flex: 1 }}>
            {m.name} <Small>{m.playerCode}</Small>
          </Body>
          <Button small kind="plain" title="Remove" onPress={() => api.groupMember(group.id, false, m.playerCode).then(load)} />
        </View>
      ))}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Waivers and ratings
// ---------------------------------------------------------------------------

export function WaiversSection() {
  const { club } = useClub();
  const tz = club.timezone;
  const { data, setData } = useMemberships();
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string; required: boolean } | null>(null);
  const [signatures, setSignatures] = useState<api.Waiver | null>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof api.waiverSignatures>> | null>(null);
  useEffect(() => {
    if (signatures) api.waiverSignatures(signatures.id).then(setList, () => setList([]));
  }, [signatures]);
  if (!data) return <Loading />;
  const manager = api.isManager(club.myRole);
  return (
    <>
      <SectionHeader title="Waivers & Agreements" action={manager ? <Button small icon="plus" title="Waiver" onPress={() => setEditing({ title: '', body: '', required: true })} /> : undefined}>
        Members read and sign online, with a drawn signature. Required waivers must be signed before booking. Changing a waiver’s text asks everyone to sign again.
      </SectionHeader>
      <Card padded={false}>
        {data.waivers.length === 0 ? <Empty icon="edit" title="No waivers yet" /> : null}
        {data.waivers.map((w, i) => (
          <Row
            key={w.id}
            title={w.title}
            subtitle={`Version ${w.version} · ${w.signatures ?? 0} signed${w.required ? ' · required to book' : ''}`}
            right={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Button small kind="secondary" title="Signatures" onPress={() => setSignatures(w)} />
                {manager ? <Button small kind="plain" title="Edit" onPress={() => setEditing(w)} /> : null}
              </View>
            }
            last={i === data.waivers.length - 1}
          />
        ))}
      </Card>
      {editing ? (
        <Sheet
          visible
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit Waiver' : 'New Waiver'}
          footer={
            <>
              <Button kind="secondary" title="Cancel" onPress={() => setEditing(null)} />
              <Button title="Save" onPress={() => api.saveWaiver(club.id, editing).then((d) => { setData(d); setEditing(null); }, (e: Error) => toast(e.message))} />
            </>
          }
        >
          <Field label="Title" value={editing.title} onChangeText={(t) => setEditing({ ...editing, title: t })} placeholder="Liability Waiver" />
          <Field label="Text" value={editing.body} onChangeText={(t) => setEditing({ ...editing, body: t })} multiline maxLength={20000} />
          <Toggle label="Required to Book" value={editing.required} onChange={(v) => setEditing({ ...editing, required: v })} />
          {editing.id ? <Banner tone="warning">Changing the text asks every member to sign again.</Banner> : null}
        </Sheet>
      ) : null}
      {signatures ? (
        <Sheet visible onClose={() => setSignatures(null)} title={`${signatures.title}: Signatures`}>
          {list === null ? <Loading /> : list.length === 0 ? <Small>No one has signed this version yet.</Small> : null}
          {list?.map((s) => (
            <View key={s.userId} style={{ gap: 4 }}>
              <Body>
                {s.name} <Small>signed as “{s.signedName}” · {dayLabel(dayOf(s.signedAt, tz))}</Small>
              </Body>
              {s.signatureSvg ? (
                <View style={{ height: 60, backgroundColor: '#fff', borderRadius: 8 }}>
                  <Svg width="100%" height={60} viewBox="0 0 600 140" preserveAspectRatio="xMinYMid meet">
                    <Path d={s.signatureSvg} stroke="#10241A" strokeWidth={3} fill="none" />
                  </Svg>
                </View>
              ) : null}
            </View>
          ))}
        </Sheet>
      ) : null}
    </>
  );
}

export function RatingsSection() {
  const { club } = useClub();
  const { data, setData } = useMemberships();
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<api.RatingScale['audience']>('all');
  const [min, setMin] = useState<number | null>(1);
  const [max, setMax] = useState<number | null>(5);
  const [step, setStep] = useState<number | null>(0.5);
  if (!data) return <Loading />;
  return (
    <>
      <SectionHeader title="Custom Ratings">
        Your own rating scales for adults and juniors. Staff rate members from their member page. Event rating limits use the first scale when a member has a rating on it,
        otherwise their Pickle Spots (DUPR) rating.
      </SectionHeader>
      <Card padded={false}>
        {data.ratingScales.length === 0 ? <Empty icon="star" title="No rating scales yet" /> : null}
        {data.ratingScales.map((s, i) => (
          <Row
            key={s.id}
            title={s.name}
            subtitle={`${s.min} to ${s.max}, steps of ${s.step} · ${s.audience === 'all' ? 'Everyone' : s.audience === 'adults' ? 'Adults' : 'Juniors'}`}
            right={<Button small kind="plain" title="Remove" onPress={() => api.deleteRatingScale(s.id).then(setData, (e: Error) => toast(e.message))} />}
            last={i === data.ratingScales.length - 1}
          />
        ))}
      </Card>
      <Card style={{ gap: 10 }}>
        <Field label="New Scale" value={name} onChangeText={setName} placeholder="Club Rating, Junior Level…" />
        <Segmented
          value={audience}
          onChange={setAudience}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'adults', label: 'Adults' },
            { value: 'juniors', label: 'Juniors' },
          ]}
        />
        <Pair>
          <NumberField style={{ flex: 1 }} label="Lowest" value={min} onChange={setMin} />
          <NumberField style={{ flex: 1 }} label="Highest" value={max} onChange={setMax} />
          <NumberField style={{ flex: 1 }} label="Step" value={step} onChange={setStep} />
        </Pair>
        <Button small title="Add Scale" disabled={!name.trim()} style={{ alignSelf: 'flex-start' }} onPress={() => api.saveRatingScale(club.id, { name, audience, min: min ?? 1, max: max ?? 5, step: step ?? 0.5 }).then((d) => { setData(d); setName(''); }, (e: Error) => toast(e.message))} />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export function EmailSection() {
  const { club } = useClub();
  const tz = club.timezone;
  const { data } = useMemberships();
  const [audience, setAudience] = useState<api.EmailAudience>({ audience: 'all' });
  const [count, setCount] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('Hi {first_name},\n\n');
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.emailHistory>>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCount(null);
    api.emailAudienceCount(club.id, audience).then(setCount, () => setCount(null));
  }, [club.id, audience]);
  useEffect(() => {
    api.emailHistory(club.id).then(setHistory, () => {});
  }, [club.id]);
  if (!data) return <Loading />;

  const toggle = (key: 'planIds' | 'groupIds', id: string) => {
    const list = audience[key] ?? [];
    setAudience({ ...audience, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const send = async (test: boolean) => {
    setError(null);
    if (!test && !(await confirm(`Email ${count ?? 0} member${count === 1 ? '' : 's'}?`, subject, { confirmLabel: 'Send' }))) return;
    try {
      const r = await api.sendClubEmail(club.id, subject, body, audience, test);
      toast(test ? 'Test sent to you.' : `Sent to ${r.sent}.`);
      if (!test) api.emailHistory(club.id).then(setHistory, () => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <SectionHeader title="Email Members">Write once, send to everyone or just some: members with or without a plan, on certain plans, or in certain groups. “{'{first_name}'}” becomes each member’s name.</SectionHeader>
      <Card style={{ gap: 12 }}>
        <Segmented
          value={audience.audience}
          onChange={(a) => setAudience({ audience: a })}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'active', label: 'With a Plan' },
            { value: 'none', label: 'No Plan' },
            { value: 'plan', label: 'Plans…' },
            { value: 'group', label: 'Groups…' },
          ]}
        />
        {audience.audience === 'plan' ? (
          <ChipRow>
            {data.plans.map((p) => (
              <Chip key={p.id} small label={p.name} selected={audience.planIds?.includes(p.id)} onPress={() => toggle('planIds', p.id)} />
            ))}
          </ChipRow>
        ) : null}
        {audience.audience === 'group' ? (
          <ChipRow>
            {data.groups.map((g) => (
              <Chip key={g.id} small label={g.name} selected={audience.groupIds?.includes(g.id)} onPress={() => toggle('groupIds', g.id)} />
            ))}
          </ChipRow>
        ) : null}
        <Small>{count == null ? 'Counting…' : `${count} member${count === 1 ? '' : 's'} with an email address`}</Small>
        <Field label="Subject" value={subject} onChangeText={setSubject} />
        <Field label="Message" value={body} onChangeText={setBody} multiline />
        <ErrorText error={error} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="secondary" title="Send Me a Test" disabled={!subject.trim() || !body.trim()} onPress={() => send(true)} />
          <Button icon="link" title="Send" disabled={!subject.trim() || !body.trim() || !count} onPress={() => send(false)} />
        </View>
      </Card>
      {history.length ? (
        <Card padded={false}>
          {history.map((h, i) => (
            <Row key={h.id} title={h.subject} subtitle={`${dayLabel(dayOf(h.sentAt, tz))} · ${h.recipients} recipients${h.sentBy ? ` · ${h.sentBy}` : ''}`} last={i === history.length - 1} />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Staff: one member at a glance, inside the member sheet: plans, account, visits, waivers, family, groups, details and club ratings. */
export function MemberProfileView({ clubId, userId, tz }: { clubId: string; userId: string; tz: string }) {
  const [p, setP] = useState<api.MemberProfile | null>(null);
  const [scales, setScales] = useState<api.RatingScale[]>([]);
  const load = useCallback(() => {
    api.memberProfile(clubId, userId).then(setP, () => {});
    api.memberships(clubId).then((d) => setScales(d.ratingScales), () => {});
  }, [clubId, userId]);
  useEffect(load, [load]);
  if (!p) return <Loading />;
  const active = p.memberships.filter((m) => m.status !== 'expired');
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {active.length ? active.map((m) => <Tag key={m.id} label={m.planName} tone="tint" />) : <Tag label="No plan" />}
        {p.balanceCents ? <Tag label={`${money(p.balanceCents)} due`} tone="warning" /> : null}
        {p.waivers.some((w) => w.required && !w.signedAt) ? <Tag label="Waiver unsigned" tone="danger" /> : null}
      </View>
      <Small muted={false}>
        {p.visits30} check-in{p.visits30 === 1 ? '' : 's'} and {p.reservations30} reservation{p.reservations30 === 1 ? '' : 's'} in 30 days
        {p.lastVisit ? ` · last ${dayLabel(dayOf(p.lastVisit, tz))}` : ''}
      </Small>
      <Small>
        {[p.phone, p.birthDate ? `Born ${p.birthDate}` : null, p.gender && p.gender !== 'unspecified' ? p.gender : null, p.zip ? `ZIP ${p.zip}` : null, p.duprDoubles ? `DUPR ${p.duprDoubles}` : null]
          .filter(Boolean)
          .join(' · ') || 'No details yet'}
      </Small>
      {p.family ? <Small>Family: {p.family.name} ({p.family.members.map((m) => m.name.split(' ')[0]).join(', ')})</Small> : null}
      {p.groups.length ? <Small>Groups: {p.groups.map((g) => g.name).join(', ')}</Small> : null}
      {scales.map((s) => {
        const current = p.ratings.find((r) => r.scaleId === s.id)?.value ?? null;
        return (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Small style={{ flex: 1 }}>{s.name}</Small>
            <NumberField
              style={{ width: 110 }}
              label=""
              allowEmpty
              value={current}
              onChange={(v) => {
                if (v == null || (v >= s.min && v <= s.max)) api.rateMember(s.id, userId, v).then(load, (e: Error) => toast(e.message));
              }}
            />
          </View>
        );
      })}
    </View>
  );
}
