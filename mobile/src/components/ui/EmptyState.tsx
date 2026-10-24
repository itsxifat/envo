import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { space } from '@/theme/tokens';
import { Button } from './Button';
import { IconTile, type IconTileTone } from './IconTile';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: LucideIcon;
  tone?: IconTileTone;
  title: string;
  body?: string;
  action?: { title: string; onPress: () => void };
  /** Shown under the text, e.g. a card with details. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Nothing to show yet (no calls, no history), or a whole-screen notice: an icon, a title, a line of help. */
export function EmptyState({ icon, tone = 'neutral', title, body, action, children, style }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, style]}>
      <IconTile icon={icon} size="lg" tone={tone} />
      <Text variant="heading" align="center" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text tone="secondary" align="center" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {children}
      {action && <Button title={action.title} onPress={action.onPress} variant="secondary" size="md" style={styles.action} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 72 },
  title: { marginTop: space.lg },
  body: { marginTop: space.xs, maxWidth: 300 },
  action: { marginTop: space.lg },
});
