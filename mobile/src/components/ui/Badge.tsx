import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme';
import { fonts, radius } from '@/theme/tokens';
import { Text } from './Text';

/** A small status pill: "Free call", "Active", "Waiting". */
export function Badge({ label, tone = 'neutral', style }: { label: string; tone?: 'neutral' | 'brand' | 'call' | 'danger' | 'warning'; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const look = {
    neutral: [colors.element, colors.textSecondary],
    brand: [colors.brandSoft, colors.brand],
    call: [colors.callSoft, colors.call],
    danger: [colors.dangerSoft, colors.danger],
    warning: [colors.warningSoft, colors.warning],
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: look[0] }, style]}>
      <Text style={[styles.text, { color: look[1] }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { fontFamily: fonts.semibold, fontSize: 12 },
});
