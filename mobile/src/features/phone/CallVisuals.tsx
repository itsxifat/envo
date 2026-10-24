import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/ui/Avatar';
import { gradients, palette, space } from '@/theme/tokens';

/** The calm dark backdrop of the call screens. */
export function CallBackdrop() {
  return <LinearGradient {...gradients.call} style={StyleSheet.absoluteFill} />;
}

const AVATAR = 112;
/** The room the avatar and its rings take. */
const AVATAR_BOX = AVATAR * 2;

/**
 * The space above the avatar in the middle of a call screen this tall: 48, less on a short phone, and
 * centred when even its rings don't fit (they would run into the buttons). 48 until it is measured.
 */
export function avatarTop(middle: number): number {
  if (!middle) return space.xxxl;
  const room = middle - AVATAR_BOX;
  return room >= 0 ? Math.min(space.xxxl, room) : room / 2;
}

/** One ring that grows out from the avatar and fades; hidden while the call isn't ringing. */
function Ring({ delay, active }: { delay: number; active: boolean }) {
  // 1 is fully grown and faded out, so a ring that isn't ringing shows nothing.
  const t = useSharedValue(1);
  useEffect(() => {
    if (active) {
      t.value = withDelay(delay, withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) })), -1, false));
    } else {
      cancelAnimation(t);
      t.value = withTiming(1, { duration: 300 });
    }
    return () => cancelAnimation(t);
  }, [active, delay, t]);
  const style = useAnimatedStyle(() => ({ opacity: (1 - t.value) * 0.35, transform: [{ scale: 1 + t.value * 0.9 }] }));
  return <Animated.View style={[styles.ring, style]} />;
}

/** The person's avatar, with soft rings rippling out while the call is ringing (still ones when motion is reduced). */
export function PulsingAvatar({ name, active }: { name: string | null; active: boolean }) {
  const reduce = useReducedMotion();
  return (
    <View style={styles.wrap}>
      {reduce ? (
        active && (
          <>
            <View style={[styles.ring, { opacity: 0.12, transform: [{ scale: 1.6 }] }]} />
            <View style={[styles.ring, { opacity: 0.22, transform: [{ scale: 1.3 }] }]} />
          </>
        )
      ) : (
        <>
          <Ring delay={0} active={active} />
          <Ring delay={800} active={active} />
          <Ring delay={1600} active={active} />
        </>
      )}
      <Avatar name={name} size={AVATAR} onDark />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: AVATAR_BOX, height: AVATAR_BOX, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 2, borderColor: palette.brand400 },
});
