import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

/** How long the sheet takes to slide away; the modal closes after it. */
const OUT_MS = 200;

/**
 * A panel that slides up from the bottom over a dimmed screen. It closes on a tap outside or Android's
 * back. It can't be dragged, so it has no grip. The slide and the dimming are driven by one animated
 * value: Reanimated's entering/exiting animations end in the wrong place inside a Modal's own window.
 */
export function Sheet({ visible, onClose, title, subtitle, children }: SheetProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduce = useReducedMotion();
  // The modal stays up while the panel slides away.
  const [mounted, setMounted] = useState(visible);
  // 0: hidden below the screen, 1: in place.
  const shown = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      shown.value = reduce ? withTiming(1, { duration: 0 }) : withSpring(1, { damping: 20, stiffness: 220, overshootClamping: true });
      return;
    }
    shown.value = withTiming(0, { duration: reduce ? 0 : OUT_MS, easing: Easing.in(Easing.cubic) });
    const t = setTimeout(() => setMounted(false), reduce ? 0 : OUT_MS + 20);
    return () => clearTimeout(t);
  }, [visible, reduce, shown]);

  const dim = useAnimatedStyle(() => ({ opacity: shown.value }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * height }] }));

  return (
    <Modal visible={visible || mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, dim]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.panel, { backgroundColor: dark ? colors.surface : colors.background, paddingBottom: insets.bottom + space.lg }, slide]}>
          {title && (
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
          )}
          {subtitle && (
            <Text variant="caption" tone="secondary" style={styles.subtitle}>
              {subtitle}
            </Text>
          )}
          <View style={title || subtitle ? styles.content : undefined}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(11,13,18,0.5)' },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.xl, paddingTop: space.xl },
  subtitle: { marginTop: 2 },
  content: { marginTop: space.lg },
});
