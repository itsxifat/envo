import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { CircleAlert, CircleCheck, Clock3, CreditCard, PauseCircle } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChoiceTile } from '@/components/ui/ChoiceTile';
import { IconTile } from '@/components/ui/IconTile';
import { Input, type InputRef } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { NIGHT, NumberCard } from '@/components/ui/NumberCard';
import { Screen } from '@/components/ui/Screen';
import { Steps } from '@/components/ui/Steps';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { formatBdt, formatPhone } from '@/lib/format';
import { holdLine, minutesFor } from '@/lib/stage';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';

/** A payment that went through, or that support checks first; `before` is the balance before it. */
type Done = { amount: number; review: boolean; before: number };
/** The payment page didn't say how it went: Envo is asked again for a minute. */
type Checking = { amount: number; before: number; since: number; timedOut: boolean };

const METHODS = ['bKash', 'Nagad', 'Rocket', 'Card'];
const POLL_MS = 5000;
const CHECK_MS = 60_000;

/** Back where the person came from, or home when there is nothing to go back to. */
const leave = () => (router.canGoBack() ? router.back() : router.dismissTo('/'));
const home = () => router.dismissTo('/');

/**
 * Add calling balance, paid on Enfinito Pay's page (bKash, Nagad, Rocket, cards and more). As the
 * activation step it asks for at least Enfinito's minimum.
 */
