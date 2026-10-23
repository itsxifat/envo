import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

/** A rounded surface; pressable when given onPress. */
export function Card({ children, onPress, style, padded = true }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { colors } = useTheme();
  const base = [styles.card, padded && styles.padded, { backgroundColor: colors.surface }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...base, pressed && { backgroundColor: colors.elementPressed }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  padded: { padding: space.lg },
});
