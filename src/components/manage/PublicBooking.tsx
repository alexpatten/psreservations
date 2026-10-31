import { useLocalSearchParams } from 'expo-router';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useColors } from '@/lib/theme';
import { dayLabel, dayOf, money } from '@/lib/time';
import { toast } from '../Dialogs';
import { Banner, Body, Button, Card, Chip, ChipRow, Empty, ErrorText, Field, Loading, NumberField, Row, Small, Tag, Toggle } from '../ui';
import { Pair, SectionHeader } from './Settings';

const bookingUrl = (slug: string) => `${Platform.OS === 'web' ? window.location.origin : 'https://book.picklespots.app'}/book/${slug}`;

async function copy(text: string, what = 'Copied.') {
  if (Platform.OS === 'web' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    toast(what);
  }
}

export function PublicBookingSection() {
  const c = useColors();
  const { club } = useClub();
  const manager = api.isManager(club.myRole);
  const params = useLocalSearchParams<{ stripe?: string }>();
  const [s, setS] = useState<api.PublicSettings | null>(null);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);

  const apply = (next: api.PublicSettings) => {
    setS(next);
    setPrices(Object.fromEntries(next.types.map((t) => [t.id, t.priceCents == null ? null : t.priceCents / 100])));
  };

  const load = useCallback(async () => {
    try {
      // Coming back from Stripe's onboarding: check whether the account can take payments now.
      if (params.stripe && manager) await api.stripeRefresh(club.id).catch(() => {});
      apply(await api.publicSettings(club.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [club.id, params.stripe, manager]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (changes: Parameters<typeof api.savePublicSettings>[1], done = 'Saved.') => {
    setError(null);
    try {
      apply(await api.savePublicSettings(club.id, changes));
      toast(done);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openStripe = async (action: 'onboard' | 'dashboard') => {
    setError(null);
    try {
      const { url } = action === 'onboard' ? await api.stripeOnboard(club.id) : await api.stripeDashboard(club.id);
      if (Platform.OS === 'web') window.location.assign(url);
      else Linking.openURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!s) return error ? <ErrorText error={error} /> : <Loading />;
  const publicTypes = s.types.filter((t) => t.public);
  const paidTypes = publicTypes.filter((t) => (t.priceCents ?? 0) > 0);
  const ready = s.schedulers.some((x) => x.public) && publicTypes.length > 0;

  return (
    <>
      <SectionHeader title="Public Booking">
        Let anyone book your courts from a link, without an account or membership. Guests verify their phone by text and pay upfront; unpaid
        bookings are released after 15 minutes. Every guest is saved under Guests so you can follow up.
      </SectionHeader>

      <Card style={{ gap: 14 }}>
        <Toggle
          label="Take Public Bookings"
          hint={s.enabled ? 'On: your link is live.' : 'Off: the link says you’re not taking public bookings.'}
          value={s.enabled}
          onChange={manager ? (v) => save({ enabled: v }, v ? 'Public booking is on.' : 'Public booking is off.') : () => {}}
        />
        {s.enabled && !ready ? (
          <Banner tone="warning" icon="clock">
            Choose at least one scheduler and one reservation type below so guests have something to book.
          </Banner>
        ) : null}
        {s.enabled && paidTypes.length > 0 && !s.chargesEnabled ? (
          <Banner tone="warning" icon="dollar">
            Connect Stripe to take payments. Until then guests can’t book the paid types.
          </Banner>
        ) : null}
      </Card>

      <Card style={{ gap: 12 }}>
        <Body style={{ fontWeight: '600' }}>Payments</Body>
        <Small>
          Payments go straight to your club’s own Stripe account: cards, Apple Pay and Google Pay. Pickle Spots takes no per-booking fee; Stripe’s
          standard processing rates apply.
        </Small>
        {s.chargesEnabled ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Tag label="Stripe connected" tone="tint" />
            {manager ? <Button small kind="secondary" title="Open Stripe Dashboard" onPress={() => openStripe('dashboard')} /> : null}
          </View>
        ) : manager ? (
          <View style={{ gap: 8 }}>
            {s.stripeConnected ? <Small style={{ color: c.warning }}>Stripe still needs a few details before you can take payments.</Small> : null}
            <Button title={s.stripeConnected ? 'Finish Stripe Setup' : 'Connect Stripe'} icon="dollar" onPress={() => openStripe('onboard')} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : (
          <Small>Ask a club admin to connect Stripe.</Small>
        )}
      </Card>

      {manager ? (
        <Card style={{ gap: 14 }}>
          <Body style={{ fontWeight: '600' }}>What the Public Can Book</Body>
          <View style={{ gap: 8 }}>
            <Small style={{ fontWeight: '600' }}>SCHEDULERS (COURTS AND HOURS)</Small>
            <ChipRow>
              {s.schedulers.map((x) => (
                <Chip
                  key={x.id}
                  label={x.name}
                  selected={x.public}
                  onPress={() =>
                    save({ schedulerIds: s.schedulers.filter((y) => (y.id === x.id ? !y.public : y.public)).map((y) => y.id) })
                  }
                />
              ))}
            </ChipRow>
            <Small>Guests book the next free court of the sport they pick, at times that fit these schedulers. Staff-only courts stay private.</Small>
          </View>
          <View style={{ gap: 8 }}>
            <Small style={{ fontWeight: '600' }}>RESERVATION TYPES AND PRICES</Small>
            {s.types.map((t) => (
              <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 160, alignItems: 'flex-start' }}>
                  <Chip label={t.name} color={t.color} selected={t.public} onPress={() => save({ types: [{ id: t.id, public: !t.public }] })} />
                </View>
                {t.public ? (
                  <NumberField
                    style={{ width: 160 }}
                    label="Per Hour"
                    suffix="$"
                    allowEmpty
                    value={prices[t.id] ?? null}
                    onChange={(v) => setPrices({ ...prices, [t.id]: v })}
                  />
                ) : null}
              </View>
            ))}
            <Button
              small
              kind="secondary"
              title="Save Prices"
              style={{ alignSelf: 'flex-start' }}
              onPress={() =>
                save(
                  { types: s.types.filter((t) => t.public).map((t) => ({ id: t.id, priceCents: prices[t.id] == null ? null : Math.round((prices[t.id] ?? 0) * 100) })) },
                  'Prices saved.',
                )
              }
            />
            <Small>The price is for the court, whatever the number of players. Booking rules, prime time and closures work as they do for members.</Small>
          </View>
          <Pair>
            <NumberField style={{ flex: 1 }} label="Book Up To" suffix="days ahead" value={s.advanceDays} onChange={(v) => setS({ ...s, advanceDays: v ?? 0 })} />
            <NumberField
              style={{ flex: 1 }}
              label="Upcoming Bookings per Phone"
              value={s.maxUpcoming}
              onChange={(v) => setS({ ...s, maxUpcoming: v ?? 1 })}
            />
          </Pair>
          <Button small kind="secondary" title="Save Limits" style={{ alignSelf: 'flex-start' }} onPress={() => save({ advanceDays: s.advanceDays, maxUpcoming: s.maxUpcoming })} />
        </Card>
      ) : null}

      <ShareKit slug={club.slug} name={club.name} />
      <ErrorText error={error} />
    </>
  );
}

/** The link, a QR code, website buttons, and the Google Business Profile steps. */
function ShareKit({ slug, name }: { slug: string; name: string }) {
  const c = useColors();
  const url = bookingUrl(slug);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#10241A', light: '#FFFFFF' } }).then(setQr, () => setQr(null));
  }, [url]);

  const button = `<a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#0A8754;color:#fff;font:600 16px system-ui,sans-serif;text-decoration:none">Book a Court</a>`;
  const frame = `<iframe src="${url}" title="Book a court at ${name.replace(/"/g, '&quot;')}" style="width:100%;max-width:520px;height:820px;border:0;border-radius:16px"></iframe>`;

  return (
    <>
      <SectionHeader title="Share Your Link">Put it everywhere players find you: your website, social, emails, flyers and Google.</SectionHeader>
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {qr ? (
            <View style={{ padding: 8, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder }}>
              <SvgXml xml={qr} width={132} height={132} />
            </View>
          ) : null}
          <View style={{ flex: 1, minWidth: 240, gap: 10 }}>
            <Field value={url} editable={false} selectTextOnFocus />
            <ChipRow>
              <Chip icon="link" label="Copy Link" onPress={() => copy(url, 'Link copied.')} />
              <Chip icon="tv" label="Open" onPress={() => (Platform.OS === 'web' ? window.open(url, '_blank') : Linking.openURL(url))} />
            </ChipRow>
            <Small>Print the QR code for your front door and courts.</Small>
          </View>
        </View>
      </Card>
      <Card style={{ gap: 10 }}>
        <Body style={{ fontWeight: '600' }}>Google Search & Maps</Body>
        <Small>
          Add a “Book online” button to your Google Business Profile so players who find you on Google go straight to booking: open your profile at
          business.google.com › Edit profile › Contact › Booking links (on some profiles: Bookings › Online appointments), paste your link, and
          save. Google may take a few days to show it.
        </Small>
        <Chip icon="link" label="Copy Link for Google" onPress={() => copy(url, 'Link copied. Paste it into Booking links.')} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Body style={{ fontWeight: '600' }}>On Your Website</Body>
        <Small>A “Book a Court” button:</Small>
        <Field value={button} editable={false} multiline selectTextOnFocus />
        <Chip icon="link" label="Copy Button Code" onPress={() => copy(button, 'Button code copied.')} />
        <Small>Or the whole booking page inside your site:</Small>
        <Field value={frame} editable={false} multiline selectTextOnFocus />
        <Chip icon="link" label="Copy Embed Code" onPress={() => copy(frame, 'Embed code copied.')} />
      </Card>
    </>
  );
}

/** Everyone who booked publicly: leads to follow up with and invite to join. */
export function GuestsSection() {
  const { club } = useClub();
  const tz = club.timezone;
  const [query, setQuery] = useState('');
  const [list, setList] = useState<api.PublicPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => api.publicPlayers(club.id, query).then(setList, (e: Error) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [club.id, query]);

  const exportCsv = () => {
    if (!list || Platform.OS !== 'web') return;
    const rows = [
      ['Name', 'Phone', 'Email', 'Bookings', 'Spent', 'First booked', 'Last booked', 'Member'],
      ...list.map((g) => [g.name, g.phone, g.email ?? '', g.bookings, (g.spentCents / 100).toFixed(2), dayOf(g.firstBookedAt, tz), dayOf(g.lastBookedAt, tz), g.isMember ? 'yes' : 'no']),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${club.slug}-guests.csv`;
    a.click();
  };

  return (
    <>
      <SectionHeader title="Guests" action={Platform.OS === 'web' && list?.length ? <Button small kind="secondary" title="Export CSV" onPress={exportCsv} /> : undefined}>
        Everyone who booked from your public link, with a verified phone number. Follow up with offers and memberships, and turn regulars into
        members.
      </SectionHeader>
      <Field placeholder="Search by name, phone or email" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <ErrorText error={error} />
      <Card padded={false}>
        {list === null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="users" title="No guests yet">
            Turn on Public Booking and share your link.
          </Empty>
        ) : (
          list.map((g, i) => (
            <Row
              key={g.id}
              title={g.name}
              subtitle={`${g.phone}${g.email ? ` · ${g.email}` : ''} · ${g.bookings} booking${g.bookings === 1 ? '' : 's'}, ${money(g.spentCents)} · last ${dayLabel(dayOf(g.lastBookedAt, tz))}`}
              right={g.isMember ? <Tag label="Member" tone="tint" /> : g.bookings >= 3 ? <Tag label="Regular" tone="warning" /> : undefined}
              last={i === list.length - 1}
            />
          ))
        )}
      </Card>
    </>
  );
}
