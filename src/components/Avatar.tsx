import { Text, View } from 'react-native';

/** Initials in a colored circle (an instructor's color). */
export function Avatar({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>
        {name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
          .toUpperCase()}
      </Text>
    </View>
  );
}
