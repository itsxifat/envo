import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
}

/** One row of a list: something on the left, a title and subtitle, and an accessory. */
export function ListRow({ title, subtitle, left, right, onPress, chevron, danger }: ListRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elementPressed }]}
    >
      {left && <View style={styles.left}>{left}</View>}
      <View style={styles.text}>
        <Text variant="bodyMedium" tone={danger ? 'danger' : 'default'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {chevron && <ChevronRight size={20} color={colors.textTertiary} />}
    </Pressable>
  );
}

/** Rows grouped on one rounded surface, with hairlines between them. */
export function ListGroup({ children, title }: { children: ReactNode; title?: string }) {
  const { colors } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={styles.group}>
      {title && (
        <Text variant="small" tone="secondary" style={styles.groupTitle}>
          {title}
        </Text>
      )}
      <View style={[styles.surface, { backgroundColor: colors.surface }]}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 && <View style={[styles.hairline, { backgroundColor: colors.border }]} />}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14, minHeight: 60 },
  left: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  group: { gap: space.sm },
  groupTitle: { marginLeft: space.lg, textTransform: 'none' },
  surface: { borderRadius: radius.lg, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
