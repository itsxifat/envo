import { StyleSheet, View } from 'react-native';
import { User } from 'lucide-react-native';

import { initials } from '@/lib/format';
import { useTheme } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Text } from './Text';

/** Soft background tints for initials, picked from the name so a person keeps the same colour. */
const TINTS = [
  ['#E8EEFF', '#1F57EB'],
  ['#E8F7EE', '#15803D'],
  ['#FEF1E7', '#C2410C'],
  ['#F3EBFE', '#7C3AED'],
  ['#FDEBF1', '#BE185D'],
  ['#E6F6F8', '#0E7490'],
] as const;

function tint(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function Avatar({ name, size = 44 }: { name?: string | null; size?: number }) {
  const { dark } = useTheme();
  const label = name ? initials(name) : '';
  const [bg, fg] = tint(name ?? '?');
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? `${fg}33` : bg }]}>
      {label && label !== '#' ? (
        <Text style={{ fontFamily: fonts.semibold, fontSize: size * 0.38, color: dark ? '#FFFFFF' : fg }}>{label}</Text>
      ) : (
        <User size={size * 0.46} color={dark ? '#FFFFFF' : fg} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
