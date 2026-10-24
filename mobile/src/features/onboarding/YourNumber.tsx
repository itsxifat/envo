import { useCallback } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Clock3, PartyPopper, Sparkles, type LucideIcon } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { IconTile } from '@/components/ui/IconTile';
import { Notice } from '@/components/ui/Notice';
import { NumberCard } from '@/components/ui/NumberCard';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatBdt } from '@/lib/format';
import { holdLine } from '@/lib/stage';
import { useSession } from '@/state/session';
import { space } from '@/theme/tokens';

const home = () => router.replace('/');
/** Activate opens over Home, so coming back after paying (or without paying) lands on Home, not here. */
const activate = () => {
  router.replace('/');
  router.push('/activate');
};

/** The moment they get their number: shown big, ready to copy and share, with what comes next. */
export function YourNumberScreen() {
  const { account, config, minActivation } = useSession();
  const number = account?.number ?? null;
  // Paid already (the first registration came back and was sent again): nothing more to pay.
  const paid = account?.stage === 'registering' || account?.stage === 'active';
  // A first recharge waits for support's check: paying again would be refused.
  const review = !paid && !!account?.paymentInReview;
  const paused = !!config && !config.payment.online;
  const min = formatBdt(minActivation);
  const hold = holdLine(account);

  // Back goes home, not to the form that was just sent. Only while this screen shows: it stays under
  // Activate and Home, and back there must work as usual.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        home();
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  if (!number) {
    return (
      <Screen scroll footer={<Button title="Go to home" onPress={home} block />}>
        <View style={styles.center}>
          <Animated.View entering={ZoomIn.springify().damping(12)}>
            <IconTile icon={Clock3} size="lg" tone="warning" />
          </Animated.View>
          <Text variant="title" align="center" accessibilityRole="header">
            We're picking your number
          </Text>
          <Text tone="secondary" align="center">
            {paid ? "Your details are with us. We'll email you when your number is ready." : "Your details are with us. We'll email you when your number is ready to activate."}
          </Text>
        </View>
      </Screen>
    );
  }

  // Blue when it's the person's turn, amber while Enfinito works on it.
  const next: { tone: 'brand' | 'warning'; icon: LucideIcon; title: string; body: string } = paid
    ? {
        tone: 'warning',
        icon: Clock3,
        title: 'Next: we register it in your name',
        body: "Your first recharge is already on your balance, so there's nothing more to pay. We register the number in your name now, usually within a few hours.",
      }
    : review
      ? { tone: 'warning', icon: Clock3, title: "We're checking your payment", body: 'Usually a few minutes. Nothing more to pay.' }
      : {
          tone: 'brand',
          icon: Sparkles,
          title: 'Next: activate it',
          body: `Pay ${min} or more as your first recharge (bKash, Nagad, Rocket or card). All of it becomes your calling balance. Then we register the number in your name, usually within a few hours.${hold ? ` ${hold.text}` : ''}`,
        };

  const footer = paid || review ? (
    <Button title="Go to home" onPress={home} block />
  ) : paused ? (
    <>
      <Button title="Payments are paused for now" disabled block />
      <Text variant="caption" tone="secondary" align="center">
        Please try again in a little while.
      </Text>
      <Button title="Later" variant="ghost" onPress={home} block />
    </>
  ) : (
    <>
      <Button title={`Activate with ${min}`} onPress={activate} block />
      <Button title="Later" variant="ghost" onPress={home} block />
    </>
  );

  return (
    <Screen scroll footer={footer}>
      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(12)}>
          <IconTile icon={PartyPopper} size="lg" tone="brand" />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(150)}>
          <Text variant="title" align="center" accessibilityRole="header">
            This is your number
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(200)} style={styles.stretch}>
          <NumberCard
            number={number}
            status={paid ? { label: 'Being registered', tone: 'waiting', pulse: true } : review ? { label: 'Checking payment', tone: 'waiting', pulse: true } : { label: 'Not active yet', tone: 'waiting' }}
            share
            revealDigits
          />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(800)} style={styles.stretch}>
          <Notice tone={next.tone} icon={next.icon} title={next.title} body={next.body} />
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Centred when there's room; on a small phone it keeps its height and the page scrolls.
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.xl },
  stretch: { alignSelf: 'stretch' },
});
