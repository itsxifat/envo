import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { iconStroke, radius, space } from '@/theme/tokens';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Usually an IconTile size="sm" on="surface". */
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
      {chevron && <ChevronRight size={18} color={colors.textTertiary} strokeWidth={iconStroke} />}
    </Pressable>
  );
}

/** Rows grouped on one rounded surface, with hairlines around and between them. */
export function ListGroup({ children, title }: { children: ReactNode; title?: string }) {
  const { colors } = useTheme();
  const items = Children.toArray(children);
  return (
    <View style={styles.group}>
      {title && (
        <Text variant="small" tone="secondary" style={styles.groupTitle}>
          {title}
        </Text>
      )}
      <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  left: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  group: { gap: space.sm },
  groupTitle: { marginLeft: space.lg },
  surface: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
