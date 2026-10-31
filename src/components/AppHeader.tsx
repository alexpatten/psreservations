import { Link, router } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { type, useColors } from '@/lib/theme';
import { confirm } from './Dialogs';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';
import { useWide } from './ui';

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/logo.png')}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
      accessibilityLabel="Pickle Spots"
    />
  );
}

/** The bar across the top: logo and app name (or the club's), extra content, and the account menu. */
export function AppHeader({ title, subtitle, children }: { title?: string; subtitle?: string; children?: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const wide = useWide(700);
  const { status, profile, signOut } = useAuth();

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.card + 'E6', borderBottomWidth: 1, borderBottomColor: c.cardBorder }}>
      <View style={{ width: '100%', maxWidth: 1400, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Link href="/" asChild>
          <Pressable accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Logo />
            {wide || !title ? (
              <View>
                <Text style={[type.headline, { color: c.label }]}>Pickle Spots</Text>
                <Text style={[type.caption, { color: c.tint, fontWeight: '600', letterSpacing: 0.6 }]}>RESERVATIONS</Text>
              </View>
            ) : null}
          </Pressable>
        </Link>
        {title ? (
          <View style={{ flex: 1, minWidth: 0, borderLeftWidth: wide ? 1 : 0, borderLeftColor: c.cardBorder, paddingLeft: wide ? 12 : 0 }}>
            <Text style={[type.headline, { color: c.label }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[type.caption, { color: c.secondaryLabel }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {children}
        {status === 'signedIn' ? <NotificationBell /> : null}
        {status === 'signedIn' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account"
            onPress={async () => {
              if (await confirm('Sign out?', profile ? `Signed in as ${profile.firstName} ${profile.lastName} (Player ID ${profile.playerCode}).` : undefined, { confirmLabel: 'Sign Out' })) {
                await signOut();
                router.replace('/');
              }
            }}
            style={({ hovered }: { hovered?: boolean }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: hovered ? c.fill : 'transparent',
            })}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[type.subheadline, { color: c.tint, fontWeight: '700' }]}>
                {profile ? profile.firstName[0] + profile.lastName[0] : '·'}
              </Text>
            </View>
            {wide && profile ? <Text style={[type.subheadline, { color: c.label }]}>{profile.firstName}</Text> : null}
            {wide ? <Icon name="logout" size={16} color={c.secondaryLabel} /> : null}
          </Pressable>
        ) : status === 'signedOut' ? (
          <Link href="/sign-in" asChild>
            <Pressable style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.tint }}>
              <Text style={[type.subheadline, { color: c.onTint, fontWeight: '600' }]}>Sign In</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </View>
  );
}
