import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type, useColors } from '@/lib/theme';
import { Logo } from './AppHeader';

/** The public booking pages' header: the club, and that it's Pickle Spots underneath. No account menu. */
export function PublicHeader({ name, address }: { name: string; address?: string | null }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.card + 'E6', borderBottomWidth: 1, borderBottomColor: c.cardBorder }}>
      <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Logo size={40} />
        <View style={{ flex: 1 }}>
          <Text style={[type.headline, { color: c.label }]} numberOfLines={1}>
            {name}
          </Text>
          {address ? (
            <Text style={[type.caption, { color: c.secondaryLabel }]} numberOfLines={1}>
              {address}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
