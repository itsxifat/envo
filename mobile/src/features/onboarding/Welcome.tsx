import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { PhoneCall } from 'lucide-react-native';

import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatBdt } from '@/lib/format';
import { useSession } from '@/state/session';
import { AlwaysDark } from '@/theme/theme';
import { fonts, gradients, palette, radius, space, type } from '@/theme/tokens';

/** The first screen: what Envo Phone is, and the two ways in. Always dark: it is the brand's moment. */
export function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { config, minActivation } = useSession();
  const reduce = useReducedMotion();
  const closed = config ? !config.signups : false;
  // Calls to Envo numbers are free only when Enfinito makes them so.
  const free = !!config?.free_onnet;
  const prefix = config?.prefix ? `${config.prefix} ` : '';
  const float = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    float.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(float);
  }, [float, reduce]);
  const floating = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * float.value }, { rotate: `${-2 + float.value}deg` }] }));

  const steps = [
    'Create your account',
    config?.selfie_check === false ? 'Register with your NID and a selfie' : 'Register with your NID and a live selfie',
    `Recharge ${formatBdt(minActivation)} to start calling`,
  ];

  return (
    <AlwaysDark>
      <View style={styles.root}>
        <StatusBar style="light" />
        <LinearGradient {...gradients.welcome} style={StyleSheet.absoluteFill} />
        {/* Scrolls only when a small phone (or large text) can't fit it all. */}
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}
        >
          <Animated.View entering={FadeInDown.duration(500)} style={styles.brand}>
            <LogoMark size={44} />
            <Text style={styles.brandName}>envo</Text>
          </Animated.View>

          <View style={styles.hero}>
            {/* A picture of what they get, not their number: screen readers skip it. */}
            <Animated.View entering={FadeInDown.delay(120).duration(600)} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Animated.View style={[styles.numberCard, floating]}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardLabel}>Your number</Text>
                  <View style={styles.live}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>Active</Text>
                  </View>
                </View>
                <Text style={styles.cardNumber} numberOfLines={1} adjustsFontSizeToFit>
                  09639 437 015
                </Text>
                <View style={styles.cardBottom}>
                  <PhoneCall size={14} color={WHITE_64} strokeWidth={2} />
                  <Text style={styles.cardHint}>{free ? 'Calls to Envo numbers are free' : 'Call any phone in Bangladesh'}</Text>
                </View>
              </Animated.View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(220).duration(600)}>
              <Text accessibilityRole="header" style={styles.headline}>
                Your own phone number. Calls from anywhere.
              </Text>
              <Text style={styles.sub}>
                {free
                  ? `Get your own ${prefix}number and call any phone in Bangladesh. Calls to friends on Envo are free.`
                  : `Get your own ${prefix}number and call any phone in Bangladesh.`}
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(320).duration(600)} style={styles.steps}>
              {steps.map((s, i) => (
                <View key={i} style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.stepNumberText}>
                      {i + 1}
                    </Text>
                  </View>
                  <Text style={styles.stepText}>{s}</Text>
                </View>
              ))}
            </Animated.View>
          </View>

          <Animated.View entering={FadeInDown.delay(420).duration(600)} style={styles.actions}>
            {closed && <Text style={styles.closed}>New numbers are not available right now. Please check back soon.</Text>}
            <Button title="Get my number" onPress={() => router.push('/sign-up')} disabled={closed} block />
            <Button title="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} block />
          </Animated.View>
        </ScrollView>
      </View>
    </AlwaysDark>
  );
}

// Text on the night background never goes below 64% white.
const WHITE_64 = 'rgba(255,255,255,0.64)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950 },
  content: { flexGrow: 1, paddingHorizontal: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: '#FFFFFF', letterSpacing: -0.5 },
  // Grows to centre itself when there's room, keeps its own height (and scrolls) when there isn't.
  hero: { flexGrow: 1, justifyContent: 'center', gap: space.xl, paddingVertical: space.xl },
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
  cardLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: WHITE_64 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(34,197,94,0.18)', paddingHorizontal: 10, minHeight: 24, borderRadius: radius.pill },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.green300 },
  liveText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: palette.green300 },
  cardNumber: { ...type.phone, color: '#FFFFFF' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: WHITE_64, flexShrink: 1 },
  headline: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: '#FFFFFF' },
  sub: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: 'rgba(255,255,255,0.72)', marginTop: space.md },
  steps: { gap: space.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(97,143,250,0.14)', alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16, color: palette.brand400, fontVariant: ['tabular-nums'] },
  stepText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: 'rgba(255,255,255,0.86)', flex: 1 },
  actions: { gap: space.sm },
  closed: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginBottom: space.sm },
});
