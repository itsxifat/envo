import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { Card } from './Card';
import { Text } from './Text';

export type StepState = 'done' | 'now' | 'working' | 'todo';

export interface Step {
  title: string;
  caption?: string;
  /** done; now: the person's turn; working: Enfinito's turn; todo: later. */
  state: StepState;
}

const SPOKEN: Record<StepState, string> = { done: 'Done', now: 'Now', working: 'In progress', todo: 'Next' };

/** A dot that slowly breathes while something is being worked on (still when motion is reduced). */
export function PulseDot({ color, size = 8, pulse = true }: { color: string; size?: number; pulse?: boolean }) {
  const reduce = useReducedMotion();
  const opacity = useSharedValue(1);
  const on = pulse && !reduce;
  useEffect(() => {
    if (on) opacity.value = withRepeat(withTiming(0.4, { duration: 900 }), -1, true);
    else {
      cancelAnimation(opacity);
      opacity.value = 1;
    }
    return () => cancelAnimation(opacity);
  }, [on, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** Where something stands, one step a row: what's done, whose turn it is, what comes next. */
export function Steps({ title, steps }: { title?: string; steps: Step[] }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.card}>
      {title && (
        <Text variant="heading" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      )}
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <View key={i} accessible accessibilityLabel={`${SPOKEN[s.state]}: ${s.title}${s.caption ? `. ${s.caption}` : ''}`} style={[styles.row, !last && styles.rowGap]}>
            <View style={styles.rail}>
              <Node state={s.state} />
              {!last && <View style={[styles.connector, { backgroundColor: s.state === 'done' ? colors.call : colors.track }]} />}
            </View>
            <View style={[styles.text, !last && styles.textGap]}>
              <Text variant="bodyMedium" tone={s.state === 'todo' ? 'secondary' : 'default'}>
                {s.title}
              </Text>
              {s.caption ? (
                <Text variant="caption" tone="secondary">
                  {s.caption}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function Node({ state }: { state: StepState }) {
  const { colors } = useTheme();
  if (state === 'done') {
    return (
      <View style={[styles.node, { backgroundColor: colors.call }]}>
        <Check size={14} color="#FFFFFF" strokeWidth={3} />
      </View>
    );
  }
  const ring = state === 'now' ? colors.brand : state === 'working' ? colors.warning : colors.track;
  return (
    <View style={[styles.node, styles.ring, { borderColor: ring }]}>
      {state === 'now' && <PulseDot color={colors.brand} pulse={false} />}
      {state === 'working' && <PulseDot color={colors.warning} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20 },
  title: { marginBottom: space.lg },
  row: { flexDirection: 'row', gap: space.md },
  rowGap: { minHeight: 52 },
  rail: { width: 24, alignItems: 'center' },
  node: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2 },
  // Runs from under this node to the top of the next one.
  connector: { flex: 1, width: 2, minHeight: 8 },
  text: { flex: 1, gap: 2 },
  textGap: { paddingBottom: space.md },
});
