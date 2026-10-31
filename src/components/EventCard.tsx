import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import * as api from '@/lib/api';
import { type, useColors } from '@/lib/theme';
import { dayLabel, dayOf, money, timeOf, timeRange } from '@/lib/time';
import { CustomFieldInput } from './BookingSheet';
import { confirm, toast } from './Dialogs';
import { Icon } from './Icon';
import { Body, Button, Card, ErrorText, Field, Segmented, Sheet, Small, Tag, Toggle } from './ui';

/** Who an event is for, e.g. "Women · Ages 18+ · Rated 3.5+". */
export function restrictionsLabel(cl: api.Clinic): string | null {
  const parts: string[] = [];
  if (cl.gender === 'women') parts.push('Women');
  if (cl.gender === 'men') parts.push('Men');
  if (cl.minAge != null || cl.maxAge != null) parts.push(cl.minAge != null && cl.maxAge != null ? `Ages ${cl.minAge}–${cl.maxAge}` : cl.minAge != null ? `Ages ${cl.minAge}+` : `Up to age ${cl.maxAge}`);
  if (cl.minRating != null || cl.maxRating != null) parts.push(cl.minRating != null && cl.maxRating != null ? `Rated ${cl.minRating}–${cl.maxRating}` : cl.minRating != null ? `Rated ${cl.minRating}+` : `Rated up to ${cl.maxRating}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * An event or clinic like CourtReserve's cards: category, title, dates, time, price range,
 * who it's for, spots left, and Register / Join Waitlist / Drop Out.
 */
export function EventCard({
  club,
  clinic: cl,
  instructorName,
  category,
  onChange,
  wide,
  signedOut,
}: {
  club: Pick<api.Club, 'id' | 'name' | 'timezone' | 'courts' | 'types' | 'myRole'> | { id: string; name: string; timezone: string; courts?: api.Court[]; types?: api.ReservationType[]; myRole?: api.Role | null };
  clinic: api.Clinic;
  instructorName?: string | null;
  category?: api.EventCategory | null;
  onChange: () => void;
  wide: boolean;
  /** On the public page: Register goes to sign in. */
  signedOut?: () => void;
}) {
  const c = useColors();
  const tz = club.timezone;
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState<{ reservationId?: string } | null>(null);
  const rtype = club.types?.find((t) => t.id === cl.typeId);
  const accent = category?.color ?? rtype?.color ?? c.tint;
  const upcoming = cl.sessions.filter((s) => s.status === 'booked' && s.endsAt > Date.now());
  const first = upcoming[0];
  const last = upcoming[upcoming.length - 1];
  const spots = upcoming.length ? Math.min(...upcoming.map((s) => s.spots)) : 0;
  const court = club.courts?.find((x) => x.id === first?.courtId);
  const prices = [cl.dropInPriceCents, cl.priceCents].filter((p): p is number => p != null && p > 0);
  const who = restrictionsLabel(cl);
  const now = Date.now();
  const notOpen = cl.registrationOpensAt && now < cl.registrationOpensAt;
  const closed = cl.registrationClosesAt && now > cl.registrationClosesAt;

  const start = (reservationId?: string) => {
    if (signedOut) return signedOut();
    setRegistering({ reservationId });
  };
  const drop = async (reservationId?: string) => {
    if (!(await confirm('Drop out?', 'Your spot goes to the next player on the waitlist.', { confirmLabel: 'Drop Out', destructive: true }))) return;
    try {
      await api.unregisterClinic(cl.id, { reservationId });
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const pay = async () => {
    if (!cl.myRegistrationId) return;
    try {
      const { url } = await api.payEvent(cl.myRegistrationId);
      if (Platform.OS === 'web') window.location.assign(url);
      else Linking.openURL(url);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!first) return null;
  return (
    <Card padded={false} style={{ flexBasis: wide ? '48%' : '100%', flexGrow: 1, flexDirection: 'row', overflow: 'hidden' }}>
      <View style={{ width: 6, backgroundColor: accent }} />
      <View style={{ flex: 1, padding: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ball" color={c.tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.footnote, { color: accent, fontWeight: '600' }]}>{category?.name ?? rtype?.name ?? 'Event'}</Text>
            <Text style={[type.headline, { color: c.label }]}>{cl.title}</Text>
            <Small>{[court?.name, instructorName ? `with ${instructorName}` : null].filter(Boolean).join(' · ')}</Small>
          </View>
          {!cl.published ? <Tag label="Draft" /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          <Meta icon="calendar" text={first === last ? dayLabel(dayOf(first.startsAt, tz)) : `${dayLabel(dayOf(first.startsAt, tz))} – ${dayLabel(dayOf(last.startsAt, tz))}`} />
          {upcoming.length > 1 ? <Meta icon="list" text={`${upcoming.length} dates`} /> : null}
          <Meta icon="clock" text={timeRange(first.startsAt, first.endsAt, tz)} />
          {prices.length ? <Meta icon="dollar" text={prices.length > 1 ? `${money(Math.min(...prices))} – ${money(Math.max(...prices))}` : money(prices[0])} /> : <Meta icon="dollar" text="Free" />}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {who ? <Tag label={who} tone="warning" /> : null}
          {cl.membersOnly === false ? <Tag label="Open to all" tone="teal" /> : null}
        </View>
        {cl.description ? <Small numberOfLines={open ? undefined : 2}>{cl.description}</Small> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 18, height: 8, borderRadius: 4, backgroundColor: spots > 0 ? c.tint : c.warning }} />
          <Small muted={false}>{spots > 0 ? `${spots} spot${spots === 1 ? '' : 's'} remaining` : cl.waitlisted ? `Full · ${cl.waitlisted} waiting` : 'Full'}</Small>
        </View>
        {cl.myStatus === 'registered' ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Tag label="You're registered" tone="tint" />
            <Button small kind="destructiveSoft" title="Drop Out" onPress={() => drop()} />
          </View>
        ) : cl.myStatus === 'pending' ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag label="Held for payment" tone="warning" />
            <Button small title={`Pay ${money(cl.priceCents)}`} onPress={pay} />
            <Button small kind="plain" title="Cancel" onPress={() => drop()} />
          </View>
        ) : cl.myStatus === 'waitlisted' ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Tag label={`Waitlist #${cl.myWaitlistPosition ?? '?'}`} tone="warning" />
            <Button small kind="destructiveSoft" title="Leave Waitlist" onPress={() => drop()} />
          </View>
        ) : notOpen ? (
          <Small>Registration opens {dayLabel(dayOf(cl.registrationOpensAt!, tz))} at {timeOf(cl.registrationOpensAt!, tz)}.</Small>
        ) : closed ? (
          <Small>Registration has closed.</Small>
        ) : cl.ineligible && !/My Details|rating in Pickle Spots/.test(cl.ineligible) ? (
          <Small style={{ color: c.warning }}>{cl.ineligible}</Small>
        ) : spots > 0 ? (
          <Button title={`Register${cl.priceCents ? ` · ${money(cl.priceCents)}` : ''}`} onPress={() => start()} />
        ) : cl.waitlist ? (
          <Button kind="secondary" title="Join Waitlist" onPress={() => start()} />
        ) : null}
        {cl.dropInPriceCents != null && !cl.myStatus && upcoming.length > 1 && !notOpen && !closed ? (
          <Pressable onPress={() => setOpen(!open)}>
            <Small style={{ color: c.tint, fontWeight: '600' }}>{open ? 'Hide dates' : `Or drop in for one date (${money(cl.dropInPriceCents)})`}</Small>
          </Pressable>
        ) : null}
        {open
          ? upcoming.map((s) => (
              <View key={s.reservationId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Small muted={false} style={{ flex: 1 }}>
                  {dayLabel(dayOf(s.startsAt, tz))}, {timeOf(s.startsAt, tz)} · {s.spots > 0 ? `${s.spots} left` : 'full'}
                </Small>
                {s.iDropIn ? (
                  <Button small kind="destructiveSoft" title="Drop" onPress={() => drop(s.reservationId)} />
                ) : (
                  <Button small kind="secondary" title="Drop In" disabled={s.spots <= 0} onPress={() => start(s.reservationId)} />
                )}
              </View>
            ))
          : null}
      </View>
      {registering ? (
        <RegisterSheet
          clubId={club.id}
          clinic={cl}
          reservationId={registering.reservationId}
          onClose={() => setRegistering(null)}
          onDone={() => {
            setRegistering(null);
            onChange();
          }}
        />
      ) : null}
    </Card>
  );
}

