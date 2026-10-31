import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useColors } from '@/lib/theme';
import { addDays, dayLabel, dayOf, hm, minutesOf, money, parseHm, timeOf, today, zonedMs } from '@/lib/time';
import { confirm, toast } from '../Dialogs';
import { Icon } from '../Icon';
import { Banner, Button, Card, Chip, ChipRow, DateField, Empty, ErrorText, Field, Loading, Row, Segmented, Sheet, Small, Tag, TimeField, Toggle } from '../ui';
import { MemberProfileView } from './Memberships';
import { Pair, PenaltyRules, SectionHeader } from './Settings';

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

export function ClosuresSection() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const [list, setList] = useState<api.Closure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.closures(club.id).then(setList, (e: Error) => setError(e.message));
  }, [club.id]);
  useEffect(load, [load]);

  const closeToday = async () => {
    const ok = await confirm(
      'Close all courts for the rest of today?',
      'Reservations from now until midnight are cancelled without penalty. Players see the closure on the schedule.',
      { confirmLabel: 'Close Courts', destructive: true },
    );
    if (!ok) return;
    try {
      const result = await api.createClosure(club.id, [], Date.now(), zonedMs(addDays(today(tz), 1), 0, tz), 'Weather', true);
      toast(`Courts closed. ${result.cancelled} reservation${result.cancelled === 1 ? '' : 's'} cancelled.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const courtNames = (ids: string[]) => (ids.length === 0 ? 'All courts' : club.courts.filter((x) => ids.includes(x.id)).map((x) => x.name).join(', '));
  const when = (x: api.Closure) => {
    const d1 = dayOf(x.startsAt, tz);
    const d2 = dayOf(x.endsAt - 1, tz);
    return d1 === d2 ? `${dayLabel(d1)}, ${timeOf(x.startsAt, tz)} – ${timeOf(x.endsAt, tz)}` : `${dayLabel(d1)} ${timeOf(x.startsAt, tz)} – ${dayLabel(d2)} ${timeOf(x.endsAt, tz)}`;
  };

  return (
    <>
      <SectionHeader title="Closures" action={<Button small icon="plus" title="Closure" onPress={() => setAdding(true)} />}>
        Close courts for weather, maintenance or events. Closed times can’t be booked.
      </SectionHeader>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.slateFill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cloud" size={24} color={c.slateText} />
        </View>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Small muted={false} style={{ fontWeight: '600' }}>
            Rained out?
          </Small>
          <Small>Close every court for the rest of today and cancel what’s booked, in one click.</Small>
        </View>
        <Button kind="destructive" icon="ban" title="Close for Weather" onPress={closeToday} />
      </Card>
      <ErrorText error={error} />
      <Card padded={false}>
        {list === null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="checkCircle" title="No upcoming closures" />
        ) : (
          list.map((x, i) => (
            <Row
              key={x.id}
              left={<Icon name="ban" color={c.slateText} />}
              title={x.reason || 'Closed'}
              subtitle={`${when(x)} · ${courtNames(x.courtIds)}`}
              right={
                <Button
                  small
                  kind="plain"
                  title="Reopen"
                  onPress={async () => {
                    try {
                      await api.deleteClosure(x.id);
                      toast('Closure removed. Cancelled reservations stay cancelled.');
                      load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              }
              last={i === list.length - 1}
            />
          ))
        )}
      </Card>
      {adding ? (
        <ClosureEditor
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function ClosureEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { club } = useClub();
  const tz = club.timezone;
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [fromDay, setFromDay] = useState(today(tz));
  const [fromTime, setFromTime] = useState(hm(Math.ceil(minutesOf(Date.now(), tz) / 30) * 30 % 1440));
  const [toDay, setToDay] = useState(today(tz));
  const [toTime, setToTime] = useState('22:00');
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      const result = await api.createClosure(club.id, courtIds, zonedMs(fromDay, parseHm(fromTime), tz), zonedMs(toDay, parseHm(toTime), tz), reason, cancel);
      toast(`Closure added${cancel ? `; ${result.cancelled} reservation${result.cancelled === 1 ? '' : 's'} cancelled` : ''}.`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="New Closure"
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button kind="destructive" title="Close Courts" onPress={save} />
        </>
      }
    >
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>COURTS</Small>
        <ChipRow>
          <Chip small label="All Courts" selected={courtIds.length === 0} onPress={() => setCourtIds([])} />
          {club.courts.map((ct) => (
            <Chip
              key={ct.id}
              small
              label={ct.name}
              selected={courtIds.includes(ct.id)}
              onPress={() => setCourtIds(courtIds.includes(ct.id) ? courtIds.filter((x) => x !== ct.id) : [...courtIds, ct.id])}
            />
          ))}
        </ChipRow>
      </View>
      <Pair>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={fromDay} onChange={(d) => { setFromDay(d); if (toDay < d) setToDay(d); }} />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField label="At" value={fromTime} onChange={setFromTime} />
        </View>
      </Pair>
      <Pair>
        <View style={{ flex: 1 }}>
          <DateField label="Until" value={toDay} min={fromDay} onChange={setToDay} />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField label="At" value={toTime} onChange={setToTime} />
        </View>
      </Pair>
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Resurfacing, rain, tournament…" maxLength={120} />
      <Toggle label="Cancel Reservations Then" hint="Without penalty. Off: they stay, but nothing new can be booked." value={cancel} onChange={setCancel} />
      <ErrorText error={error} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const ROLES: { value: api.Role; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

export function MembersSection() {
  const { club, reload } = useClub();
  const tz = club.timezone;
  const [query, setQuery] = useState('');
  const [list, setList] = useState<api.Member[] | null>(null);
  const [who, setWho] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<api.Member | null>(null);

  const load = useCallback(() => {
    api.members(club.id, query).then(setList, (e: Error) => setError(e.message));
  }, [club.id, query]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const add = async () => {
    setError(null);
    try {
      const m = await api.addMember(club.id, who);
      toast(`${m.name} added.`);
      setWho('');
      load();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <SectionHeader title="Members">
        {club.memberCount} member{club.memberCount === 1 ? '' : 's'}. Players join from the club’s page, or add them here by Pickle Spots Player ID or
        email.
      </SectionHeader>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field style={{ flex: 1 }} placeholder="Player ID or email" value={who} onChangeText={setWho} autoCapitalize="none" onSubmitEditing={add} />
        <Button icon="plus" title="Add" onPress={add} disabled={!who.trim()} />
      </View>
      <ErrorText error={error} />
      <Field placeholder="Search by name, email or Player ID" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <Card padded={false}>
        {list === null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="users" title="No members found" />
        ) : (
          list.map((m, i) => (
            <Row
              key={m.userId}
              title={m.name}
              subtitle={`${m.email ?? ''} · ${m.playerCode}${m.strikes ? ` · ${m.strikes} strike${m.strikes === 1 ? '' : 's'}` : ''}${m.suspendedUntil ? ` · paused until ${dayLabel(dayOf(m.suspendedUntil, tz))}` : ''}`}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {m.suspendedUntil ? <Tag label="Paused" tone="danger" /> : null}
                  {m.role !== 'member' ? <Tag label={ROLES.find((r) => r.value === m.role)?.label ?? m.role} tone="violet" /> : null}
                </View>
              }
              onPress={() => setSelected(m)}
              last={i === list.length - 1}
            />
          ))
        )}
      </Card>
      {selected ? (
        <MemberSheet
          member={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function MemberSheet({ member: m, onClose, onChanged }: { member: api.Member; onClose: () => void; onChanged: () => void }) {
  const { club } = useClub();
  const tz = club.timezone;
  const manager = api.isManager(club.myRole);
  const [role, setRole] = useState(m.role);
  const [strikes, setStrikes] = useState<api.Strike[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStrikes = useCallback(() => {
    api.strikes(club.id, m.userId).then(setStrikes, (e: Error) => setError(e.message));
  }, [club.id, m.userId]);
  useEffect(loadStrikes, [loadStrikes]);

  const changeRole = async (next: api.Role) => {
    setError(null);
    try {
      await api.setMemberRole(club.id, m.userId, next);
      setRole(next);
      toast(`${m.name} is now ${next === 'admin' ? 'an admin' : `a ${next}`}.`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!(await confirm(`Remove ${m.name}?`, 'Their upcoming reservations here are cancelled without penalty.', { confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await api.removeMember(club.id, m.userId);
      toast(`${m.name} removed.`);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={m.name} footer={<>{role !== 'owner' ? <Button kind="destructiveSoft" title="Remove from Club" onPress={remove} /> : null}<Button title="Done" onPress={onClose} /></>}>
      <Small>
        {m.email} · Player ID {m.playerCode} · joined {dayLabel(dayOf(m.joinedAt, tz))}
      </Small>
      <MemberProfileView clubId={club.id} userId={m.userId} tz={tz} />
      {m.suspendedUntil ? (
        <Banner tone="error" icon="ban">
          Booking paused until {dayLabel(dayOf(m.suspendedUntil, tz))}. Waive a strike to lift it.
        </Banner>
      ) : null}
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>ROLE</Small>
        {manager ? <Segmented value={role} options={ROLES} onChange={changeRole} /> : <Tag label={ROLES.find((r) => r.value === role)?.label ?? role} tone="violet" />}
        <Small>Staff run the desk: book for anyone, move reservations, check in, close courts. Admins also change settings. Owners manage admins.</Small>
      </View>
      <View style={{ gap: 8 }}>
        <Small style={{ fontWeight: '600' }}>STRIKES</Small>
        {strikes === null ? <Loading /> : strikes.length === 0 ? <Small>None.</Small> : null}
        {strikes?.map((s) => (
          <StrikeRow
            key={s.id}
            strike={s}
            tz={tz}
            onChanged={() => {
              loadStrikes();
              onChanged();
            }}
          />
        ))}
      </View>
      <ErrorText error={error} />
    </Sheet>
  );
}

function StrikeRow({ strike: s, tz, onChanged, showName }: { strike: api.Strike; tz: string; onChanged: () => void; showName?: boolean }) {
  const toggle = async () => {
    try {
      await api.waiveStrike(s.id, !!s.waivedAt);
      toast(s.waivedAt ? 'Strike restored.' : 'Strike waived.');
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <Row
      title={`${showName ? `${s.name}: ` : ''}${s.kind === 'late_cancel' ? 'Late cancellation' : 'No-show'}`}
      subtitle={[s.courtName, s.reservationStartsAt ? `${dayLabel(dayOf(s.reservationStartsAt, tz))} ${timeOf(s.reservationStartsAt, tz)}` : null, s.feeCents ? money(s.feeCents) : null]
        .filter(Boolean)
        .join(' · ')}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {s.waivedAt ? <Tag label="Waived" tone="tint" /> : null}
          <Button small kind={s.waivedAt ? 'plain' : 'secondary'} title={s.waivedAt ? 'Restore' : 'Waive'} onPress={toggle} />
        </View>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Cancellation penalties
// ---------------------------------------------------------------------------

export function StrikesSection() {
  const { club } = useClub();
  const [list, setList] = useState<api.Strike[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.strikes(club.id).then(setList, (e: Error) => setError(e.message));
  }, [club.id]);
  useEffect(load, [load]);
  const r = club.rules;

  return (
    <>
      <SectionHeader title="Cancellation Penalties">
        Late cancellations (less than {r.cancelCutoffHours} hours ahead) and no-shows are strikes.{' '}
        {r.strikeLimit > 0 ? `${r.strikeLimit} strikes in ${r.strikeWindowDays} days pause a member’s booking for ${r.suspensionDays} days.` : 'Strikes don’t pause booking.'} Mark
        no-shows from a reservation once it starts.
      </SectionHeader>
      {api.isManager(club.myRole) ? <PenaltyRules /> : null}
      <ErrorText error={error} />
      <Card padded={false}>
        {list === null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="checkCircle" title="No strikes yet" />
        ) : (
          list.map((s) => <StrikeRow key={s.id} strike={s} tz={club.timezone} onChanged={load} showName />)
        )}
      </Card>
    </>
  );
}
