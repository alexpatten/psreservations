import { Text, View } from 'react-native';
import { useColors } from '@/lib/theme';

/** A club's initials on Pickle Spots green. */
export function ClubBadge({ name, size = 36 }: { name: string; size?: number }) {
  const c = useColors();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.onTint, fontWeight: '800', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}