function Meta({ icon, text }: { icon: 'calendar' | 'clock' | 'dollar' | 'list'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={icon} size={15} color={c.secondaryLabel} />
      <Small muted={false}>{text}</Small>
    </View>
  );
}

/** Registration: details the event's restrictions need, its questions, its terms, then payment if it's taken online. */
function RegisterSheet({ clubId, clinic: cl, reservationId, onClose, onDone }: { clubId: string; clinic: api.Clinic; reservationId?: string; onClose: () => void; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [accept, setAccept] = useState(false);
  const [needsDetails, setNeedsDetails] = useState(!!cl.ineligible && /My Details/.test(cl.ineligible));
  const [error, setError] = useState<string | null>(cl.ineligible && !/My Details/.test(cl.ineligible) ? cl.ineligible : null);
  const price = reservationId ? cl.dropInPriceCents ?? 0 : cl.priceCents;

  const submit = async () => {
    setError(null);
    try {
      const r = await api.registerEvent(cl.id, { reservationId, answers, accept });
      if (r.status === 'pending') {
        const { url } = await api.payEvent(r.registrationId);
        if (Platform.OS === 'web') window.location.assign(url);
        else Linking.openURL(url);
        return;
      }
      toast(r.status === 'waitlisted' ? 'You’re on the waitlist. You’ll move up automatically if a spot opens.' : `You’re registered${r.amountCents ? ` (${money(r.amountCents)} due at the front desk or on your account)` : ''}.`);
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      if (/My Details/.test(msg)) setNeedsDetails(true);
      setError(msg);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={cl.title}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button
            title={cl.requirePayment && price ? `Continue to Payment · ${money(price)}` : 'Register'}
            disabled={(!!cl.disclosure && !accept) || needsDetails}
            onPress={submit}
          />
        </>
      }
    >
      {needsDetails ? (
        <MyDetailsForm
          clubId={clubId}
          onSaved={() => {
            setNeedsDetails(false);
            setError(null);
          }}
        />
      ) : null}
      {(cl.customFields ?? []).map((f) => (
        <CustomFieldInput key={f.id} field={f} value={answers[f.id]} onChange={(v) => setAnswers({ ...answers, [f.id]: v })} />
      ))}
      {cl.disclosure ? (
        <View style={{ gap: 8 }}>
          <Small style={{ fontWeight: '600' }}>TERMS</Small>
          <Card style={{ maxHeight: 200 }}>
            <Body style={{ fontSize: 14 }}>{cl.disclosure}</Body>
          </Card>
          <Toggle label="I’ve read and accept these terms" value={accept} onChange={setAccept} />
        </View>
      ) : null}
      {price ? (
        <Small>
          {cl.requirePayment ? `You’ll pay ${money(price)} online now. Your spot is held for 15 minutes while you pay.` : `${money(price)} is due at the front desk or on your club account.`}
        </Small>
      ) : null}
      <ErrorText error={error} />
    </Sheet>
  );
}

/** Birth date, gender and ZIP code at a club: for event restrictions and the club's reports. */
export function MyDetailsForm({ clubId, onSaved }: { clubId: string; onSaved?: () => void }) {
  const [d, setD] = useState<api.MemberDetails>({ birthDate: null, gender: null, zip: null });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.memberDetails(clubId).then((x) => x && setD(x), () => {});
  }, [clubId]);
  return (
    <Card style={{ gap: 12 }}>
      <Body style={{ fontWeight: '600' }}>My Details</Body>
      <Small>Only club staff see these. Events use them for age and gender groups.</Small>
      <Segmented<NonNullable<api.MemberDetails['gender']>>
        value={d.gender ?? 'unspecified'}
        onChange={(g) => setD({ ...d, gender: g })}
        options={[
          { value: 'woman', label: 'Woman' },
          { value: 'man', label: 'Man' },
          { value: 'nonbinary', label: 'Nonbinary' },
          { value: 'unspecified', label: 'Prefer not to say' },
        ]}
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Field style={{ flex: 1 }} label="Birth Date" value={d.birthDate ?? ''} placeholder="YYYY-MM-DD" onChangeText={(t) => setD({ ...d, birthDate: t })} />
        <Field style={{ flex: 1 }} label="ZIP Code" value={d.zip ?? ''} onChangeText={(t) => setD({ ...d, zip: t })} keyboardType="number-pad" />
      </View>
      <ErrorText error={error} />
      <Button
        small
        title="Save My Details"
        style={{ alignSelf: 'flex-start' }}
        onPress={async () => {
          setError(null);
          try {
            setD(await api.saveMemberDetails(clubId, { ...d, birthDate: d.birthDate || null }));
            toast('Saved.');
            onSaved?.();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    </Card>
  );
}
