import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { EventCard } from '@/components/EventCard';
import { PublicHeader } from '@/components/PublicHeader';
import { Chip, ChipRow, Empty, Loading, Page, Small, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type, useColors } from '@/lib/theme';

/**
 * A club's upcoming events for its website (link or embed it): no sign-in to browse;
 * registering signs in and goes to the club's events.
 */
export default function PublicEvents() {
  const c = useColors();
  const wide = useWide(760);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { status } = useAuth();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.publicEvents>> | undefined>(undefined);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    api.publicEvents(String(slug)).then(setData, () => setData(null));
  }, [slug]);

  if (data === undefined) return <Loading />;
  if (data === null) return <Empty icon="calendar" title="No public events here">Check the link, or contact the club.</Empty>;

  const goRegister = () => {
    const next = `/c/${data.club.slug}/events`;
    router.push((status === 'signedIn' ? next : `/sign-in?next=${encodeURIComponent(next)}`) as never);
  };
  const shown = data.events.filter((e) => !category || e.categoryId === category);

  return (
    <View style={{ flex: 1 }}>
      <PublicHeader name={data.club.name} address={data.club.address} />
      <Page maxWidth={1000}>
        <Text style={[type.title1, { color: c.label }]}>Upcoming Events</Text>
        {data.categories.length ? (
          <ChipRow>
            <Chip label="All" selected={!category} onPress={() => setCategory(null)} />
            {data.categories.map((k) => (
              <Chip key={k.id} label={k.name} color={k.color} selected={category === k.id} onPress={() => setCategory(k.id)} />
            ))}
          </ChipRow>
        ) : null}
        {shown.length === 0 ? <Empty icon="calendar" title="Nothing scheduled right now" /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {shown.map((e) => (
            <EventCard
              key={e.id}
              club={{ id: '', name: data.club.name, timezone: data.club.timezone }}
              clinic={e}
              category={data.categories.find((k) => k.id === e.categoryId)}
              onChange={() => {}}
              wide={wide}
              signedOut={goRegister}
            />
          ))}
        </View>
        <Small style={{ textAlign: 'center' }}>Register with a free Pickle Spots account.</Small>
      </Page>
    </View>
  );
}
