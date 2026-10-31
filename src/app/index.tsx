import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppHeader, Logo } from '@/components/AppHeader';
import { ClubBadge } from '@/components/ClubBadge';
import { Icon, type IconName } from '@/components/Icon';
import { ReservationCard } from '@/components/ReservationCard';
import { Body, Button, Card, Empty, ErrorText, Field, Heading, Loading, Page, Row, Small, Tag, Title, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type, useColors } from '@/lib/theme';

export default function Home() {
  const { status } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <AppHeader />
      {status === 'loading' ? <Loading /> : status === 'signedOut' ? <Welcome /> : <Dashboard />}
    </View>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'clock', title: 'Prime Time Intervals', body: 'Limit how long and how often members book your busiest hours, so everyone gets a turn.' },
  { icon: 'scale', title: 'Rules & Restrictions', body: 'How far ahead, how long, how many at once: set the rules once and the scheduler enforces them.' },
  { icon: 'calendar', title: 'Custom Schedulers', body: 'Different courts on different hours and slot lengths, each in its own view.' },
  { icon: 'checkCircle', title: 'Check-in Players', body: 'Check players in as they arrive and track attendance from the court.' },
  { icon: 'xCircle', title: 'Cancellation Penalties', body: 'Late cancellations and no-shows become strikes, and repeat offenders pause their booking.' },
  { icon: 'tv', title: 'Lobby View', body: 'A big-screen board of court availability and what’s coming up, for players as they walk in.' },
  { icon: 'repeat', title: 'Recurring Reservations', body: 'Weekly and seasonal bookings in a few taps, skipping dates that are already taken.' },
  { icon: 'grid', title: 'Combo Courts', body: 'Split a tennis court into two pickleball courts. Booking one blocks the other.' },
  { icon: 'tablet', title: 'Kiosks', body: 'Walk-up check-in, booking and new-account registration stations.' },
  { icon: 'ban', title: 'Closures', body: 'Rain? Close the courts and cancel what’s booked with one click.' },
  { icon: 'machine', title: 'Ball Machines', body: 'Book ball machines like courts, each with its own rules.' },
  { icon: 'move', title: 'Drag & Drop', body: 'Staff move reservations between courts and times by dragging them.' },
];

function Welcome() {
  const c = useColors();
  const wide = useWide();
  return (
    <Page>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 32, alignItems: wide ? 'center' : 'stretch', paddingVertical: wide ? 48 : 16 }}>
        <View style={{ flex: 1, gap: 18 }}>
          <Text style={[type.footnote, { color: c.tint, fontWeight: '700', letterSpacing: 1 }]}>COURT RESERVATIONS</Text>
          <Text style={{ fontSize: wide ? 56 : 38, lineHeight: wide ? 60 : 42, fontWeight: '800', color: c.label, letterSpacing: -1 }}>
            Reserving courts should be easy
          </Text>
          <Text style={[type.title3, { color: c.secondaryLabel, fontWeight: '400', lineHeight: 28 }]}>
            Book courts at your club in a couple of taps. Clubs get a drag-and-drop scheduler with their own colors, categories,
            rules and custom fields. Sign in with your Pickle Spots account.
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Button title="Sign In" onPress={() => router.push('/sign-in')} icon="chevronRight" />
            <Button title="Create an Account" kind="secondary" onPress={() => router.push('/sign-in?mode=register')} />
          </View>
        </View>
        <SchedulePreview />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {FEATURES.map((f) => (
          <Card key={f.title} style={{ flexBasis: wide ? '31%' : '100%', flexGrow: 1, gap: 8 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={f.icon} color={c.tint} size={22} />
            </View>
            <Text style={[type.headline, { color: c.label }]}>{f.title}</Text>
            <Small>{f.body}</Small>
          </Card>
        ))}
      </View>
    </Page>
  );
}

