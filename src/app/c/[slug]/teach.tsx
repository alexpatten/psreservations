import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { toast } from '@/components/Dialogs';
import { Icon } from '@/components/Icon';
import { Button, Card, DateField, Empty, ErrorText, Field, Heading, Loading, Page, Small, Tag, TimeField } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useLessons } from '@/lib/lessons';
import { type, useColors } from '@/lib/theme';
import { addDays, dayLabel, dayOf, parseHm, relativeDay, timeRange, today, zonedMs } from '@/lib/time';

/** A pro's week: each lesson and clinic date with its players, to take attendance from the court. */
export default function Teaching() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const { data: lessons, reload } = useLessons(club.id);
  const [list, setList] = useState<api.Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const from = zonedMs(today(tz), 0, tz);
    api.myTeaching(club.id, from, from + 8 * 86_400_000).then(setList, (e: Error) => setError(e.message));
  }, [club.id, tz]);
  useEffect(load, [load]);

  const me = lessons?.instructors.find((i) => i.id === lessons.myInstructorId);
  if (lessons && !me) {
    return (
      <Page>
        <Card>
          <Empty icon="users" title="You’re not set up as an instructor here">
            Ask a club admin to add you under Manage › Instructors, linked to your Pickle Spots account.
          </Empty>
        </Card>
      </Page>
    );
  }

  const toggle = async (r: api.Reservation, p: api.Player) => {
    try {
      const next = await api.checkIn(r.id, p.id, !!p.checkedInAt);
      setList((l) => l?.map((x) => (x.id === r.id ? next : x)) ?? null);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const byDay = new Map<string, api.Reservation[]>();
  for (const r of list ?? []) {
    const d = dayOf(r.startsAt, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  return (
    <Page maxWidth={760}>
      <Heading>Your Week{me ? `, ${me.name.split(' ')[0]}` : ''}</Heading>
      <Small>Tap a player to check them in. Attendance shows on their record and in the instructor report.</Small>
      <ErrorText error={error} />
      {list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon="calendar" title="Nothing on your schedule this week" />
        </Card>
      ) : (
        [...byDay.entries()].map(([d, rs]) => (
          <View key={d} style={{ gap: 10 }}>
            <Text style={[type.headline, { color: c.label }]}>{relativeDay(d, tz)}</Text>
            {rs.map((r) => {
              const t = club.types.find((x) => x.id === r.typeId);
              const here = r.players.filter((p) => p.checkedInAt).length;
              return (
                <Card key={r.id} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: t?.color ?? c.tint }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.headline, { color: c.label }]}>{r.title || t?.name}</Text>
                      <Small>
                        {timeRange(r.startsAt, r.endsAt, tz)} · {club.courts.find((x) => x.id === r.courtId)?.name}
                      </Small>
                    </View>
                    <Tag label={`${here}/${r.players.length} here`} tone={here === r.players.length && here > 0 ? 'tint' : 'slate'} />
                  </View>
                  {r.notes ? <Small>“{r.notes}”</Small> : null}
                  {r.players.length === 0 ? <Small>No one registered yet.</Small> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {r.players.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => toggle(r, p)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: p.checkedInAt ? c.tint : c.fill,
                        }}
                      >
                        <Icon name={p.checkedInAt ? 'checkCircle' : 'users'} size={16} color={p.checkedInAt ? c.onTint : c.secondaryLabel} />
                        <Text style={[type.subheadline, { color: p.checkedInAt ? c.onTint : c.label }]}>{p.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Card>
              );
            })}
          </View>
        ))
      )}
      {me ? <TimeOff club={club} instructor={me} onChange={reload} /> : null}
    </Page>
  );
}

/** Pros block off their own time (vacations, tournaments); members can't book lessons then. */
function TimeOff({ club, instructor, onChange }: { club: api.Club; instructor: api.Instructor; onChange: () => void }) {
  const tz = club.timezone;
  const [day, setDay] = useState(today(tz));
  const [until, setUntil] = useState(today(tz));
  const [from, setFrom] = useState('00:00');
  const [to, setTo] = useState('23:59');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    try {
      await api.addTimeOff(instructor.id, zonedMs(day, parseHm(from), tz), zonedMs(until, parseHm(to) + (to === '23:59' ? 1 : 0), tz), reason);
      toast('Time off added.');
      setReason('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Heading>Time Off</Heading>
      <Card style={{ gap: 12 }}>
        {(instructor.timeOff ?? []).map((t) => (
          <Small key={t.id} muted={false}>
            {dayLabel(dayOf(t.startsAt, tz))} – {dayLabel(dayOf(t.endsAt - 1, tz))}
            {t.reason ? ` · ${t.reason}` : ''}
          </Small>
        ))}
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 150 }}>
            <DateField label="From" value={day} onChange={(d) => { setDay(d); if (until < d) setUntil(d); }} />
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <TimeField label="At" value={from} onChange={setFrom} />
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <DateField label="Until" value={until} min={day} max={addDays(day, 366)} onChange={setUntil} />
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <TimeField label="At" value={to} onChange={setTo} />
          </View>
        </View>
        <Field label="Reason (staff see it)" value={reason} onChangeText={setReason} maxLength={120} />
        <ErrorText error={error} />
        <Button small title="Add Time Off" onPress={add} style={{ alignSelf: 'flex-start' }} />
      </Card>
    </>
  );
}
