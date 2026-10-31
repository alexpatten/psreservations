import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Logo } from '@/components/AppHeader';
import { Icon, type IconName } from '@/components/Icon';
import { Banner, Button, Card, Chip, ChipRow, Empty, ErrorText, Field, Loading, Small } from '@/components/ui';
import * as api from '@/lib/api';
import { registerAccount, useAuth } from '@/lib/auth';
import { ClubProvider, useClubState } from '@/lib/club-context';
import { conflictAt, maxMinutesFor, minMinutesFor, primeTimesFor, schedulerCourts, slotStarts, visibleSchedulers } from '@/lib/schedule';
import { signUpClient } from '@/lib/supabase';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, dayLabel, dayOf, duration, minutesOf, timeOf, timeRange, today, zonedMs } from '@/lib/time';

/** Back to the start screen after this long without a tap. */
const IDLE_MS = 60_000;

type Step = 'home' | 'checkIn' | 'book' | 'register';

export default function Kiosk() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { status } = useAuth();
  if (status === 'signedOut') return <Redirect href={`/sign-in?next=/kiosk/${slug}`} />;
  return (
    <ClubProvider slug={String(slug)}>
      <KioskScreen />
    </ClubProvider>
  );
}

function KioskScreen() {
  const c = useColors();
  const { club, error } = useClubState();
  const [step, setStep] = useState<Step>('home');
  const [now, setNow] = useState(Date.now());
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastTouch.current > IDLE_MS) setStep('home');
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  if (!club) return error ? <Empty icon="tablet" title={error} /> : <Loading />;
  if (!api.isStaff(club.myRole)) {
    return (
      <Empty icon="ban" title="Kiosk needs a staff account">
        Sign in as a staff member of {club.name} on this device, then open the kiosk again.
      </Empty>
    );
  }
  const tz = club.timezone;

  return (
    <View style={{ flex: 1 }} onTouchStart={() => (lastTouch.current = Date.now())} onPointerDown={() => (lastTouch.current = Date.now())}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.card + 'E6' }}>
        <Pressable onPress={() => setStep('home')}>
          <Logo size={52} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.title1, { color: c.label }]} numberOfLines={1}>
            {club.name}
          </Text>
          <Small>{dayLabel(dayOf(now, tz), { long: true })}</Small>
        </View>
        <Text style={{ fontSize: 34, fontWeight: '700', color: c.label, fontVariant: ['tabular-nums'] }}>{timeOf(now, tz)}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20, maxWidth: 960, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {step === 'home' ? (
          <Home onPick={setStep} />
        ) : (
          <>
            <Button kind="plain" icon="chevronLeft" title="Start Over" onPress={() => setStep('home')} style={{ alignSelf: 'flex-start' }} />
            {step === 'checkIn' ? <CheckIn club={club} onDone={() => setStep('home')} /> : null}
            {step === 'book' ? <Book club={club} onDone={() => setStep('home')} /> : null}
            {step === 'register' ? <Register club={club} onDone={() => setStep('home')} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Home({ onPick }: { onPick: (s: Step) => void }) {
  const tiles: { step: Step; icon: IconName; title: string; body: string }[] = [
    { step: 'checkIn', icon: 'checkCircle', title: 'Check In', body: 'For your reservation today' },
    { step: 'book', icon: 'calendar', title: 'Book a Court', body: 'Walk-up play, starting now' },
    { step: 'register', icon: 'users', title: 'New Player', body: 'Create your free account' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
      {tiles.map((t) => (
        <Tile key={t.step} {...t} onPress={() => onPick(t.step)} />
      ))}
    </View>
  );
}

function Tile({ icon, title, body, onPress }: { icon: IconName; title: string; body: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 260,
        minHeight: 220,
        borderRadius: 24,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.cardBorder,
        padding: 28,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.8 : 1,
        boxShadow: '0 6px 24px rgba(14,42,34,0.1)',
      })}
    >
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={42} color={c.tint} />
      </View>
      <Text style={[type.title1, { color: c.label }]}>{title}</Text>
      <Text style={[type.body, { color: c.secondaryLabel }]}>{body}</Text>
    </Pressable>
  );
}

/** Asks for a Player ID and looks the player up. */
function PlayerLookup({ club, onFound, prompt }: { club: api.Club; onFound: (p: api.KioskPlayer) => void; prompt: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setError(null);
    try {
      onFound(await api.kioskPlayer(club.id, code));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card style={{ gap: 16 }}>
      <Text style={[type.title2, { color: useColors().label }]}>{prompt}</Text>
      <Small>Your Player ID is in the Pickle Spots app under Profile, like K7RM2QXP.</Small>
      <Field value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="PLAYER ID" autoCapitalize="characters" autoFocus onSubmitEditing={find} style={{ maxWidth: 360 }} />
      <ErrorText error={error} />
      <Button title="Continue" onPress={find} disabled={code.trim().length < 6} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}

function CheckIn({ club, onDone }: { club: api.Club; onDone: () => void }) {
  const c = useColors();
  const tz = club.timezone;
  const [player, setPlayer] = useState<api.KioskPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!player) return <PlayerLookup club={club} onFound={setPlayer} prompt="Enter your Player ID" />;

  const checkIn = async (r: api.Reservation) => {
    const me = r.players.find((p) => p.userId === player.userId);
    try {
      await api.checkIn(r.id, me?.id ?? null);
      setDone(`You’re checked in on ${club.courts.find((x) => x.id === r.courtId)?.name}. Have a great game, ${player.name.split(' ')[0]}!`);
      setTimeout(onDone, 6000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (done) {
    return (
      <Card style={{ alignItems: 'center', gap: 14, padding: 40 }}>
        <Icon name="checkCircle" size={72} color={c.tint} />
        <Text style={[type.title2, { color: c.label, textAlign: 'center' }]}>{done}</Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <Text style={[type.title2, { color: c.label }]}>Hi, {player.name}</Text>
      {player.reservations.length === 0 ? (
        <Card style={{ gap: 12, alignItems: 'center' }}>
          <Empty icon="calendar" title="No reservations left today">
            Checking in for open play or a visit? Check in to the club. To play now, go back and tap Book a Court.
          </Empty>
          <Button
            title="Check In to the Club"
            icon="checkCircle"
            onPress={async () => {
              try {
                const r = await api.memberCheckin(club.id, player.playerCode);
                setDone(`Welcome, ${r.name.split(' ')[0]}!${r.unsignedWaivers ? ` Please sign ${r.unsignedWaivers} at the front desk.` : ''}`);
                setTimeout(onDone, 6000);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </Card>
      ) : (
        player.reservations.map((r) => {
          const t = club.types.find((x) => x.id === r.typeId);
          const me = r.players.find((p) => p.userId === player.userId);
          return (
            <Card key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <View style={{ width: 8, alignSelf: 'stretch', borderRadius: 4, backgroundColor: t?.color }} />
              <View style={{ flex: 1, minWidth: 200 }}>
                <Text style={[type.title3, { color: c.label }]}>{r.title || t?.name}</Text>
                <Small>
                  {club.courts.find((x) => x.id === r.courtId)?.name} · {timeRange(r.startsAt, r.endsAt, tz)}
                </Small>
              </View>
              {me?.checkedInAt ? <Banner tone="success">Checked in</Banner> : <Button title="Check In" icon="checkCircle" onPress={() => checkIn(r)} />}
            </Card>
          );
        })
      )}
      <ErrorText error={error} />
    </View>
  );
}

function Book({ club, onDone }: { club: api.Club; onDone: () => void }) {
  const c = useColors();
  const tz = club.timezone;
  const [player, setPlayer] = useState<api.KioskPlayer | null>(null);
  const [schedule, setSchedule] = useState<api.Schedule | null>(null);
  const [choice, setChoice] = useState<{ courtId: string; startMin: number } | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const day = today(tz);
  const scheduler = visibleSchedulers(club).find((s) => s.membersCanBook) ?? club.schedulers[0];
  const type0 = club.types.find((t) => t.membersCanBook) ?? club.types[0];

  const load = useCallback(() => {
    api.schedule(club.id, zonedMs(day, 0, tz), zonedMs(addDays(day, 1), 0, tz)).then(setSchedule, (e: Error) => setError(e.message));
  }, [club.id, day, tz]);
  useEffect(load, [load]);

  // The next few open start times on each bookable court.
  const options = useMemo(() => {
    if (!scheduler || !schedule) return [];
    const nowMin = minutesOf(Date.now(), tz);
    const starts = slotStarts(scheduler).filter((m) => m + scheduler.slotMinutes > nowMin).slice(0, 4);
    return schedulerCourts(club, scheduler)
      .filter((ct) => ct.membersCanBook)
      .map((ct) => ({
        court: ct,
        starts: starts.filter((m) => {
          const s = zonedMs(day, m, tz);
          return !conflictAt(club, schedule, ct.id, s, s + minMinutesFor(club, ct) * 60_000);
        }),
      }));
  }, [club, scheduler, schedule, day, tz]);

  if (!player) return <PlayerLookup club={club} onFound={setPlayer} prompt="Enter your Player ID to book" />;
  if (player.suspendedUntil) {
    return (
      <Banner tone="error" icon="ban">
        Booking is paused for {player.name} until {dayLabel(dayOf(player.suspendedUntil, tz))} because of late cancellations or no-shows. Please see the
        front desk.
      </Banner>
    );
  }
  if (!scheduler || !type0) return <Empty icon="grid" title="No courts are open for booking" />;
  if (!schedule) return <Loading />;

  const court = choice ? club.courts.find((x) => x.id === choice.courtId) : null;
  const lengths: number[] = [];
  if (court && choice) {
    const max = maxMinutesFor(club, court, primeTimesFor(club, court.id, day, choice.startMin, choice.startMin + scheduler.slotMinutes));
    const start = zonedMs(day, choice.startMin, tz);
    for (let m = minMinutesFor(club, court); m <= max; m += scheduler.slotMinutes) {
      if (conflictAt(club, schedule, court.id, start, start + m * 60_000)) break;
      lengths.push(m);
    }
  }

  const book = async () => {
    if (!choice || !court) return;
    setError(null);
    try {
      const startsAt = zonedMs(day, choice.startMin, tz);
      const r = await api.book({ courtId: court.id, typeId: type0.id, startsAt, endsAt: startsAt + minutes * 60_000, ownerCode: player.playerCode });
      // They're here, so they're checked in too.
      await api.checkIn(r.id).catch(() => {});
      setDone(`${court.name} is yours, ${clock(choice.startMin)} – ${clock(choice.startMin + minutes)}. You’re checked in.`);
      setTimeout(onDone, 7000);
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  };

  if (done) {
    return (
      <Card style={{ alignItems: 'center', gap: 14, padding: 40 }}>
        <Icon name="checkCircle" size={72} color={c.tint} />
        <Text style={[type.title2, { color: c.label, textAlign: 'center' }]}>{done}</Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <Text style={[type.title2, { color: c.label }]}>Pick a court, {player.name.split(' ')[0]}</Text>
      {options.every((o) => o.starts.length === 0) ? <Banner tone="warning">Every court is booked for the next couple of hours.</Banner> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {options.map(({ court: ct, starts }) => (
          <Card key={ct.id} style={{ flexBasis: 260, flexGrow: 1, gap: 10 }}>
            <Text style={[type.title3, { color: c.label }]}>{ct.name}</Text>
            {starts.length === 0 ? <Small>Booked for now</Small> : null}
            <ChipRow>
              {starts.map((m) => (
                <Chip
                  key={m}
                  label={clock(m)}
                  selected={choice?.courtId === ct.id && choice.startMin === m}
                  onPress={() => {
                    setChoice({ courtId: ct.id, startMin: m });
                    setMinutes(Math.max(minMinutesFor(club, ct), 60));
                  }}
                />
              ))}
            </ChipRow>
          </Card>
        ))}
      </View>
      {choice && court ? (
        <Card style={{ gap: 12 }}>
          <Text style={[type.headline, { color: c.label }]}>
            {court.name} at {clock(choice.startMin)}: how long?
          </Text>
          <ChipRow>
            {lengths.map((m) => (
              <Chip key={m} label={duration(m)} selected={m === minutes} onPress={() => setMinutes(m)} />
            ))}
          </ChipRow>
          <ErrorText error={error} />
          <Button title={`Book ${court.name}`} onPress={book} disabled={!lengths.includes(minutes)} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : (
        <ErrorText error={error} />
      )}
    </View>
  );
}

function Register({ club, onDone }: { club: api.Club; onDone: () => void }) {
  const c = useColors();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; playerCode: string } | null>(null);

  const submit = async () => {
    setError(null);
    try {
      if (!firstName.trim() || !lastName.trim()) throw new Error('Enter your first and last name.');
      if (password.length < 8) throw new Error('Choose a password of at least 8 characters.');
      // A separate client, so the kiosk stays signed in as staff.
      await registerAccount({ firstName, lastName, email, password }, signUpClient);
      setCreated(await api.addMember(club.id, email));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (created) {
    return (
      <Card style={{ alignItems: 'center', gap: 14, padding: 40 }}>
        <Icon name="checkCircle" size={72} color={c.tint} />
        <Text style={[type.title2, { color: c.label, textAlign: 'center' }]}>Welcome to {club.name}, {created.name.split(' ')[0]}!</Text>
        <Text style={[type.body, { color: c.secondaryLabel, textAlign: 'center' }]}>Your Player ID</Text>
        <Text style={{ fontSize: 44, fontWeight: '800', letterSpacing: 4, color: c.tint }}>{created.playerCode}</Text>
        <Text style={[type.body, { color: c.secondaryLabel, textAlign: 'center', maxWidth: 480 }]}>
          Use it here to book and check in. We emailed a link to {email.trim()}: tap it to finish setting up your account and sign in to Pickle Spots.
        </Text>
        <Button title="Done" onPress={onDone} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      <Text style={[type.title2, { color: c.label }]}>Create your account</Text>
      <Small>One free Pickle Spots account for booking here and finding courts anywhere.</Small>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Field style={{ flex: 1, minWidth: 200 }} label="First Name" value={firstName} onChangeText={setFirstName} />
        <Field style={{ flex: 1, minWidth: 200 }} label="Last Name" value={lastName} onChangeText={setLastName} />
      </View>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" inputMode="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <ErrorText error={error} />
      <Button title="Create Account" onPress={submit} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}
