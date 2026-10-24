import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Text } from './Text';

/** A section's title, with a link on the right ("See all"). */
export function SectionHeader({ title, action, style }: { title: string; action?: { label: string; onPress: () => void }; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <Text variant="heading" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {action && (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={{ left: 8, right: 8 }} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
          <Text style={[styles.actionText, { color: colors.brand }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  title: { flexShrink: 1 },
  action: { minHeight: 44, justifyContent: 'center' },
  actionText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
});
