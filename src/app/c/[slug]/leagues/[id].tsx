import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { confirm, notice, toast } from '@/components/Dialogs';
import { Banner, Body, Button, Card, Empty, ErrorText, Field, Loading, Page, Row, Segmented, Sheet, Small, Tag } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { dayLabel, dayOf, money, timeOf } from '@/lib/time';

type Tab = 'standings' | 'schedule' | 'board';

/** A league or ladder: standings, the schedule with scores, and the message board. */
export default function LeaguePage() {
  const c = useColors();
  const { club } = useClub();
  const tz = club.timezone;
  const staff = api.isStaff(club.myRole);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<api.LeagueDetail | null>(null);
  const [tab, setTab] = useState<Tab>('standings');
  const [scoring, setScoring] = useState<api.LeagueMatch | null>(null);
  const [joining, setJoining] = useState(false);
  const [post, setPost] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.league(String(id)).then(setD, (e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  if (!d) return <Page>{error ? <ErrorText error={error} /> : <Loading />}</Page>;
  const l = d.league;
  const ladder = l.kind === 'ladder';
  const myRank = d.standings.find((s) => s.entryId === d.myEntryId)?.rank ?? null;
  const toConfirm = d.matches.filter((m) => m.mine && m.status === 'reported' && !m.reportedByMe);

  const generate = async () => {
    if (!(await confirm('Generate the schedule?', `Every ${l.format === 'doubles' ? 'team' : 'player'} plays every other once, a round a week, booked on courts. Unplayed matches are replaced.`, { confirmLabel: 'Generate' }))) return;
    try {
      const r = await api.generateSchedule(l.id);
      await notice('Schedule ready', `${r.rounds} rounds, ${r.matches} matches${r.unbooked ? `; ${r.unbooked} couldn’t get a court and need one` : ', all on courts'}. Players were notified.`);
      setTab('schedule');
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Page>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Tag label={`${ladder ? 'Ladder' : 'League'} · ${l.format === 'doubles' ? 'Doubles' : 'Singles'}`} tone="violet" />
          <Tag label={l.status === 'registration' ? 'Signing up' : l.status === 'active' ? 'In play' : 'Finished'} tone={l.status === 'active' ? 'tint' : 'warning'} />
        </View>
        <Text style={[type.title1, { color: c.label }]}>{l.name}</Text>
        {l.description ? <Body muted>{l.description}</Body> : null}
        <Small>
          Starts {dayLabel(l.startsOn)}
          {l.feeCents ? ` · ${money(l.feeCents)} entry` : ''}
          {ladder ? ` · challenge up to ${l.challengeRange} places above you` : ` · ${l.pointsWin} points a win`}
        </Small>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {!d.myEntryId && l.status !== 'completed' && (ladder || l.status === 'registration') ? <Button title="Sign Up" onPress={() => setJoining(true)} /> : null}
        {staff && !ladder ? <Button kind="secondary" title={d.matches.length ? 'Regenerate Schedule' : 'Generate Schedule'} onPress={generate} /> : null}
        {staff ? <Button kind="plain" title="Add a Player" onPress={() => setJoining(true)} /> : null}
        {d.myEntryId ? (
          <Button
            kind="plain"
            title="Withdraw"
            onPress={async () => {
              if (await confirm('Withdraw?', 'Your unplayed matches are cancelled.', { confirmLabel: 'Withdraw', destructive: true })) api.withdrawLeague(d.myEntryId!).then(load, (e: Error) => toast(e.message));
            }}
          />
        ) : null}
      </View>
      {toConfirm.length ? (
        <Banner tone="warning" icon="checkCircle">
          {toConfirm.length} score{toConfirm.length === 1 ? '' : 's'} to confirm under Schedule.
        </Banner>
      ) : null}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'standings', label: ladder ? 'Ladder' : 'Standings' },
          { value: 'schedule', label: ladder ? 'Challenges' : 'Schedule' },
          { value: 'board', label: `Board${d.posts.length ? ` (${d.posts.length})` : ''}` },
        ]}
      />

      {tab === 'standings' ? (
        <Card padded={false}>
          {d.standings.length === 0 ? <Empty icon="users" title="No one has signed up yet" /> : null}
          {d.standings.map((s, i) => {
            const canChallenge = ladder && myRank != null && s.rank != null && s.rank < myRank && myRank - s.rank <= l.challengeRange;
            return (
              <Row
                key={s.entryId}
                left={
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: i < 3 ? c.tintSoft : c.fill, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[type.subheadline, { color: i < 3 ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>{ladder ? s.rank : i + 1}</Text>
                  </View>
                }
                title={`${s.name}${s.entryId === d.myEntryId ? ' (you)' : ''}`}
                subtitle={`${s.wins}–${s.losses}${s.played ? ` · games ${s.gamesFor}–${s.gamesAgainst}` : ''}${ladder ? '' : ` · ${s.points} pts`}`}
                right={canChallenge ? <Button small title="Challenge" onPress={() => api.challenge(l.id, s.entryId).then(() => { toast('Challenge sent.'); setTab('schedule'); load(); }, (e: Error) => toast(e.message))} /> : undefined}
                last={i === d.standings.length - 1}
              />
            );
          })}
        </Card>
      ) : tab === 'schedule' ? (
        <Card padded={false}>
          {d.matches.length === 0 ? <Empty icon="calendar" title={ladder ? 'No challenges yet' : 'No schedule yet'}>{ladder ? 'Challenge someone from the ladder.' : staff ? 'Generate it once everyone has signed up.' : 'Staff will post it when sign-ups close.'}</Empty> : null}
          {d.matches.map((m, i) => {
            const g = m.scores.reduce((acc, [a, b]) => ({ a: acc.a + (a > b ? 1 : 0), b: acc.b + (b > a ? 1 : 0) }), { a: 0, b: 0 });
            const scoreText = m.scores.length ? m.scores.map(([a, b]) => `${a}–${b}`).join(', ') : null;
            return (
              <Row
                key={m.id}
                title={
                  <Text style={[type.body, { color: c.label }]} numberOfLines={2}>
                    <Text style={{ fontWeight: m.winner === m.entryA ? '700' : '400' }}>{m.nameA}</Text>
                    <Text style={{ color: c.secondaryLabel }}> vs </Text>
                    <Text style={{ fontWeight: m.winner === m.entryB ? '700' : '400' }}>{m.nameB}</Text>
                  </Text>
                }
                subtitle={[
                  m.round ? `Round ${m.round}` : m.challenge ? 'Challenge' : null,
                  m.scheduledAt ? `${dayLabel(dayOf(m.scheduledAt, tz))} ${timeOf(m.scheduledAt, tz)}` : null,
                  m.courtName,
                  scoreText ? `${scoreText} (${g.a}–${g.b})` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  m.status === 'confirmed' ? (
                    <Tag label="Final" tone="tint" />
                  ) : m.status === 'reported' && m.mine && !m.reportedByMe ? (
                    <Button small title="Confirm" onPress={() => api.confirmScore(m.id).then(load, (e: Error) => toast(e.message))} />
                  ) : m.status === 'reported' ? (
                    <Tag label="Waiting to confirm" tone="warning" />
                  ) : m.mine || staff ? (
                    <Button small kind="secondary" title="Enter Score" onPress={() => setScoring(m)} />
                  ) : undefined
                }
                onPress={staff && m.status !== 'scheduled' ? () => setScoring(m) : undefined}
                last={i === d.matches.length - 1}
              />
            );
          })}
        </Card>
      ) : (
        <>
          {d.myEntryId || staff ? (
            <Card style={{ gap: 8 }}>
              <Field value={post} onChangeText={setPost} multiline placeholder="Message everyone in the league: subs, rainouts, see you Tuesday…" maxLength={1000} />
              <Button small title="Post" disabled={!post.trim()} style={{ alignSelf: 'flex-end' }} onPress={() => api.leaguePost(l.id, post).then(() => { setPost(''); load(); }, (e: Error) => toast(e.message))} />
            </Card>
          ) : null}
          <Card padded={false}>
            {d.posts.length === 0 ? <Empty icon="list" title="No messages yet" /> : null}
            {d.posts.map((p, i) => (
              <Row key={p.id} title={p.name} subtitle={`${p.body}\n${dayLabel(dayOf(p.createdAt, tz))} ${timeOf(p.createdAt, tz)}`} last={i === d.posts.length - 1} />
            ))}
          </Card>
        </>
      )}
      {scoring ? <ScoreSheet match={scoring} staff={staff} onClose={() => setScoring(null)} onSaved={() => { setScoring(null); load(); }} /> : null}
      {joining ? <JoinSheet league={l} staff={staff} onClose={() => setJoining(false)} onJoined={() => { setJoining(false); load(); }} /> : null}
    </Page>
  );
}

function ScoreSheet({ match: m, staff, onClose, onSaved }: { match: api.LeagueMatch; staff: boolean; onClose: () => void; onSaved: () => void }) {
  const c = useColors();
  const [games, setGames] = useState<[string, string][]>(m.scores.length ? m.scores.map(([a, b]) => [String(a), String(b)]) : [['', ''], ['', ''], ['', '']]);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const scores = games.filter(([a, b]) => a !== '' && b !== '').map(([a, b]) => [Number(a), Number(b)] as [number, number]);
    api.reportScore(m.id, scores).then(() => {
      toast(staff ? 'Score saved.' : 'Score sent; the other side confirms it.');
      onSaved();
    }, (e: Error) => setError(e.message));
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Enter Score"
      width={460}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} />
        </>
      }
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Small style={{ flex: 1, fontWeight: '600' }}>{m.nameA}</Small>
        <Small style={{ flex: 1, fontWeight: '600', textAlign: 'right' }}>{m.nameB}</Small>
      </View>
      {games.map(([a, b], i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Field style={{ flex: 1 }} value={a} onChangeText={(t) => setGames(games.map((g, j) => (j === i ? [t.replace(/\D/g, ''), g[1]] : g)))} keyboardType="number-pad" placeholder={`Game ${i + 1}`} />
          <Text style={{ color: c.secondaryLabel }}>–</Text>
          <Field style={{ flex: 1 }} value={b} onChangeText={(t) => setGames(games.map((g, j) => (j === i ? [g[0], t.replace(/\D/g, '')] : g)))} keyboardType="number-pad" />
        </View>
      ))}
      <Pressable onPress={() => setGames([...games, ['', '']])}>
        <Small style={{ color: c.tint, fontWeight: '600' }}>+ Another game</Small>
      </Pressable>
      <ErrorText error={error} />
    </Sheet>
  );
}

