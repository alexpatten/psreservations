import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Button, Card, Chip, ChipRow, ErrorText, Field, NumberField, Page, Small, Title } from '@/components/ui';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COMMON_ZONES, localZone } from '@/lib/time';

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function NewClub() {
  const { status } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [address, setAddress] = useState('');
  const [courts, setCourts] = useState<number | null>(4);
  const [timezone, setTimezone] = useState(localZone());
  const [error, setError] = useState<string | null>(null);

  if (status === 'signedOut') return <Redirect href="/sign-in?next=/new-club" />;

  const zones = COMMON_ZONES.includes(timezone) ? COMMON_ZONES : [timezone, ...COMMON_ZONES];

  const create = async () => {
    setError(null);
    try {
      const club = await api.createClub({ name: name.trim(), slug, timezone, courts: courts ?? 0, address: address.trim() });
      router.replace(`/c/${club.slug}/manage`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="New Club" />
      <Page maxWidth={640}>
        <Title>Create a Club</Title>
        <Small>
          You’ll be the club’s owner. It starts with your courts in one scheduler (7 AM – 10 PM, 30-minute slots) and the usual reservation
          types; change any of it under Manage.
        </Small>
        <Card style={{ gap: 16 }}>
          <Field
            label="Club Name"
            value={name}
            placeholder="Austin Pickle Ranch"
            onChangeText={(t) => {
              setName(t);
              if (!slugEdited) setSlug(slugify(t));
            }}
          />
          <Field
            label="Web Address"
            value={slug}
            autoCapitalize="none"
            hint={`Members book at /c/${slug || 'your-club'}`}
            onChangeText={(t) => {
              setSlugEdited(true);
              setSlug(slugify(t));
            }}
          />
          <Field label="Address" value={address} onChangeText={setAddress} placeholder="Street, city, state" />
          <NumberField label="Number of Courts" value={courts} onChange={setCourts} hint="You can add ball machines and split courts later." />
          <View style={{ gap: 8 }}>
            <Small style={{ fontWeight: '600' }}>TIME ZONE</Small>
            <ChipRow>
              {zones.map((z) => (
                <Chip key={z} small label={z.replace('_', ' ')} selected={z === timezone} onPress={() => setTimezone(z)} />
              ))}
            </ChipRow>
          </View>
          <ErrorText error={error} />
          <Button title="Create Club" onPress={create} disabled={!name.trim() || !slug || !courts} />
        </Card>
      </Page>
    </View>
  );
}
