import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { toast } from '@/components/Dialogs';
import { Button, Card, Chip, ChipRow, DateField, Empty, ErrorText, Field, Heading, Loading, NumberField, Page, Segmented, Sheet, Small, Tag, TimeField, Toggle } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, DAY_NAMES, DAY_SHORT, dayLabel, money, parseHm, today } from '@/lib/time';

const STATUS: Record<api.LeagueSummary['status'], { label: string; tone: 'tint' | 'warning' | 'slate' }> = {
  registration: { label: 'Signing up', tone: 'warning' },
  active: { label: 'In play', tone: 'tint' },
  completed: { label: 'Finished', tone: 'slate' },
};

/** The club's leagues and ladders. */
export default function Leagues() {
  const c = useColors();
  const { club } = useClub();
  const staff = api.isStaff(club.myRole);
  const [list, setList] = useState<api.LeagueSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    api.leagues(club.id).then(setList, () => setList([]));
  }, [club.id]);
  useEffect(load, [load]);

  return (
    <Page>
      <Heading right={staff ? <Button small icon="plus" title="League or Ladder" onPress={() => setCreating(true)} /> : undefined}>Leagues & Ladders</Heading>
      {list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon="star" title="No leagues yet">
            {staff ? 'Start one: players sign up, you generate the schedule, they report scores.' : 'Check back soon.'}
          </Empty>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {list.map((l) => (
            <Card key={l.id} style={{ flexBasis: 300, flexGrow: 1, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Tag label={STATUS[l.status].label} tone={STATUS[l.status].tone} />
                <Tag label={`${l.kind === 'ladder' ? 'Ladder' : 'League'} · ${l.format === 'doubles' ? 'Doubles' : 'Singles'}`} tone="violet" />
                {l.joined ? <Tag label="You're in" tone="teal" /> : null}
              </View>
              <Text style={[type.title3, { color: c.label }]}>{l.name}</Text>
              <Small>
                {l.kind === 'league' && l.dayOfWeek != null ? `${DAY_NAMES[l.dayOfWeek]}s at ${clock(parseHm(l.startTime), true)} · ` : ''}
                Starts {dayLabel(l.startsOn)} · {l.entries}
                {l.maxEntries ? `/${l.maxEntries}` : ''} {l.format === 'doubles' ? 'teams' : 'players'}
                {l.feeCents ? ` · ${money(l.feeCents)}` : ''}
              </Small>
              {l.description ? <Small numberOfLines={2}>{l.description}</Small> : null}
              <Button kind={l.joined ? 'secondary' : 'primary'} title={l.joined ? 'Open' : 'View & Sign Up'} onPress={() => router.push(`/c/${club.slug}/leagues/${l.id}`)} />
            </Card>
          ))}
        </View>
      )}
      {creating ? <NewLeague club={club} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/c/${club.slug}/leagues/${id}`)} /> : null}
    </Page>
  );
}

function NewLeague({ club, onClose, onCreated }: { club: api.Club; onClose: () => void; onCreated: (id: string) => void }) {
  const tz = club.timezone;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'league' | 'ladder'>('league');
  const [format, setFormat] = useState<'singles' | 'doubles'>('doubles');
  const [description, setDescription] = useState('');
  const [startsOn, setStartsOn] = useState(addDays(today(tz), 14));
  const [dayOfWeek, setDayOfWeek] = useState(2);
  const [startTime, setStartTime] = useState('18:00');
  const [matchMinutes, setMatchMinutes] = useState<number | null>(60);
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [fee, setFee] = useState<number | null>(null);
  const [maxEntries, setMaxEntries] = useState<number | null>(null);
  const [challengeRange, setChallengeRange] = useState<number | null>(3);
  const [membersOnly, setMembersOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const create = () =>
    api
      .saveLeague(club.id, {
        name,
        kind,
        format,
        description,
        startsOn,
        dayOfWeek: kind === 'league' ? dayOfWeek : null,
        startTime,
        matchMinutes: matchMinutes ?? 60,
        courtIds,
        feeCents: Math.round((fee ?? 0) * 100),
        maxEntries,
        challengeRange: challengeRange ?? 3,
        membersOnly,
      })
      .then((r) => {
        toast(`${name} created. Players can sign up now.`);
        onCreated(r.id);
      }, (e: Error) => setError(e.message));

  return (
    <Sheet
      visible
      onClose={onClose}
      title="New League or Ladder"
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Create" disabled={!name.trim()} onPress={create} />
        </>
      }
    >
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'league', label: 'League (round robin)' },
          { value: 'ladder', label: 'Ladder (challenges)' },
        ]}
      />
      <Segmented
        value={format}
        onChange={setFormat}
        options={[
          { value: 'doubles', label: 'Doubles' },
          { value: 'singles', label: 'Singles' },
        ]}
      />
      <Field label="Name" value={name} onChangeText={setName} placeholder={kind === 'league' ? 'Fall 3.5 Doubles League' : 'Club Singles Ladder'} />
      <Field label="Description" value={description} onChangeText={setDescription} multiline placeholder="Level, format, rules…" />
      <DateField label="Starts" value={startsOn} min={today(tz)} onChange={setStartsOn} />
      {kind === 'league' ? (
        <>
          <Small style={{ fontWeight: '600' }}>LEAGUE NIGHT</Small>
          <ChipRow>
            {DAY_SHORT.map((d, i) => (
              <Chip key={d} small label={d} selected={dayOfWeek === i} onPress={() => setDayOfWeek(i)} />
            ))}
          </ChipRow>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <TimeField label="First Match" value={startTime} onChange={setStartTime} />
            </View>
            <NumberField style={{ flex: 1 }} label="Match Length" suffix="min" value={matchMinutes} onChange={setMatchMinutes} />
          </View>
          <Small style={{ fontWeight: '600' }}>COURTS (NONE CHOSEN: ANY)</Small>
          <ChipRow>
            {club.courts
              .filter((c) => c.kind === 'court')
              .map((c) => (
                <Chip key={c.id} small label={c.name} selected={courtIds.includes(c.id)} onPress={() => setCourtIds(courtIds.includes(c.id) ? courtIds.filter((x) => x !== c.id) : [...courtIds, c.id])} />
              ))}
          </ChipRow>
        </>
      ) : (
        <NumberField label="Challenge Up To" suffix="places above" value={challengeRange} onChange={setChallengeRange} />
      )}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <NumberField style={{ flex: 1 }} label="Entry Fee" suffix="$" allowEmpty value={fee} onChange={setFee} />
        <NumberField style={{ flex: 1 }} label={format === 'doubles' ? 'Max Teams' : 'Max Players'} allowEmpty value={maxEntries} onChange={setMaxEntries} />
      </View>
      <Toggle label="Members Only" value={membersOnly} onChange={setMembersOnly} />
      <ErrorText error={error} />
    </Sheet>
  );
}
