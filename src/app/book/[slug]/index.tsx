import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { Logo } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { PublicHeader } from '@/components/PublicHeader';
import { Banner, Button, Card, Chip, ChipRow, Empty, ErrorText, Field, Loading, Page, Small } from '@/components/ui';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type, useColors } from '@/lib/theme';
import { addDays, clock, DAY_SHORT, dayLabel, duration, minutesOf, money, timeOf, today, weekday } from '@/lib/time';

const SPORTS: Record<string, string> = { pickleball: 'Pickleball', tennis: 'Tennis', padel: 'Padel', other: 'Court' };

/** The phone verification lasts 2 hours on the server; remember it for this tab meanwhile. */
const VERIFIED_KEY = 'public-booking-verified';
function rememberVerified(v: { verification: string; phone: string } | null) {
  try {
    if (v) sessionStorage.setItem(VERIFIED_KEY, JSON.stringify({ ...v, at: Date.now() }));
    else sessionStorage.removeItem(VERIFIED_KEY);
  } catch {}
}
function recallVerified(): { verification: string; phone: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VERIFIED_KEY) ?? 'null');
    return v && Date.now() - v.at < 100 * 60_000 ? v : null;
  } catch {
    return null;
  }
}

/**
 * The public booking page: anyone can book a court here, no account needed. Pick the sport,
 * type, players, length and time; verify your phone by text; pay on Stripe; done.
 */
