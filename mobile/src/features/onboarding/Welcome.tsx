import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { PhoneCall, ShieldCheck, Sparkles } from 'lucide-react-native';

import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useSession } from '@/state/session';
import { AlwaysDark } from '@/theme/theme';
import { fonts, palette, radius, space } from '@/theme/tokens';

/** The first screen: what Envo Phone is, and the two ways in. Always dark: it is the brand's moment. */
export function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { config } = useSession();
  const closed = config ? !config.signups : false;
  // Calls to Envo numbers are free only when Enfinito makes them so.
  const free = !!config?.free_onnet;
  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [float]);
  const floating = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * float.value }, { rotate: `${-2 + float.value}deg` }] }));

  return (
    <AlwaysDark>
      <View style={styles.root}>
        <StatusBar style="light" />
        <LinearGradient colors={['#14306f', palette.ink950, palette.ink950]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.content, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}>
          <Animated.View entering={FadeInDown.duration(500)} style={styles.brand}>
            <LogoMark size={44} />
            <Text style={styles.brandName}>envo</Text>
          </Animated.View>

          <View style={styles.hero}>
            <Animated.View entering={FadeInDown.delay(120).duration(600)}>
              <Animated.View style={[styles.numberCard, floating]}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardLabel}>Your number</Text>
                  <View style={styles.live}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>Active</Text>
                  </View>
                </View>
                <Text style={styles.cardNumber}>09639 437 015</Text>
                <View style={styles.cardBottom}>
                  <PhoneCall size={14} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.cardHint}>{free ? 'Calls to Envo numbers are free' : 'Call any phone in Bangladesh'}</Text>
                </View>
              </Animated.View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(220).duration(600)}>
              <Text style={styles.headline}>Your own phone number. Calls from anywhere.</Text>
              <Text style={styles.sub}>{free ? 'Get a number in minutes, call any phone in Bangladesh, and call friends on Envo for free.' : 'Get a number in minutes and call any phone in Bangladesh.'}</Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(320).duration(600)} style={styles.points}>
              <Point icon={<Sparkles size={16} color={palette.brand400} />} text="A new number, picked for you" />
              <Point icon={<ShieldCheck size={16} color={palette.brand400} />} text="Registered in your name, as the BTRC requires" />
            </Animated.View>
          </View>

          <Animated.View entering={FadeInDown.delay(420).duration(600)} style={styles.actions}>
            {closed && <Text style={styles.closed}>New numbers are not available right now. Please check back soon.</Text>}
            <Button title="Get my number" onPress={() => router.push('/sign-up')} disabled={closed} block />
            <Button title="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} block />
          </Animated.View>
        </View>
      </View>
    </AlwaysDark>
  );
}

function Point({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>{icon}</View>
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950 },
  content: { flex: 1, paddingHorizontal: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { fontFamily: fonts.bold, fontSize: 24, color: '#FFFFFF', letterSpacing: -0.8 },
  hero: { flex: 1, justifyContent: 'center', gap: space.xl },
  numberCard: {
    alignSelf: 'flex-start',
    width: '86%',
    borderRadius: radius.xl,
    padding: space.xl,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(34,197,94,0.16)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.green400 },
  liveText: { fontFamily: fonts.semibold, fontSize: 12, color: palette.green400 },
  cardNumber: { fontFamily: fonts.bold, fontSize: 30, color: '#FFFFFF', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHint: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  headline: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1.1, color: '#FFFFFF' },
  sub: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: 'rgba(255,255,255,0.66)', marginTop: space.md },
  points: { gap: space.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pointIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(97,143,250,0.14)', alignItems: 'center', justifyContent: 'center' },
  pointText: { fontFamily: fonts.medium, fontSize: 15, color: 'rgba(255,255,255,0.86)', flex: 1 },
  actions: { gap: space.sm },
  closed: { fontFamily: fonts.medium, fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginBottom: space.sm },
});
