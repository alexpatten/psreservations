import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { COMMON_ZONES } from '@/lib/time';
import { confirm, toast } from '../Dialogs';
import { Banner, Body, Button, Card, Chip, ChipRow, ErrorText, Field, Heading, NumberField, Segmented, Small, Toggle, useWide } from '../ui';

/** Saves club settings and shows the result; returns whether it worked. */
export function useSaveClub() {
  const { club, setClub } = useClub();
  const [error, setError] = useState<string | null>(null);
  const save = async (changes: Parameters<typeof api.saveClub>[1], done = 'Saved.') => {
    setError(null);
    try {
      setClub(await api.saveClub(club.id, changes));
      toast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return { save, error };
}

export function SectionHeader({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Heading right={action} style={{ fontSize: 22 }}>
        {title}
      </Heading>
      {children ? <Small>{children}</Small> : null}
    </View>
  );
}

/** Two fields side by side on wide screens. */
export function Pair({ children }: { children: React.ReactNode }) {
  const wide = useWide(600);
  return <View style={{ flexDirection: wide ? 'row' : 'column', gap: 14 }}>{children}</View>;
}

export function RulesSection() {
  const { club } = useClub();
  const { save, error } = useSaveClub();
  const [rules, setRules] = useState<api.Rules>(club.rules);
  const set = (key: keyof api.Rules) => (v: number | null) => setRules({ ...rules, [key]: v ?? 0 });

  return (
    <>
      <SectionHeader title="Rules & Restrictions">
        Control how and when members book. Staff aren’t held to these. Courts and ball machines can override the length limits, and prime
        time can be stricter.
      </SectionHeader>
      <Card style={{ gap: 16 }}>
        <Pair>
          <NumberField style={{ flex: 1 }} label="Book Up To" suffix="days ahead" value={rules.advanceDays} onChange={set('advanceDays')} />
          <NumberField style={{ flex: 1 }} label="Check-in Opens" suffix="min before" value={rules.checkInMinutesBefore} onChange={set('checkInMinutesBefore')} />
        </Pair>
        <Pair>
          <NumberField style={{ flex: 1 }} label="Shortest Reservation" suffix="min" value={rules.minMinutes} onChange={set('minMinutes')} />
          <NumberField style={{ flex: 1 }} label="Longest Reservation" suffix="min" value={rules.maxMinutes} onChange={set('maxMinutes')} />
        </Pair>
        <Pair>
          <NumberField
            style={{ flex: 1 }}
            label="Upcoming Reservations at Once"
            value={rules.maxUpcoming}
            onChange={set('maxUpcoming')}
            hint="Per member, counting the ones they booked."
          />
          <NumberField style={{ flex: 1 }} label="Reservations per Day" value={rules.maxPerDay} onChange={set('maxPerDay')} />
        </Pair>
        <ErrorText error={error} />
        <Button title="Save Rules" onPress={() => save({ rules })} style={{ alignSelf: 'flex-start' }} />
      </Card>
    </>
  );
}

export function PenaltyRules() {
  const { club } = useClub();
  const { save, error } = useSaveClub();
  const [rules, setRules] = useState<api.Rules>(club.rules);
  const set = (key: keyof api.Rules) => (v: number | null) => setRules({ ...rules, [key]: v ?? 0 });
  const dollars = (cents: number) => Math.round(cents) / 100;

  return (
    <Card style={{ gap: 16 }}>
      <Body style={{ fontWeight: '600' }}>Penalty Rules</Body>
      <NumberField
        label="Late Cancellation Window"
        suffix="hours"
        value={rules.cancelCutoffHours}
        onChange={set('cancelCutoffHours')}
        hint="Cancelling less than this long before the start is a late cancellation. 0: never late."
      />
      <Pair>
        <NumberField
          style={{ flex: 1 }}
          label="Late Cancellation Fee"
          suffix="$"
          value={dollars(rules.lateCancelFeeCents)}
          onChange={(v) => setRules({ ...rules, lateCancelFeeCents: Math.round((v ?? 0) * 100) })}
        />
        <NumberField
          style={{ flex: 1 }}
          label="No-Show Fee"
          suffix="$"
          value={dollars(rules.noShowFeeCents)}
          onChange={(v) => setRules({ ...rules, noShowFeeCents: Math.round((v ?? 0) * 100) })}
        />
      </Pair>
      <Small>Fees are recorded with each strike, ready for invoicing.</Small>
      <Pair>
        <NumberField style={{ flex: 1 }} label="Strikes to Pause Booking" value={rules.strikeLimit} onChange={set('strikeLimit')} hint="0: strikes never pause booking." />
        <NumberField style={{ flex: 1 }} label="Within" suffix="days" value={rules.strikeWindowDays} onChange={set('strikeWindowDays')} />
        <NumberField style={{ flex: 1 }} label="Pause For" suffix="days" value={rules.suspensionDays} onChange={set('suspensionDays')} />
      </Pair>
      <ErrorText error={error} />
      <Button title="Save Penalty Rules" onPress={() => save({ rules })} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}

const FIELD_TYPES: { value: api.CustomField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Choice' },
];

export function CustomFieldsSection() {
  const { club } = useClub();
  const { save, error } = useSaveClub();
  const [fields, setFields] = useState<api.CustomField[]>(club.customFields);
  const update = (i: number, f: Partial<api.CustomField>) => setFields(fields.map((x, j) => (j === i ? { ...x, ...f } : x)));

  return (
    <>
      <SectionHeader
        title="Custom Fields"
        action={
          <Button
            small
            kind="secondary"
            icon="plus"
            title="Add Field"
            onPress={() => setFields([...fields, { id: Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false }])}
          />
        }
      >
        Extra questions on the booking form, like “Skill level” or “I’ve signed the waiver”. Answers show on the reservation.
      </SectionHeader>
      {fields.length === 0 ? <Small>No custom fields yet.</Small> : null}
      {fields.map((f, i) => (
        <Card key={f.id} style={{ gap: 12 }}>
          <Field label="Label" value={f.label} onChangeText={(t) => update(i, { label: t })} maxLength={60} />
          <Segmented value={f.type} options={FIELD_TYPES} onChange={(t) => update(i, { type: t })} />
          {f.type === 'select' ? (
            <Field
              label="Choices"
              value={(f.options ?? []).join(', ')}
              hint="Separate with commas."
              onChangeText={(t) => update(i, { options: t.split(',').map((x) => x.trimStart()) })}
            />
          ) : null}
          <Toggle label="Required" hint={f.type === 'checkbox' ? 'Members must check it to book.' : undefined} value={!!f.required} onChange={(v) => update(i, { required: v })} />
          <Button small kind="destructiveSoft" icon="trash" title="Remove" onPress={() => setFields(fields.filter((_, j) => j !== i))} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ))}
      <ErrorText error={error} />
      <Button
        title="Save Custom Fields"
        style={{ alignSelf: 'flex-start' }}
        onPress={() =>
          save({
            customFields: fields.map((f) => ({ ...f, label: f.label.trim(), options: f.type === 'select' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })),
          })
        }
      />
    </>
  );
}

export function LobbyKioskSection() {
  const { club } = useClub();
  const { save, error } = useSaveClub();
  const manager = api.isManager(club.myRole);
  const origin = Platform.OS === 'web' ? window.location.origin : '';
  const lobbyUrl = club.lobbyToken ? `${origin}/lobby/${club.lobbyToken}` : null;
  const kioskUrl = `${origin}/kiosk/${club.slug}`;

  const copy = async (text: string) => {
    if (Platform.OS === 'web' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast('Link copied.');
    }
  };

  return (
    <>
      <SectionHeader title="Lobby View">
        A big-screen board of court availability and what’s coming up today. Open it on a TV in your lobby; it refreshes itself and doesn’t
        need anyone signed in.
      </SectionHeader>
      <Card style={{ gap: 12 }}>
        {lobbyUrl ? <Field value={lobbyUrl} editable={false} selectTextOnFocus /> : null}
        <ChipRow>
          {lobbyUrl ? <Chip icon="tv" label="Open Lobby View" onPress={() => Platform.OS === 'web' && window.open(lobbyUrl, '_blank')} /> : null}
          {lobbyUrl ? <Chip icon="link" label="Copy Link" onPress={() => copy(lobbyUrl)} /> : null}
        </ChipRow>
        {manager ? (
          <>
            <Toggle
              label="Show Players’ Names"
              hint="First name and last initial, as elsewhere in Pickle Spots. Off: just the reservation type."
              value={club.lobbyShowNames}
              onChange={(v) => save({ lobbyShowNames: v })}
            />
            <Button
              small
              kind="destructiveSoft"
              title="Make a New Link"
              style={{ alignSelf: 'flex-start' }}
              onPress={async () => {
                if (await confirm('Make a new lobby link?', 'The old link stops working; update any screens that use it.', { confirmLabel: 'New Link', destructive: true })) {
                  save({ newLobbyLink: true }, 'New lobby link made.');
                }
              }}
            />
          </>
        ) : null}
      </Card>

      <SectionHeader title="Kiosk">
        A walk-up station for a tablet at the front desk: players enter their Player ID to check in or book the next open court, and new players
        can create an account. Open it while signed in as staff, then leave it running.
      </SectionHeader>
      <Card style={{ gap: 12 }}>
        <Field value={kioskUrl} editable={false} selectTextOnFocus />
        <ChipRow>
          <Chip icon="tablet" label="Open Kiosk" onPress={() => Platform.OS === 'web' && window.open(kioskUrl, '_blank')} />
          <Chip icon="link" label="Copy Link" onPress={() => copy(kioskUrl)} />
        </ChipRow>
        <Banner tone="info">The kiosk acts as the staff member who opened it. Use a staff account set up for the front desk.</Banner>
      </Card>
      <ErrorText error={error} />
    </>
  );
}

export function DetailsSection() {
  const { club } = useClub();
  const { save, error } = useSaveClub();
  const [name, setName] = useState(club.name);
  const [address, setAddress] = useState(club.address ?? '');
  const [timezone, setTimezone] = useState(club.timezone);
  const zones = COMMON_ZONES.includes(club.timezone) ? COMMON_ZONES : [club.timezone, ...COMMON_ZONES];

  return (
    <>
      <SectionHeader title="Club Details">Members book at /c/{club.slug}.</SectionHeader>
      <Card style={{ gap: 16 }}>
        <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
        <Field label="Address" value={address} onChangeText={setAddress} maxLength={200} />
        <View style={{ gap: 8 }}>
          <Small style={{ fontWeight: '600' }}>TIME ZONE</Small>
          <ChipRow>
            {zones.map((z) => (
              <Chip key={z} small label={z.replace('_', ' ')} selected={z === timezone} onPress={() => setTimezone(z)} />
            ))}
          </ChipRow>
          <Small>Hours, prime time and daily limits use this time zone.</Small>
        </View>
        <ParkLink club={club} onPick={(parkId) => save({ parkId }, parkId ? 'Linked to Pickle Spots.' : 'Unlinked.')} />
        <ErrorText error={error} />
        <Button title="Save" style={{ alignSelf: 'flex-start' }} onPress={() => save({ name, address, timezone })} />
      </Card>
    </>
  );
}

/** Links the club to its Pickle Spots court, so Pulse counts players who check in there with the app. */
function ParkLink({ club, onPick }: { club: api.Club; onPick: (parkId: string | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; address: string | null }[]>([]);
  useEffect(() => {
    if (query.trim().length < 3) return setResults([]);
    const t = setTimeout(() => api.searchParks(query).then(setResults, () => setResults([])), 250);
    return () => clearTimeout(t);
  }, [query]);
  return (
    <View style={{ gap: 8 }}>
      <Small style={{ fontWeight: '600' }}>PICKLE SPOTS COURT</Small>
      {club.parkId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Small muted={false} style={{ flex: 1 }}>Linked. Walk-up check-ins there count in Pulse.</Small>
          <Button small kind="plain" title="Unlink" onPress={() => onPick(null)} />
        </View>
      ) : (
        <Small>Link the court players check in at with the Pickle Spots app, so Pulse counts walk-up play.</Small>
      )}
      <Field placeholder="Search Pickle Spots courts by name" value={query} onChangeText={setQuery} />
      {results.map((r) => (
        <Chip key={r.id} small label={`${r.name}${r.address ? ` · ${r.address}` : ''}`} selected={club.parkId === r.id} onPress={() => { onPick(r.id); setQuery(''); }} />
      ))}
    </View>
  );
}
