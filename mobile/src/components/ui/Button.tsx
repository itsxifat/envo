import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme/theme';
import { fonts, radius } from '@/theme/tokens';
import { Text } from './Text';

type Variant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'call' | 'danger';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Fills the width of its container. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Pill buttons: ink for the main action, brand blue, soft grey, plain text, green call, red. */
export function Button({ title, onPress, variant = 'primary', size = 'lg', icon, loading, disabled, block, style }: ButtonProps) {
  const { colors } = useTheme();
  const look: Record<Variant, { bg: string; fg: string; pressed: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary, pressed: colors.primary },
    brand: { bg: colors.brand, fg: colors.onBrand, pressed: colors.brand },
    secondary: { bg: colors.element, fg: colors.text, pressed: colors.elementPressed },
    ghost: { bg: 'transparent', fg: colors.text, pressed: colors.element },
    call: { bg: colors.call, fg: '#FFFFFF', pressed: colors.call },
    danger: { bg: colors.danger, fg: '#FFFFFF', pressed: colors.danger },
  };
  const l = look[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        block && styles.block,
        { backgroundColor: pressed ? l.pressed : l.bg, opacity: off ? 0.45 : pressed && variant !== 'secondary' && variant !== 'ghost' ? 0.88 : 1 },
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={l.fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.label, size === 'lg' ? styles.labelLg : styles.labelMd, { color: l.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  lg: { height: 56 },
  md: { height: 44, paddingHorizontal: 18 },
  block: { alignSelf: 'stretch' },
  pressed: { transform: [{ scale: 0.985 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.semibold },
  labelLg: { fontSize: 16 },
  labelMd: { fontSize: 15 },
});