export function RechargeScreen({ activation }: { activation?: boolean }) {
  const { colors } = useTheme();
  const { account, config, minActivation, createRecharge, payOnline, refresh } = useSession();
  const min = activation ? minActivation : (config?.recharge.min ?? 50);
  const max = config?.recharge.max ?? 10_000;
  const offered = (config?.recharge.presets ?? [100, 200, 500, 1000]).filter((a) => a >= min);
  // Activating offers the least that activates first, keeping the number of amounts.
  const presets = activation && !offered.includes(min) ? [min, ...offered].slice(0, Math.max(offered.length, 1)) : offered;
  const rate = config?.rate_per_min ?? 0;
  const [picked, setPicked] = useState<number | null>(null);
  // The tapped amount counts while it is offered (the settings can arrive or change after the screen
  // opens). Activating starts at the least that activates, so the button and the page agree.
  const preset = picked !== null && presets.includes(picked) ? picked : activation ? (presets.find((a) => a >= minActivation) ?? minActivation) : (presets.find((a) => a >= 200) ?? presets[0] ?? min);
  const [custom, setCustom] = useState('');
  const [blurred, setBlurred] = useState(false);
  // Pay always works: what's wrong shows once it is pressed.
  const [tried, setTried] = useState(false);
  // Payments go through Enfinito Pay, while Enfinito has it switched on.
  const paused = !!config && !config.payment.online;
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [checking, setChecking] = useState<Checking | null>(null);
  // A recharge started but not paid (the payment page was closed): paying again uses it.
  const [open, setOpen] = useState<{ id: number; amount: number } | null>(null);
  const customRef = useRef<InputRef>(null);
  const amount = custom ? Number(custom) : preset;
  const valid = amount >= min && amount <= max;
  // Not on the first keystroke ("1" on the way to "1000"): once the field is left, or it is too much.
  const rangeError = custom && !valid && (blurred || tried || amount > max) ? `Choose between ${formatBdt(min)} and ${formatBdt(max)}` : null;

  // Without the settings there is nothing to pay with: ask for them again.
  useEffect(() => {
    if (!config) void refresh().catch(() => undefined);
  }, [config, refresh]);

  // Not told how the payment went: ask Envo every few seconds, for a minute.
  const waiting = !!checking && !checking.timedOut;
  const since = checking?.since;
  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    const stop = setTimeout(() => setChecking((c) => (c ? { ...c, timedOut: true } : c)), CHECK_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [waiting, since, refresh]);

  // Paid once the balance went up (or the number left the activation step); a payment support checks
  // first shows as that.
  useEffect(() => {
    if (!checking || !account) return;
    const paid = activation ? account.stage !== 'activate' : account.balance > checking.before + 0.001;
    if (!paid && !account.paymentInReview) return;
    setChecking(null);
    setDone({ amount: checking.amount, review: !paid, before: checking.before });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [account, checking, activation]);

  const choose = (next: { preset?: number; custom?: string }) => {
    if (next.preset !== undefined) {
      setPicked(next.preset);
      setCustom('');
    }
    if (next.custom !== undefined) setCustom(next.custom);
    setError(null);
    setCancelled(false);
  };

  const pay = async () => {
    setTried(true);
    if (!valid) {
      if (custom) customRef.current?.focus();
      else setError(`Choose between ${formatBdt(min)} and ${formatBdt(max)}`);
      return;
    }
    setBusy(true);
    setError(null);
    setCancelled(false);
    const before = account?.balance ?? 0;
    try {
      const id = open && open.amount === amount ? open.id : await createRecharge(amount);
      setOpen({ id, amount });
      const result = await payOnline(id);
      if (result === 'paid' || result === 'review') {
        setOpen(null);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDone({ amount, review: result === 'review', before });
      } else if (result === 'failed') {
        // Envo carries on with the same recharge if it can; asking again is safe.
        setOpen(null);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError("The payment didn't go through. Please try again.");
      } else if (result === 'cancelled') setCancelled(true);
      else setChecking({ amount, before, since: Date.now(), timedOut: false });
    } catch (err) {
      // The server's own words, e.g. while the last payment is still being checked or the payment page didn't open.
      setOpen(null);
      setError(errorText(err));
      void refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      await refresh();
    } catch {
      // Still paused or offline: the page stays as it is.
    } finally {
      setReloading(false);
    }
  };

  if (done) return <Paid done={done} activation={!!activation} />;

  if (checking) {
    return (
      <Screen footer={checking.timedOut ? <Button title="Go to home" onPress={home} block /> : undefined}>
        <View style={styles.center}>
          {checking.timedOut ? <Clock3 size={84} color={colors.warning} strokeWidth={1.6} /> : <ActivityIndicator size="large" color={colors.brand} />}
          <View style={styles.message} accessibilityLiveRegion="polite">
            <Text variant="title" align="center" accessibilityRole="header">
              {checking.timedOut ? 'Still checking your payment' : 'Checking your payment…'}
            </Text>
            <Text tone="secondary" align="center">
              {checking.timedOut ? "We'll add it as soon as it's confirmed. You can leave this screen." : 'This takes a few seconds'}
            </Text>
          </View>
        </View>
      </Screen>
    );
  }

  const hold = activation ? holdLine(account) : null;
  const footer = (
    <>
      {error && <Notice tone="danger" icon={CircleAlert} title={error} />}
      {cancelled && (
        <Text variant="caption" tone="secondary" align="center" accessibilityLiveRegion="polite">
          You didn't finish paying. Nothing was taken. Tap Pay to try again.
        </Text>
      )}
      {paused ? (
        <Button title="Try again" variant="secondary" onPress={() => void reload()} loading={reloading} block />
      ) : (
        <Button title={valid ? `Pay ${formatBdt(amount)}` : 'Pay'} onPress={() => void pay()} loading={busy} block />
      )}
    </>
  );

  return (
    <Screen back title={activation ? 'Activate your number' : 'Recharge'} scroll footer={footer}>
      <NumberCard
        size="compact"
        number={account?.number ?? null}
        label={activation ? 'Your new number' : 'Recharging'}
        placeholder="We're picking your number"
        status={activation ? { label: 'Not active yet', tone: 'waiting' } : undefined}
        right={
          activation ? undefined : (
            <View style={styles.balance}>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text variant="figure" style={styles.balanceValue}>
                {formatBdt(account?.balance ?? 0)}
              </Text>
            </View>
          )
        }
        style={styles.summary}
      />

      {paused && (
        <Notice
          tone="warning"
          icon={PauseCircle}
          title="Payments are paused for a moment"
          body={hold ? `Please try again in a little while. ${hold.text}` : 'Please try again in a little while.'}
          style={styles.below}
        />
      )}
      {activation && (
        <View style={[styles.below, styles.activation]}>
          <Text tone="secondary">Your first recharge activates the number. All of it becomes your calling balance.</Text>
          {hold && !paused && (
            <Text variant="caption" tone={hold.urgent ? 'warning' : 'secondary'}>
              {hold.text}
            </Text>
          )}
        </View>
      )}

      {/* Nothing to choose while payments are paused. */}
      <View style={paused && styles.off}>
        <Text variant="heading" style={styles.section}>
          Amount
        </Text>
        <View style={styles.amounts}>
          {presets.map((a) => {
            const minutes = minutesFor(a, rate);
            return (
              <ChoiceTile
                key={a}
                label={formatBdt(a)}
                caption={minutes !== null ? `about ${minutes.toLocaleString('en-US')} min` : undefined}
                selected={!custom && preset === a}
                onPress={() => choose({ preset: a })}
                style={styles.amount}
              />
            );
          })}
        </View>
        <Input
          ref={customRef}
          label="Or another amount"
          placeholder={`${min} to ${max.toLocaleString('en-US')}`}
          value={custom}
          onChangeText={(v) => choose({ custom: v.replace(/\D/g, '').slice(0, 6) })}
          onFocus={() => setBlurred(false)}
          onBlur={() => setBlurred(true)}
          keyboardType="number-pad"
          prefix="BDT"
          error={rangeError}
        />
        {!activation && valid && (
          <View style={styles.after}>
            <Text variant="caption" tone="secondary">
              Balance after
            </Text>
            <Text variant="figure">{formatBdt((account?.balance ?? 0) + amount)}</Text>
          </View>
        )}
      </View>

      {!paused && (
        <Card style={styles.payment}>
          <View style={styles.paymentRow}>
            <IconTile icon={CreditCard} size="sm" tone="brand" />
            <View style={styles.flex}>
              <Text variant="bodyMedium">You pay on Enfinito Pay's secure page</Text>
              <Text variant="caption" tone="secondary">
                Then you come straight back here.
              </Text>
            </View>
          </View>
          <View style={styles.methods}>
            {METHODS.map((m) => (
              <View key={m} style={[styles.method, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text variant="small" tone="secondary">
                  {m}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}

/** After paying: received (with the new balance, or what happens next), or being checked by support. */
function Paid({ done, activation }: { done: Done; activation: boolean }) {
  const { colors } = useTheme();
  const { account } = useSession();
  // The balance it lands on: Envo's, once it has it, else what it will be.
  const [target] = useState(() => (account && account.balance > done.before ? account.balance : done.before + done.amount));
  const shown = useCountUp(done.before, target);

  if (done.review) {
    return (
      <Screen footer={<Button title={activation ? 'Go to home' : 'Done'} onPress={activation ? home : leave} block />}>
        <View style={styles.center}>
          <Animated.View entering={ZoomIn.springify().damping(11)}>
            <Clock3 size={84} color={colors.warning} strokeWidth={1.6} />
          </Animated.View>
          <Animated.View entering={FadeIn.delay(200)} style={styles.message}>
            <Text variant="title" align="center" accessibilityRole="header">
              We're checking your payment
            </Text>
            <Text tone="secondary" align="center">
              {`Thank you! It usually takes a few minutes. Nothing more to pay. ${activation ? 'Your number is activated as soon as it is confirmed.' : 'The amount goes on your balance once it is confirmed.'}`}
            </Text>
          </Animated.View>
        </View>
      </Screen>
    );
  }

  if (activation) {
    const number = account?.number ? formatPhone(account.number) : 'your number';
    return (
      <Screen scroll footer={<Button title="Go to home" onPress={home} block />}>
        <View style={styles.center}>
          <Animated.View entering={ZoomIn.springify().damping(11)}>
            <CircleCheck size={84} color={colors.call} strokeWidth={1.6} />
          </Animated.View>
          <Animated.View entering={FadeIn.delay(200)} style={styles.message}>
            <Text variant="title" align="center" accessibilityRole="header">
              {`${formatBdt(done.amount)} received`}
            </Text>
            <Text tone="secondary" align="center">
              {`We're registering ${number} in your name now. It usually takes a few hours. We'll email you${account?.email ? ` at ${account.email}` : ''} when you can call, and your home screen shows how it's going.`}
            </Text>
          </Animated.View>
          <Animated.View entering={FadeIn.delay(350)} style={styles.steps}>
            <Steps
              steps={[
                { title: 'First recharge', state: 'done' },
                { title: 'Registering in your name', state: 'working' },
                { title: 'Ready to call', state: 'todo' },
              ]}
            />
          </Animated.View>
        </View>
      </Screen>
    );
  }

  const decimals = !Number.isInteger(done.before) || !Number.isInteger(target) ? 2 : 0;
  return (
    <Screen footer={<Button title="Done" onPress={leave} block />}>
      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(11)}>
          <CircleCheck size={84} color={colors.call} strokeWidth={1.6} />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(200)} style={styles.message}>
          <Text variant="title" align="center" accessibilityRole="header">
            {`${formatBdt(done.amount)} received`}
          </Text>
          <Text variant="heading" align="center" accessibilityLabel={`New balance ${formatBdt(target)}`} style={styles.tabular}>
            {`New balance BDT ${shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`}
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

/** A number counting from one value to another (just the end value when motion is reduced). */
function useCountUp(from: number, to: number, ms = 600): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : from);
  useEffect(() => {
    if (reduce || from === to) {
      setValue(to);
      return;
    }
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / ms);
      setValue(p < 1 ? from + (to - from) * (1 - Math.pow(1 - p, 3)) : to);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to, ms, reduce]);
  return value;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  summary: { marginTop: space.sm },
  balance: { alignItems: 'flex-end' },
  balanceLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: NIGHT.muted },
  balanceValue: { color: NIGHT.text },
  below: { marginTop: space.lg },
  activation: { gap: space.xs },
  off: { opacity: 0.5, pointerEvents: 'none' },
  section: { marginTop: space.xl, marginBottom: space.md },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  amount: { width: '48.5%' },
  after: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg },
  payment: { marginTop: space.xl },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  method: { minHeight: 24, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingBottom: space.xxxl },
  message: { alignItems: 'center', gap: space.sm, alignSelf: 'stretch' },
  steps: { alignSelf: 'stretch' },
});
