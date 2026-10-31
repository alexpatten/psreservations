import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { addDays, dayLabel, dayOf, timeOf, today, zonedMs } from '@/lib/time';
import { confirm, toast } from '../Dialogs';
import { Banner, Button, Card, Chip, ChipRow, DateField, Empty, ErrorText, Field, Loading, NumberField, Row, Segmented, Sheet, Small, Tag, Toggle } from '../ui';
import { Pair, SectionHeader } from './Settings';

/** Smart locks: door codes for reservations (or a daily code), doors, the codes issued and the access log. */
export function AccessSection() {
  const { club } = useClub();
  const tz = club.timezone;
  const manager = api.isManager(club.myRole);
  const [s, setS] = useState<api.AccessSettings | null>(null);
  const [door, setDoor] = useState<{ id?: string; name: string; courtIds: string[]; seamDeviceId: string } | null>(null);
  const [tab, setTab] = useState<'codes' | 'log'>('log');
  const [codes, setCodes] = useState<Awaited<ReturnType<typeof api.accessCodes>> | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.accessEvents>> | null>(null);
  const [dailyDay, setDailyDay] = useState(today(tz));
  const [dailyCode, setDailyCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.accessSettings(club.id).then(setS, (e: Error) => setError(e.message));
    const from = zonedMs(addDays(today(tz), -7), 0, tz);
    const to = zonedMs(addDays(today(tz), 8), 0, tz);
    api.accessCodes(club.id, Date.now() - 3_600_000, to).then(setCodes, () => setCodes([]));
    api.accessEvents(club.id, from, Date.now() + 60_000).then(setLog, () => setLog([]));
  }, [club.id, tz]);
  useEffect(load, [load]);
  if (!s) return error ? <ErrorText error={error} /> : <Loading />;

  const save = (p: Parameters<typeof api.saveAccess>[1]) => api.saveAccess(club.id, p).then((x) => { setS(x); toast('Saved.'); }, (e: Error) => toast(e.message));
  const exportLog = () => {
    if (!log || Platform.OS !== 'web') return;
    const rows = [['When', 'Door', 'What', 'Who', 'Code', 'Reservation'], ...log.map((e) => [
      `${dayOf(e.occurredAt, tz)} ${timeOf(e.occurredAt, tz)}`, e.door ?? '', e.kind, e.who ?? '', e.code ?? '',
      e.reservation ? `${e.reservation.courtName} ${timeOf(e.reservation.startsAt, tz)}–${timeOf(e.reservation.endsAt, tz)}` : '',
    ])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `${club.slug}-access-log.csv`;
    a.click();
  };

  return (
    <>
      <SectionHeader title="Access Control">
        Smart-lock door codes so courts open only for confirmed reservations: each reservation gets its own code (valid a little before and after), or one daily code goes to
        everyone with a reservation that day. Locks connect through Seam (Schlage, Yale, August, Kwikset, igloohome and more).
      </SectionHeader>
      {s.failed ? <Banner tone="error" icon="ban">{s.failed} code{s.failed === 1 ? '' : 's'} couldn’t be set on a lock. See Codes.</Banner> : null}
      <Card style={{ gap: 12 }}>
        <Segmented
          value={s.mode}
          onChange={manager ? (m) => save({ mode: m }) : () => {}}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'reservation', label: 'Code per Reservation' },
            { value: 'daily', label: 'Daily Code' },
          ]}
        />
        {s.mode !== 'off' && manager ? (
          <>
            <Pair>
              <NumberField style={{ flex: 1 }} label="Works From" suffix="min before" value={s.minutesBefore} onChange={(v) => setS({ ...s, minutesBefore: v ?? 0 })} />
              <NumberField style={{ flex: 1 }} label="Until" suffix="min after" value={s.minutesAfter} onChange={(v) => setS({ ...s, minutesAfter: v ?? 0 })} />
              <NumberField style={{ flex: 1 }} label="Code Length" suffix="digits" value={s.codeLength} onChange={(v) => setS({ ...s, codeLength: v ?? 4 })} />
            </Pair>
            <Toggle label="Notify Staff on Every Unlock" value={s.notifyStaff} onChange={(v) => save({ notifyStaff: v })} />
            <Button small kind="secondary" title="Save Timing" style={{ alignSelf: 'flex-start' }} onPress={() => save({ minutesBefore: s.minutesBefore, minutesAfter: s.minutesAfter, codeLength: s.codeLength })} />
          </>
        ) : null}
      </Card>

      <SectionHeader title="Doors" action={manager ? <Button small icon="plus" title="Door" onPress={() => setDoor({ name: '', courtIds: [], seamDeviceId: '' })} /> : undefined}>
        A door lets players reach some courts (or all). Add the Seam device ID to have codes set on the lock automatically.
      </SectionHeader>
      <Card padded={false}>
        {s.points.length === 0 ? <Empty icon="ban" title="No doors yet" /> : null}
        {s.points.map((p, i) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle={p.courtIds.length ? club.courts.filter((c) => p.courtIds.includes(c.id)).map((c) => c.name).join(', ') : 'All courts'}
            right={p.seamDeviceId ? <Tag label="Lock connected" tone="tint" /> : <Tag label="Codes set by hand" />}
            onPress={manager ? () => setDoor({ id: p.id, name: p.name, courtIds: p.courtIds, seamDeviceId: p.seamDeviceId ?? '' }) : undefined}
            last={i === s.points.length - 1}
          />
        ))}
      </Card>

      {s.mode === 'daily' ? (
        <Card style={{ gap: 10 }}>
          <Small style={{ fontWeight: '600' }}>DAILY CODE</Small>
          {s.dailyCodes.map((d, i) => (
            <Small key={i} muted={false}>
              {dayLabel(d.day)} · {d.door}: {d.code}
            </Small>
          ))}
          <Pair>
            <View style={{ flex: 1 }}>
              <DateField label="Day" value={dailyDay} min={today(tz)} onChange={setDailyDay} />
            </View>
            <Field style={{ flex: 1 }} label="Code (empty: random)" value={dailyCode} onChangeText={(t) => setDailyCode(t.replace(/\D/g, ''))} keyboardType="number-pad" />
          </Pair>
          <Button small title="Set Code" style={{ alignSelf: 'flex-start' }} onPress={() => api.setDailyCode(club.id, dailyDay, dailyCode).then((x) => { setS(x); setDailyCode(''); }, (e: Error) => toast(e.message))} />
        </Card>
      ) : null}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'log', label: 'Access Log' },
          { value: 'codes', label: 'Codes' },
        ]}
      />
      {tab === 'log' ? (
        <>
          {Platform.OS === 'web' && log?.length ? <Button small kind="secondary" title="Export CSV" style={{ alignSelf: 'flex-start' }} onPress={exportLog} /> : null}
          <Card padded={false}>
            {log === null ? <Loading /> : log.length === 0 ? <Empty icon="ban" title="No unlocks in the last week" /> : null}
            {log?.map((e, i) => (
              <Row
                key={e.id}
                title={`${e.door ?? 'Door'}: ${e.kind === 'denied' ? 'wrong code' : e.who ?? 'unlocked'}`}
                subtitle={`${dayLabel(dayOf(e.occurredAt, tz))} ${timeOf(e.occurredAt, tz)}${e.reservation ? ` · ${e.reservation.courtName} ${timeOf(e.reservation.startsAt, tz)}–${timeOf(e.reservation.endsAt, tz)}` : ''}`}
                right={<Tag label={e.kind === 'denied' ? 'Denied' : 'Unlocked'} tone={e.kind === 'denied' ? 'danger' : 'tint'} />}
                last={i === log.length - 1}
              />
            ))}
          </Card>
        </>
      ) : (
        <Card padded={false}>
          {codes === null ? <Loading /> : codes.length === 0 ? <Empty icon="list" title="No codes this week" /> : null}
          {codes?.map((x, i) => (
            <Row
              key={x.id}
              title={`${x.code} · ${x.door}`}
              subtitle={`${x.who ?? (x.day ? 'Daily code' : '')}${x.courtName ? ` · ${x.courtName}` : ''} · ${dayLabel(dayOf(x.startsAt, tz))} ${timeOf(x.startsAt, tz)}–${timeOf(x.endsAt, tz)}${x.error ? ` · ${x.error}` : ''}`}
              right={<Tag label={x.status === 'active' ? 'On lock' : x.status === 'pending' ? 'Syncing' : x.status === 'failed' ? 'Failed' : 'Revoked'} tone={x.status === 'active' ? 'tint' : x.status === 'failed' ? 'danger' : 'slate'} />}
              last={i === codes.length - 1}
            />
          ))}
        </Card>
      )}

      {door ? (
        <Sheet
          visible
          onClose={() => setDoor(null)}
          title={door.id ? 'Edit Door' : 'New Door'}
          footer={
            <>
              {door.id ? (
                <Button kind="destructiveSoft" title="Remove" onPress={async () => { if (await confirm('Remove this door?', 'Its codes are revoked.', { confirmLabel: 'Remove', destructive: true })) api.deleteAccessPoint(door.id!).then((x) => { setS(x); setDoor(null); }); }} />
              ) : null}
              <Button kind="secondary" title="Cancel" onPress={() => setDoor(null)} />
              <Button title="Save" disabled={!door.name.trim()} onPress={() => api.saveAccessPoint(club.id, door).then((x) => { setS(x); setDoor(null); }, (e: Error) => toast(e.message))} />
            </>
          }
        >
          <Field label="Name" value={door.name} onChangeText={(t) => setDoor({ ...door, name: t })} placeholder="Main Gate" />
          <Small style={{ fontWeight: '600' }}>COURTS IT OPENS (NONE: ALL)</Small>
          <ChipRow>
            {club.courts.map((c) => (
              <Chip key={c.id} small label={c.name} selected={door.courtIds.includes(c.id)} onPress={() => setDoor({ ...door, courtIds: door.courtIds.includes(c.id) ? door.courtIds.filter((x) => x !== c.id) : [...door.courtIds, c.id] })} />
            ))}
          </ChipRow>
          <Field label="Seam Device ID" value={door.seamDeviceId} onChangeText={(t) => setDoor({ ...door, seamDeviceId: t })} autoCapitalize="none" hint="From the Seam console (Devices). Leave empty if staff set codes on the lock by hand." />
        </Sheet>
      ) : null}
    </>
  );
}
