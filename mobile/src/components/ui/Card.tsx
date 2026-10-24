import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

export interface CardProps {
  children: ReactNode;
  /** filled: the grey surface with a hairline; outlined: the page colour with a stronger border. */
  variant?: 'filled' | 'outlined';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

/** A rounded surface; pressable when given onPress. */
export function Card({ children, variant = 'filled', onPress, style, padded = true }: CardProps) {
  const { colors } = useTheme();
  const look =
    variant === 'outlined'
      ? { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderStrong }
      : { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border };
  const base = [styles.card, padded && styles.padded, look, style];
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
