import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/theme';

/** Where you are in getting a number: account, email, details, photos, number. */
export function StepDots({ step, count = 5 }: { step: number; count?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: i <= step ? colors.brand : colors.element, flex: i === step ? 2 : 1 }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot: { height: 5, borderRadius: 3 },
});
