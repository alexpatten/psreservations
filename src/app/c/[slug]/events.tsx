import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { EventCard, MyDetailsForm } from '@/components/EventCard';
import { Banner, Button, Card, Chip, ChipRow, Empty, Heading, Loading, Page, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { useLessons } from '@/lib/lessons';

/** Programs, socials, tournaments and clinics: browse by category and register. */
export default function EventsPage() {
  const wide = useWide();
  const { club } = useClub();
  const { paid } = useLocalSearchParams<{ paid?: string }>();
  const { data: lessons } = useLessons(club.id);
  const [events, setEvents] = useState<api.Clinic[] | null>(null);
  const [categories, setCategories] = useState<api.EventCategory[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [details, setDetails] = useState(false);

  const load = useCallback(() => {
    api.clinics(club.id).then(setEvents, () => setEvents([]));
    api.eventCategories(club.id).then(setCategories, () => {});
  }, [club.id]);
  useEffect(load, [load]);

  // Back from paying: the confirmation can take a few seconds.
  useEffect(() => {
    if (!paid) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [paid, load]);

  const shown = events?.filter((e) => !category || e.categoryId === category) ?? [];

  return (
    <Page>
      <Heading right={club.myRole ? <Button small kind="secondary" title="My Details" onPress={() => setDetails(!details)} /> : undefined}>Events & Programs</Heading>
      {paid ? <Banner tone="success" icon="checkCircle">Payment received. Your spot is confirmed.</Banner> : null}
      {details ? <MyDetailsForm clubId={club.id} onSaved={load} /> : null}
      {categories.length ? (
        <ChipRow>
          <Chip label="All" selected={!category} onPress={() => setCategory(null)} />
          {categories.map((k) => (
            <Chip key={k.id} label={k.name} color={k.color} selected={category === k.id} onPress={() => setCategory(k.id)} />
          ))}
        </ChipRow>
      ) : null}
      {events === null ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Card>
          <Empty icon="calendar" title="No upcoming events">
            Check back soon.
          </Empty>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {shown.map((e) => (
            <EventCard
              key={e.id}
              club={club}
              clinic={e}
              category={categories.find((k) => k.id === e.categoryId)}
              instructorName={lessons?.instructors.find((i) => i.id === e.instructorId)?.name}
              onChange={load}
              wide={wide}
            />
          ))}
        </View>
      )}
    </Page>
  );
}