export default function PublicBook() {
  const { slug, released } = useLocalSearchParams<{ slug: string; released?: string }>();
  const { profile } = useAuth();
  const [club, setClub] = useState<api.PublicClub | null | undefined>(undefined);

  useEffect(() => {
    api.publicClub(String(slug)).then(setClub, () => setClub(null));
  }, [slug]);

  // Came back from Stripe without paying: let the court go right away.
  const releasedOnce = useRef(false);
  useEffect(() => {
    if (typeof released === 'string' && !releasedOnce.current) {
      releasedOnce.current = true;
      api.releasePublic(released).catch(() => {});
    }
  }, [released]);

  if (club === undefined) return <Loading />;
  if (club === null) {
    return (
      <Page maxWidth={560}>
        <View style={{ alignItems: 'center', paddingTop: 48, gap: 12 }}>
          <Logo size={64} />
          <Empty icon="calendar" title="Online booking isn’t available here">
            This club isn’t taking public bookings right now. Check the link, or contact the club.
          </Empty>
        </View>
      </Page>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <PublicHeader name={club.name} address={club.address} />
      <BookingFlow club={club} released={typeof released === 'string'} initialName={profile ? [profile.firstName, profile.lastName] : null} />
    </View>
  );
}

function BookingFlow({ club, released, initialName }: { club: api.PublicClub; released: boolean; initialName: [string, string] | null }) {
  const c = useColors();
  const tz = club.timezone;
  const [sport, setSport] = useState(club.sports[0] ?? 'pickleball');
  const [typeId, setTypeId] = useState(club.types[0]?.id);
  const rtype = club.types.find((t) => t.id === typeId);
  const [players, setPlayers] = useState(Math.min(Math.max(rtype?.minPlayers ?? 1, 2), rtype?.maxPlayers ?? 4));
  const lengths = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.max(club.minMinutes, club.slotMinutes); m <= Math.min(club.maxMinutes, 240); m += club.slotMinutes) out.push(m);
    return out;
  }, [club]);
  const [minutes, setMinutes] = useState(lengths.includes(60) ? 60 : lengths[0]);
  const days = useMemo(() => Array.from({ length: club.advanceDays + 1 }, (_, i) => addDays(today(tz), i)), [club.advanceDays, tz]);
  const [day, setDay] = useState(days[0]);
  const [times, setTimes] = useState<{ startsAt: number; courts: number }[] | null>(null);
  const [startsAt, setStartsAt] = useState<number | null>(null);

  const [firstName, setFirstName] = useState(initialName?.[0] ?? '');
  const [lastName, setLastName] = useState(initialName?.[1] ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(recallVerified);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rtype) setPlayers((p) => Math.min(Math.max(p, rtype.minPlayers), rtype.maxPlayers));
  }, [rtype]);

  useEffect(() => {
    setTimes(null);
    setStartsAt(null);
    api.publicAvailability(club.slug, day, sport, minutes).then(setTimes, (e: Error) => {
      setTimes([]);
      setError(e.message);
    });
  }, [club.slug, day, sport, minutes]);

  const price = rtype ? Math.round((rtype.priceCents * minutes) / 60) : 0;

  const sendCode = async () => {
    setError(null);
    try {
      await api.sendPublicCode(club.slug, phone);
      setCodeSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const checkCode = async () => {
    setError(null);
    try {
      const v = await api.checkPublicCode(club.slug, phone, code);
      setVerified(v);
      rememberVerified(v);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const book = async () => {
    if (!verified || !rtype || !startsAt) return;
    setError(null);
    try {
      const result = await api.bookPublic({
        slug: club.slug,
        verification: verified.verification,
        typeId: rtype.id,
        sport,
        startsAt,
        minutes,
        players,
        firstName,
        lastName,
        email,
      });
      if (result.checkoutUrl && Platform.OS === 'web') window.location.assign(result.checkoutUrl);
      else router.replace(`/book/${club.slug}/r/${result.token}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/verify your phone/i.test(msg)) {
        setVerified(null);
        rememberVerified(null);
      }
      setError(msg);
      // Someone may have just taken the time: show what's free now.
      api.publicAvailability(club.slug, day, sport, minutes).then(setTimes, () => {});
    }
  };

  if (club.types.length === 0 || club.sports.length === 0) {
    return (
      <Page maxWidth={640}>
        <Empty icon="calendar" title="Nothing to book online yet">
          Check back soon, or contact {club.name}.
        </Empty>
      </Page>
    );
  }

  const ready = !!startsAt && !!rtype && firstName.trim() && lastName.trim();
  const morning = times?.filter((t) => minutesOf(t.startsAt, tz) < 12 * 60) ?? [];
  const afternoon = times?.filter((t) => minutesOf(t.startsAt, tz) >= 12 * 60 && minutesOf(t.startsAt, tz) < 17 * 60) ?? [];
  const evening = times?.filter((t) => minutesOf(t.startsAt, tz) >= 17 * 60) ?? [];

  return (
    <Page maxWidth={640}>
      <View style={{ gap: 4, paddingTop: 8 }}>
        <Text style={[type.title1, { color: c.label }]}>Let’s get started</Text>
        <Small>Book your court in just a few steps. No account needed.</Small>
      </View>
      {released ? (
        <Banner tone="info" icon="clock">
          No problem: your time wasn’t booked and nothing was charged. Pick a time to try again.
        </Banner>
      ) : null}

      <Card style={{ gap: 18 }}>
        {club.sports.length > 1 ? (
          <Step label="Court Type">
            <ChipRow>
              {club.sports.map((s) => (
                <Chip key={s} label={SPORTS[s] ?? s} selected={s === sport} onPress={() => setSport(s)} />
              ))}
            </ChipRow>
          </Step>
        ) : null}
        <Step label="Reservation Type">
          <ChipRow>
            {club.types.map((t) => (
              <Chip
                key={t.id}
                label={t.priceCents ? `${t.name} · ${money(t.priceCents)}/hr` : t.name}
                color={t.color}
                selected={t.id === typeId}
                onPress={() => setTypeId(t.id)}
              />
            ))}
          </ChipRow>
        </Step>
        {rtype && rtype.maxPlayers > 1 ? (
          <Step label="Number of Players">
            <ChipRow>
              {Array.from({ length: rtype.maxPlayers - rtype.minPlayers + 1 }, (_, i) => rtype.minPlayers + i).map((n) => (
                <Chip key={n} label={String(n)} selected={n === players} onPress={() => setPlayers(n)} />
              ))}
            </ChipRow>
          </Step>
        ) : null}
        <Step label="Duration">
          <ChipRow>
            {lengths.map((m) => (
              <Chip key={m} label={duration(m)} selected={m === minutes} onPress={() => setMinutes(m)} />
            ))}
          </ChipRow>
        </Step>
        <Step label="Date">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map((d, i) => (
              <Chip key={d} label={i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DAY_SHORT[weekday(d)]} ${Number(d.slice(8))}`} selected={d === day} onPress={() => setDay(d)} />
            ))}
          </ScrollView>
        </Step>
        <Step label={`Time · ${dayLabel(day, { long: true })}`}>
          {times === null ? (
            <Loading />
          ) : times.length === 0 ? (
            <Small>No courts are free for {duration(minutes)} that day. Try a shorter time or another day.</Small>
          ) : (
            [
              ['Morning', morning],
              ['Afternoon', afternoon],
              ['Evening', evening],
            ].map(([label, list]) =>
              (list as typeof times).length ? (
                <View key={label as string} style={{ gap: 6 }}>
                  <Small>{label as string}</Small>
                  <ChipRow>
                    {(list as typeof times).map((t) => (
                      <Chip key={t.startsAt} label={timeOf(t.startsAt, tz)} selected={t.startsAt === startsAt} onPress={() => setStartsAt(t.startsAt)} />
                    ))}
                  </ChipRow>
                </View>
              ) : null,
            )
          )}
        </Step>
      </Card>

      {startsAt ? (
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: rtype?.color }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: c.label }]}>
                {SPORTS[sport]} · {rtype?.name}
              </Text>
              <Small>
                {dayLabel(day)}, {clock(minutesOf(startsAt, tz))} – {clock(minutesOf(startsAt, tz) + minutes)} · {players} player{players === 1 ? '' : 's'}
              </Small>
            </View>
            <Text style={[type.title3, { color: c.label }]}>{price ? money(price) : 'Free'}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Field style={{ flex: 1 }} label="First Name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
            <Field style={{ flex: 1 }} label="Last Name" value={lastName} onChangeText={setLastName} autoComplete="family-name" />
          </View>
          <Field label="Email (for your receipt)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" inputMode="email" autoComplete="email" />

          {verified ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="checkCircle" size={18} color={c.tint} />
              <Small muted={false}>Phone verified: {verified.phone}</Small>
              <Button
                small
                kind="plain"
                title="Change"
                onPress={() => {
                  setVerified(null);
                  rememberVerified(null);
                  setCodeSent(false);
                }}
              />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <Field style={{ flex: 1 }} label="Mobile Number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" inputMode="tel" autoComplete="tel" placeholder="(512) 555-0100" />
                <Button kind={codeSent ? 'secondary' : 'primary'} title={codeSent ? 'Resend' : 'Text Me a Code'} onPress={sendCode} disabled={phone.replace(/\D/g, '').length < 10} />
              </View>
              <Small>We text a code to confirm it’s you, then send your confirmation and any updates by text.</Small>
              {codeSent ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                  <Field style={{ flex: 1 }} label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" onSubmitEditing={checkCode} />
                  <Button title="Verify" onPress={checkCode} disabled={code.replace(/\D/g, '').length < 4} />
                </View>
              ) : null}
            </View>
          )}

          <ErrorText error={error} />
          <Button
            title={price ? `Continue to Payment · ${money(price)}` : 'Book Court'}
            icon={price ? 'dollar' : 'check'}
            onPress={book}
            disabled={!ready || !verified}
          />
          <Small style={{ textAlign: 'center' }}>
            {price ? 'You’ll pay securely with a card, Apple Pay or Google Pay. We hold your court for 15 minutes while you pay. ' : ''}
            {club.cancelCutoffHours > 0
              ? `Cancel at least ${club.cancelCutoffHours} hours ahead for a full refund.`
              : 'Cancel any time before your booking for a full refund.'}
          </Small>
        </Card>
      ) : (
        <ErrorText error={error} />
      )}
      <Text style={[type.caption, { color: c.tertiaryLabel, textAlign: 'center' }]}>Booking by Pickle Spots</Text>
    </Page>
  );
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.footnote, { color: c.secondaryLabel, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }]}>{label}</Text>
      {children}
    </View>
  );
}
