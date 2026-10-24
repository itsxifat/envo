import { StyleSheet, View } from 'react-native';
import { User } from 'lucide-react-native';

import { initials } from '@/lib/format';
import { useTheme } from '@/theme/theme';
import { fonts, iconStroke } from '@/theme/tokens';
import { Text } from './Text';

/** Soft background tints for initials (teal, green, orange, blue), picked from the name so a person keeps the same colour. */
const TINTS = [
  ['#E6F6F8', '#0E7490'],
  ['#E8F7EE', '#15803D'],
  ['#FEF1E7', '#C2410C'],
  ['#E8EEFF', '#1F57EB'],
] as const;

function tint(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // The low bits of this hash repeat a lot between names; higher ones spread four tints better.
  return TINTS[(h >>> 8) % TINTS.length]!;
}

/**
 * A person's initials on a tint, or a plain grey person when there is no name (an unknown number).
 * `onDark` is the glassy version for the call screens.
 */
export function Avatar({ name, size = 44, onDark }: { name?: string | null; size?: number; onDark?: boolean }) {
  const { dark, colors } = useTheme();
  const label = name ? initials(name) : '';
  const known = !!label && label !== '#';
  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (onDark) {
    return (
      <View style={[styles.circle, styles.onDark, circle]}>
        {known ? (
          <Text style={{ fontFamily: fonts.semibold, fontSize: size * 0.36, color: '#FFFFFF' }}>{label}</Text>
        ) : (
          <User size={size * 0.46} color="rgba(255,255,255,0.8)" strokeWidth={iconStroke} />
        )}
      </View>
    );
  }
  if (!known) {
    return (
      <View style={[styles.circle, circle, { backgroundColor: colors.element }]}>
        <User size={size * 0.46} color={colors.textSecondary} strokeWidth={iconStroke} />
      </View>
    );
  }
  const [bg, fg] = tint(name!);
  return (
    <View style={[styles.circle, circle, { backgroundColor: dark ? `${fg}33` : bg }]}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: size * 0.38, color: dark ? '#FFFFFF' : fg }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  onDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
});
