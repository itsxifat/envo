import { isValidElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, palette, radius } from '@/theme/tokens';
import { Text } from './Text';

type Variant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'call' | 'danger' | 'inverse';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  /** An icon component (drawn in the label's colour and size), or any element. */
  icon?: ReactNode | LucideIcon;
  loading?: boolean;
  /** Only for what truly can't happen now: everything else validates on press. */
  disabled?: boolean;
  /** Fills the width of its container. */
  block?: boolean;
  /** What it sits on: a secondary button on a grey surface takes the page colour so it still shows. */
  on?: 'page' | 'surface';
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<Size, { minHeight: number; paddingHorizontal: number; fontSize: number; icon: number }> = {
  lg: { minHeight: 56, paddingHorizontal: 24, fontSize: 16, icon: 20 },
  md: { minHeight: 44, paddingHorizontal: 18, fontSize: 15, icon: 18 },
  sm: { minHeight: 36, paddingHorizontal: 14, fontSize: 14, icon: 16 },
};

/** A lucide icon (a component), as opposed to an element someone already drew. */
const isIconComponent = (x: unknown): x is LucideIcon => typeof x === 'function' || (typeof x === 'object' && x !== null && !isValidElement(x) && '$$typeof' in x);

/**
 * Pill buttons: ink for the main action, brand blue, soft grey, plain text, green call, red, and
 * white for night surfaces. Pressed ones darken and shrink a little; disabled ones turn grey.
 */
export function Button({ title, onPress, variant = 'primary', size = 'lg', icon, loading, disabled, block, on = 'page', style }: ButtonProps) {
  const { colors, dark } = useTheme();
  const look: Record<Variant, { bg: string; fg: string; pressed: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary, pressed: colors.primaryPressed },
    brand: { bg: colors.brandFill, fg: colors.onBrand, pressed: palette.brand700 },
    secondary: { bg: on === 'surface' && !dark ? colors.background : colors.element, fg: colors.text, pressed: colors.elementPressed },
    ghost: { bg: 'transparent', fg: colors.text, pressed: colors.element },
    call: { bg: colors.call, fg: palette.white, pressed: colors.callPressed },
    danger: { bg: palette.red600, fg: palette.white, pressed: palette.red700 },
    inverse: { bg: palette.white, fg: palette.ink950, pressed: palette.grey200 },
  };
  // A disabled button is grey with a readable label, never a faded slab. A ghost one stays see-through,
  // and a white one on a night surface goes glassy.
  const off =
    variant === 'ghost'
      ? { bg: 'transparent', fg: colors.onDisabled }
      : variant === 'inverse'
        ? { bg: 'rgba(255,255,255,0.16)', fg: 'rgba(255,255,255,0.64)' }
        : { bg: colors.disabled, fg: colors.onDisabled };
  const l = disabled ? { ...off, pressed: off.bg } : look[variant];
  const s = SIZES[size];
  const Icon = isIconComponent(icon) ? icon : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      // The small one is 36 high: its touch area still reaches 44.
      hitSlop={size === 'sm' ? 4 : undefined}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        { minHeight: s.minHeight, paddingHorizontal: s.paddingHorizontal, backgroundColor: pressed ? l.pressed : l.bg },
        block && styles.block,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {/* While loading the label stays (unseen) so the button keeps its width. */}
      <View style={[styles.row, loading && styles.hidden]}>
        {Icon ? <Icon size={s.icon} color={l.fg} strokeWidth={size === 'sm' ? 2 : iconStroke} /> : (icon as ReactNode)}
        <Text maxFontSizeMultiplier={1.3} style={[styles.label, { fontSize: s.fontSize, lineHeight: Math.round(s.fontSize * 1.3), color: l.fg }]}>
          {title}
        </Text>
      </View>
      {loading && <ActivityIndicator color={l.fg} style={StyleSheet.absoluteFill} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  block: { alignSelf: 'stretch' },
  pressed: { transform: [{ scale: 0.98 }] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
  hidden: { opacity: 0 },
  label: { fontFamily: fonts.semibold, textAlign: 'center' },
});
