import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme';
import { fonts, radius } from '@/theme/tokens';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'brand' | 'call' | 'danger' | 'warning';

/** A small status pill: "Free call", "Active", "Checking"; `dot` puts a dot in front. */
export function Badge({ label, tone = 'neutral', dot, style }: { label: string; tone?: BadgeTone; dot?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const [bg, fg] = {
    neutral: [colors.element, colors.textSecondary],
    brand: [colors.brandSoft, colors.brand],
    call: [colors.callSoft, colors.callText],
    danger: [colors.dangerSoft, colors.danger],
    warning: [colors.warningSoft, colors.warningText],
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: fg }]} />}
      <Text maxFontSizeMultiplier={1.3} style={[styles.text, { color: fg }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 22, borderRadius: radius.pill, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
});
