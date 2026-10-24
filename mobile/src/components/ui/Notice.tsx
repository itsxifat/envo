import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, radius, space } from '@/theme/tokens';
import { Text } from './Text';

export interface NoticeProps {
  tone: 'neutral' | 'brand' | 'warning' | 'danger';
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  /** One line: the title only, with the action on the right (strips at the top of a screen). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A boxed message: a payment being checked, an error, "no internet". The title and body stay ink and
 * grey on every tone (coloured body text is too faint to read); the icon carries the colour.
 */
export function Notice({ tone, icon: Icon, title, body, action, compact, style }: NoticeProps) {
  const { colors } = useTheme();
  const look = {
    neutral: { bg: colors.surface, fg: colors.textSecondary },
    brand: { bg: colors.brandSoft, fg: colors.brand },
    warning: { bg: colors.warningSoft, fg: colors.warningText },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  const box = [
    styles.box,
    compact && styles.compact,
    { backgroundColor: look.bg },
    tone === 'neutral' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    style,
  ];
  const actionButton = action && (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={compact ? { left: 8, right: 8 } : undefined}
      style={({ pressed }) => [compact ? styles.actionCompact : styles.action, pressed && styles.pressed]}
    >
      <Text style={[styles.actionText, { color: colors.brand }]}>{action.label}</Text>
    </Pressable>
  );
  return (
    <View accessibilityLiveRegion={tone === 'danger' ? 'polite' : undefined} style={box}>
      {Icon && <Icon size={20} color={look.fg} strokeWidth={iconStroke} style={compact ? undefined : styles.icon} />}
      <View style={[styles.text, compact && styles.textCompact]}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {!compact && body ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
        ) : null}
        {!compact && actionButton}
      </View>
      {compact && actionButton}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, borderRadius: radius.md, padding: space.lg },
  compact: { alignItems: 'center', paddingVertical: 10 },
  icon: { marginTop: 1 },
  text: { flex: 1, gap: 2 },
  textCompact: { gap: 0 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  // Reaches into the strip's padding, so the strip stays slim and the target stays 44 high.
  actionCompact: { minHeight: 44, marginVertical: -10, justifyContent: 'center' },
  actionText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.6 },
});
