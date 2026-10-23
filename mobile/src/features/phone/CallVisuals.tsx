import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, cancelAnimation } from 'react-native-reanimated';

import { Avatar } from '@/components/ui/Avatar';
import { palette } from '@/theme/tokens';

/** The calm dark backdrop of the call screens. */
export function CallBackdrop() {
  return <LinearGradient colors={['#0F1F49', palette.ink950, '#06070A']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />;
}

function Ring({ delay, active }: { delay: number; active: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (active) t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    else {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 300 });
    }
  }, [active, delay, t]);
  const style = useAnimatedStyle(() => ({ opacity: (1 - t.value) * 0.35, transform: [{ scale: 1 + t.value * 0.9 }] }));
  return <Animated.View style={[styles.ring, style]} />;
}

/** The person's avatar, with soft rings rippling out while the call is ringing. */
export function PulsingAvatar({ name, active }: { name: string | null; active: boolean }) {
  return (
    <View style={styles.wrap}>
      <Ring delay={0} active={active} />
      <Ring delay={800} active={active} />
      <Ring delay={1600} active={active} />
      <Avatar name={name} size={120} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: palette.brand400 },
});
