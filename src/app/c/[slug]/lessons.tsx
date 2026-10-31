import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { toast } from '@/components/Dialogs';
import { Avatar } from '@/components/Avatar';
import { EventCard } from '@/components/EventCard';
import { LessonBookingSheet } from '@/components/LessonBookingSheet';
import { Button, Card, Empty, ErrorText, Heading, Loading, Page, Small, Tag, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { fromPrice, useLessons } from '@/lib/lessons';
import { type, useColors } from '@/lib/theme';
import { money } from '@/lib/time';

export default function LessonsPage() {
  const c = useColors();
  const wide = useWide();
  const { club } = useClub();
  const { data: lessons, error } = useLessons(club.id);
  const [clinics, setClinics] = useState<api.Clinic[] | null>(null);
  const [booking, setBooking] = useState<api.Instructor | null>(null);

  const loadClinics = useCallback(() => {
    api.clinics(club.id).then(setClinics, () => setClinics([]));
  }, [club.id]);
  useEffect(loadClinics, [loadClinics]);

  if (!lessons) return <Page>{error ? <ErrorText error={error} /> : <Loading />}</Page>;
  const bookable = lessons.instructors.filter((i) => i.membersCanBook || api.isStaff(club.myRole));
  const typeName = (id: string | null) => lessons.instructorTypes.find((t) => t.id === id)?.name;

  return (
    <Page>
      <Heading>Private Lessons</Heading>
      {bookable.length === 0 ? (
        <Card>
          <Empty icon="users" title="No pros to book online yet">
            Ask the front desk about lessons.
          </Empty>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {bookable.map((i) => {
            const price = fromPrice(lessons, i);
            return (
              <Card key={i.id} style={{ flexBasis: wide ? '31%' : '100%', flexGrow: 1, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={i.name} color={i.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.headline, { color: c.label }]}>{i.name}</Text>
                    {typeName(i.typeId) ? <Small>{typeName(i.typeId)}</Small> : null}
                  </View>
                  {price != null ? <Tag label={`from ${money(price)}/hr`} tone="tint" /> : null}
                </View>
                {i.bio ? (
                  <Small numberOfLines={3} muted>
                    {i.bio}
                  </Small>
                ) : null}
                <Button title="Book a Lesson" icon="calendar" onPress={() => (club.myRole ? setBooking(i) : toast('Join the club to book lessons.'))} />
              </Card>
            );
          })}
        </View>
      )}

      <Heading>Clinics & Programs</Heading>
      {clinics === null ? (
        <Loading />
      ) : clinics.length === 0 ? (
        <Card>
          <Empty icon="calendar" title="No upcoming clinics">
            Check back soon.
          </Empty>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {clinics.map((cl) => (
            <EventCard key={cl.id} club={club} clinic={cl} instructorName={lessons.instructors.find((i) => i.id === cl.instructorId)?.name} onChange={loadClinics} wide={wide} />
          ))}
        </View>
      )}

      {booking ? (
        <LessonBookingSheet
          club={club}
          lessons={lessons}
          instructor={booking}
          onClose={() => setBooking(null)}
          onBooked={() => setBooking(null)}
        />
      ) : null}
    </Page>
  );
}
