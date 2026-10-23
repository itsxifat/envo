import { Text as RNText, StyleSheet, type TextProps } from 'react-native';

import { useTheme } from '@/theme/theme';
import { type, type TypeVariant } from '@/theme/tokens';

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: 'default' | 'secondary' | 'tertiary' | 'brand' | 'danger' | 'call' | 'onPrimary' | 'onBrand';
  align?: 'left' | 'center' | 'right';
}

/** Text in the app's type scale and colours. */
export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const color = {
    default: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    brand: colors.brand,
    danger: colors.danger,
    call: colors.call,
    onPrimary: colors.onPrimary,
    onBrand: colors.onBrand,
  }[tone];
  // A style with its own font size but no line height would keep the variant's and clip big text.
  const own = StyleSheet.flatten(style);
  const fit = own?.fontSize && !own.lineHeight ? { lineHeight: Math.round(own.fontSize * 1.25) } : null;
  return <RNText style={[type[variant], { color, textAlign: align }, style, fit]} {...rest} />;
}
