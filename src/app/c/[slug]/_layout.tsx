import { Redirect, router, Slot, useLocalSearchParams, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Icon, type IconName } from '@/components/Icon';
import { Empty, ErrorText, Loading, Page } from '@/components/ui';
import { canViewReports, isStaff, type Club } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ClubProvider, useClubState } from '@/lib/club-context';
import { useLessons } from '@/lib/lessons';
import { type, useColors } from '@/lib/theme';

export default function ClubLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { status } = useAuth();
  const pathname = usePathname();
  if (status === 'signedOut') return <Redirect href={`/sign-in?next=${encodeURIComponent(pathname)}`} />;
  return (
    <ClubProvider slug={String(slug)}>
      <ClubShell />
    </ClubProvider>
  );
}

function ClubShell() {
  const { club, error } = useClubState();
  if (!club) return <ClubLoading error={error} />;
  return <LoadedClub club={club} />;
}

function ClubLoading({ error }: { error: string | null }) {
  return (
    <View style={{ flex: 1 }}>
      <AppHeader />
      <Page>
        {error ? (
          <>
            <ErrorText error={error} />
            <Empty icon="search" title="Club not found">
              Check the link, or find the club from the home page.
            </Empty>
          </>
        ) : (
          <Loading />
        )}
      </Page>
    </View>
  );
}

function LoadedClub({ club }: { club: Club }) {
  const staff = isStaff(club.myRole);
  const { data: lessons } = useLessons(club.id);
  const [reports, setReports] = useState(false);
  useEffect(() => {
    if (staff) canViewReports(club.id).then(setReports, () => setReports(false));
  }, [club.id, staff]);
  const base = `/c/${club.slug}`;
  const tabs: { href: string; label: string; icon: IconName; show: boolean }[] = [
    { href: base, label: 'Schedule', icon: 'grid', show: true },
    { href: `${base}/events`, label: 'Events', icon: 'calendar', show: true },
    { href: `${base}/leagues`, label: 'Leagues', icon: 'star', show: true },
    { href: `${base}/lessons`, label: 'Lessons', icon: 'ball', show: !!lessons && (lessons.instructors.length > 0 || staff) },
    { href: `${base}/mine`, label: 'My Reservations', icon: 'list', show: !!club.myRole },
    { href: `${base}/membership`, label: 'Membership', icon: 'star', show: !!club.myRole },
    { href: `${base}/billing`, label: 'Billing', icon: 'dollar', show: !!club.myRole },
    { href: `${base}/teach`, label: 'Teaching', icon: 'checkCircle', show: !!lessons?.myInstructorId },
    { href: `${base}/shop`, label: 'Pro Shop', icon: 'dollar', show: staff },
    { href: `${base}/pulse`, label: 'Pulse', icon: 'grid', show: reports },
    { href: `${base}/manage`, label: 'Manage', icon: 'settings', show: staff },
  ];
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={club.name} subtitle={club.address ?? undefined}>
        {staff ? <StaffLinks slug={club.slug} lobbyToken={club.lobbyToken} /> : null}
      </AppHeader>
      <TabBar tabs={tabs.filter((t) => t.show)} />
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
    </View>
  );
}

function TabBar({ tabs }: { tabs: { href: string; label: string; icon: IconName }[] }) {
  const c = useColors();
  const pathname = usePathname();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: c.card + 'B3' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4, maxWidth: 1400, width: '100%', alignSelf: 'center' }}>
        {tabs.map((t) => {
          const active = t.href === pathname || (t.href.split('/').length > 3 && pathname.startsWith(t.href));
          return (
            <Pressable
                key={t.href}
                accessibilityRole="link"
                onPress={() => router.navigate(t.href as never)}
                style={({ hovered }: { hovered?: boolean }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderBottomWidth: 2.5,
                  borderBottomColor: active ? c.tint : 'transparent',
                  opacity: hovered && !active ? 0.75 : 1,
                })}
              >
                <Icon name={t.icon} size={16} color={active ? c.tint : c.secondaryLabel} />
                <Text style={[type.subheadline, { color: active ? c.label : c.secondaryLabel, fontWeight: active ? '600' : '400' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Kiosk and lobby open in their own tab: they're meant to be left running on a tablet or TV. */
function StaffLinks({ slug, lobbyToken }: { slug: string; lobbyToken: string | null }) {
  const c = useColors();
  const open = (path: string) => {
    if (Platform.OS === 'web') window.open(path, '_blank', 'noopener');
  };
  if (Platform.OS !== 'web') return null;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      <Pressable accessibilityLabel="Open kiosk" onPress={() => open(`/kiosk/${slug}`)} style={{ padding: 8, borderRadius: 8 }}>
        <Icon name="tablet" color={c.secondaryLabel} />
      </Pressable>
      {lobbyToken ? (
        <Pressable accessibilityLabel="Open lobby view" onPress={() => open(`/lobby/${lobbyToken}`)} style={{ padding: 8, borderRadius: 8 }}>
          <Icon name="tv" color={c.secondaryLabel} />
        </Pressable>
      ) : null}
    </View>
  );
}