function JoinSheet({ league: l, staff, onClose, onJoined }: { league: api.LeagueDetail['league']; staff: boolean; onClose: () => void; onJoined: () => void }) {
  const [partner, setPartner] = useState('');
  const [team, setTeam] = useState('');
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Sign Up: ${l.name}`}
      width={460}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button
            title="Sign Up"
            onPress={() =>
              api.joinLeague(l.id, { partnerCode: partner || undefined, teamName: team || undefined, ownerCode: owner || undefined }).then((r) => {
                toast(`${r.name} is in!`);
                onJoined();
              }, (e: Error) => setError(e.message))
            }
          />
        </>
      }
    >
      {staff ? <Field label="Player ID (to add someone else)" value={owner} onChangeText={setOwner} autoCapitalize="characters" /> : null}
      {l.format === 'doubles' ? (
        <>
          <Field label="Partner’s Player ID" value={partner} onChangeText={setPartner} autoCapitalize="characters" hint="Your partner is signed up with you." />
          <Field label="Team Name (optional)" value={team} onChangeText={setTeam} maxLength={40} />
        </>
      ) : null}
      {l.feeCents ? <Small>The {money(l.feeCents)} entry fee goes on your club account.</Small> : null}
      <ErrorText error={error} />
    </Sheet>
  );
}