/** A picture of the scheduler for the welcome page. */
function SchedulePreview() {
  const c = useColors();
  const blocks = [
    { col: 0, row: 1, h: 2, color: '#F2711C', label: 'Private Lesson' },
    { col: 1, row: 3, h: 2, color: '#2F6BFF', label: 'Serve Clinic' },
    { col: 2, row: 0, h: 3, color: '#0A8754', label: 'Doubles' },
    { col: 3, row: 2, h: 1, color: '#6A4FC8', label: 'Ball Machine' },
  ];
  return (
    <Card style={{ flex: 1, maxWidth: 520, alignSelf: 'center', width: '100%' }} padded={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: c.cardBorder }}>
        <Logo size={28} />
        <Text style={[type.headline, { color: c.label, flex: 1 }]}>Today</Text>
        <Tag label="4 courts" tone="teal" />
      </View>
      <View style={{ flexDirection: 'row', height: 260, padding: 10, gap: 6 }}>
        {[0, 1, 2, 3].map((col) => (
          <View key={col} style={{ flex: 1, backgroundColor: c.background, borderRadius: 8 }}>
            {blocks
              .filter((b) => b.col === col)
              .map((b) => (
                <View
                  key={b.label}
                  style={{ position: 'absolute', left: 3, right: 3, top: b.row * 48 + 4, height: b.h * 48 - 6, borderRadius: 8, backgroundColor: b.color, padding: 6 }}
                >
                  <Text style={[type.caption, { color: '#fff', fontWeight: '700' }]} numberOfLines={2}>
                    {b.label}
                  </Text>
                </View>
              ))}
          </View>
        ))}
      </View>
    </Card>
  );
}

function Dashboard() {
  const wide = useWide();
  const { profile } = useAuth();
  const [clubs, setClubs] = useState<api.ClubSummary[] | null>(null);
  const [upcoming, setUpcoming] = useState<api.MyReservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.myClubs(), api.myReservations()])
      .then(([cl, up]) => {
        setClubs(cl);
        setUpcoming(up);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);

  return (
    <Page>
      <Title>{profile ? `Hi, ${profile.firstName}` : 'Welcome'}</Title>
      <ErrorText error={error} />
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 3 : undefined, gap: 12, width: '100%' }}>
          <Heading>Upcoming Reservations</Heading>
          {upcoming === null ? (
            <Loading />
          ) : upcoming.length === 0 ? (
            <Card>
              <Empty icon="calendar" title="No upcoming reservations">
                Pick one of your clubs to book a court.
              </Empty>
            </Card>
          ) : (
            upcoming.map((r) => <ReservationCard key={r.id} reservation={r} onChange={load} showClub />)
          )}
        </View>
        <View style={{ flex: wide ? 2 : undefined, gap: 12, width: '100%' }}>
          <Heading right={<Button small kind="plain" icon="plus" title="New Club" onPress={() => router.push('/new-club')} />}>My Clubs</Heading>
          <Card padded={false}>
            {clubs === null ? (
              <Loading />
            ) : clubs.length === 0 ? (
              <Empty icon="ball" title="You haven't joined a club yet">
                Find your club below, or create one if you run courts.
              </Empty>
            ) : (
              clubs.map((club, i) => (
                <Row
                  key={club.id}
                  title={club.name}
                  subtitle={club.address ?? undefined}
                  left={<ClubBadge name={club.name} />}
                  right={api.isStaff(club.role) ? <Tag label={capitalize(club.role ?? '')} tone="violet" /> : undefined}
                  onPress={() => router.push(`/c/${club.slug}`)}
                  last={i === clubs.length - 1}
                />
              ))
            )}
          </Card>
          <FindClub />
        </View>
      </View>
    </Page>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function FindClub() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<api.ClubSummary[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.findClubs(query).then(setResults, () => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <Card style={{ gap: 12 }}>
      <Body style={type.headline}>Find a Club</Body>
      <Field placeholder="Search by name or city" value={query} onChangeText={setQuery} autoCapitalize="none" />
      {results?.length === 0 ? <Small>No clubs match “{query}”.</Small> : null}
      {results?.slice(0, 8).map((club) => (
        <Link key={club.id} href={`/c/${club.slug}`} asChild>
          <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ClubBadge name={club.name} size={28} />
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1}>{club.name}</Body>
              {club.address ? <Small numberOfLines={1}>{club.address}</Small> : null}
            </View>
            {club.role ? <Tag label="Joined" tone="tint" /> : null}
          </Pressable>
        </Link>
      ))}
    </Card>
  );
}
