import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { ClosuresSection, MembersSection, StrikesSection } from '@/components/manage/Operations';
import { AccessSection } from '@/components/manage/Access';
import { BillingSection } from '@/components/manage/Billing';
import { ClinicsSection, InstructorReportSection, InstructorsSection, ProPricingSection } from '@/components/manage/Lessons';
import { EmailSection, GroupsSection, PlansSection, RatingsSection, WaiversSection } from '@/components/manage/Memberships';
import { GuestsSection, PublicBookingSection } from '@/components/manage/PublicBooking';
import { CourtsSection, PrimeTimeSection, SchedulersSection, TypesSection } from '@/components/manage/Setup';
import { CustomFieldsSection, DetailsSection, LobbyKioskSection, RulesSection } from '@/components/manage/Settings';
import { Card, Chip, Empty, Page, useWide } from '@/components/ui';
import { isManager, isStaff } from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';

const SECTIONS: { key: string; label: string; icon: IconName; managersOnly: boolean; Component: () => React.JSX.Element }[] = [
  { key: 'closures', label: 'Closures', icon: 'ban', managersOnly: false, Component: ClosuresSection },
  { key: 'billing', label: 'Billing & Invoices', icon: 'dollar', managersOnly: false, Component: BillingSection },
  { key: 'members', label: 'Members', icon: 'users', managersOnly: false, Component: MembersSection },
  { key: 'plans', label: 'Membership Plans', icon: 'star', managersOnly: false, Component: PlansSection },
  { key: 'groups', label: 'Groups', icon: 'users', managersOnly: false, Component: GroupsSection },
  { key: 'waivers', label: 'Waivers', icon: 'edit', managersOnly: false, Component: WaiversSection },
  { key: 'email', label: 'Email Members', icon: 'link', managersOnly: false, Component: EmailSection },
  { key: 'strikes', label: 'Cancellation Penalties', icon: 'xCircle', managersOnly: false, Component: StrikesSection },
  { key: 'public', label: 'Public Booking', icon: 'link', managersOnly: false, Component: PublicBookingSection },
  { key: 'guests', label: 'Guests', icon: 'users', managersOnly: false, Component: GuestsSection },
  { key: 'clinics', label: 'Events & Clinics', icon: 'calendar', managersOnly: false, Component: ClinicsSection },
  { key: 'instructor-report', label: 'Instructor Report', icon: 'clock', managersOnly: false, Component: InstructorReportSection },
  { key: 'access', label: 'Access Control', icon: 'ban', managersOnly: false, Component: AccessSection },
  { key: 'lobby', label: 'Lobby & Kiosk', icon: 'tv', managersOnly: false, Component: LobbyKioskSection },
  { key: 'rules', label: 'Rules & Restrictions', icon: 'scale', managersOnly: true, Component: RulesSection },
  { key: 'prime', label: 'Prime Time', icon: 'star', managersOnly: true, Component: PrimeTimeSection },
  { key: 'courts', label: 'Courts & Ball Machines', icon: 'grid', managersOnly: true, Component: CourtsSection },
  { key: 'schedulers', label: 'Schedulers', icon: 'calendar', managersOnly: true, Component: SchedulersSection },
  { key: 'instructors', label: 'Instructors', icon: 'users', managersOnly: true, Component: InstructorsSection },
  { key: 'pricing', label: 'Pro Pricing', icon: 'dollar', managersOnly: true, Component: ProPricingSection },
  { key: 'ratings', label: 'Custom Ratings', icon: 'scale', managersOnly: true, Component: RatingsSection },
  { key: 'types', label: 'Reservation Types', icon: 'list', managersOnly: true, Component: TypesSection },
  { key: 'fields', label: 'Custom Fields', icon: 'edit', managersOnly: true, Component: CustomFieldsSection },
  { key: 'details', label: 'Club Details', icon: 'settings', managersOnly: true, Component: DetailsSection },
];

export default function Manage() {
  const c = useColors();
  const wide = useWide();
  const { club } = useClub();
  const { section } = useLocalSearchParams<{ section?: string }>();
  if (!isStaff(club.myRole)) {
    return (
      <Page>
        <Card>
          <Empty icon="ban" title="Staff only">
            Only club staff can manage {club.name}.
          </Empty>
        </Card>
      </Page>
    );
  }
  const manager = isManager(club.myRole);
  const sections = SECTIONS.filter((s) => manager || !s.managersOnly);
  const current = sections.find((s) => s.key === section) ?? (manager && club.courts.length === 0 ? sections.find((x) => x.key === 'courts') : undefined) ?? sections[0];
  const select = (key: string) => router.setParams({ section: key });
  const Section = current.Component;

  if (!wide) {
    return (
      <View style={{ flex: 1 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, padding: 12 }}>
          {sections.map((s) => (
            <Chip key={s.key} icon={s.icon} label={s.label} selected={s.key === current.key} onPress={() => select(s.key)} />
          ))}
        </ScrollView>
        <Page>
          <Section />
        </Page>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', width: '100%', maxWidth: 1400, alignSelf: 'center' }}>
      <ScrollView style={{ width: 250, flexGrow: 0 }} contentContainerStyle={{ padding: 16, gap: 2 }}>
        {sections.map((s) => {
          const on = s.key === current.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => select(s.key)}
              style={({ hovered }: { hovered?: boolean }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: on ? c.tintSoft : hovered ? c.fill : 'transparent',
              })}
            >
              <Icon name={s.icon} size={18} color={on ? c.tint : c.secondaryLabel} />
              <Text style={[type.subheadline, { color: on ? c.label : c.secondaryLabel, fontWeight: on ? '600' : '400' }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ flex: 1 }}>
        <Page maxWidth={860}>
          <Section />
        </Page>
      </View>
    </View>
  );
}
