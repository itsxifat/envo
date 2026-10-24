import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { CircleCheck, Clock3, CreditCard } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { formatBdt, formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';

type Done = { amount: number; checking: boolean };

/**
 * Add calling balance, paid on Enfinito Pay's page (bKash, Nagad, Rocket, cards and more). As the
 * activation step it asks for at least Enfinito's minimum.
 */
export function RechargeScreen({ activation }: { activation?: boolean }) {
  const { colors } = useTheme();
  const { account, config, minActivation, createRecharge, payOnline, refresh } = useSession();
  const min = activation ? minActivation : (config?.recharge.min ?? 50);
  const max = config?.recharge.max ?? 10_000;
  const presets = (config?.recharge.presets ?? [100, 200, 500, 1000]).filter((a) => a >= min);
  const [picked, setPreset] = useState<number | null>(null);
  // The tapped amount counts while it is offered (the settings can arrive or change after the screen opens).
  const preset = picked !== null && presets.includes(picked) ? picked : (presets.find((a) => a >= 200) ?? presets[0] ?? min);
  const [custom, setCustom] = useState('');
  // Payments go through Enfinito Pay, while Enfinito has it switched on.
  const online = !!config?.payment.online;
  // Without the settings there is nothing to pay with: ask for them again.
  useEffect(() => {
    if (!config) void refresh().catch(() => undefined);
  }, [config, refresh]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // A recharge started but not paid (the payment page was closed): paying again uses it.
  const [open, setOpen] = useState<{ id: number; amount: number } | null>(null);
  const amount = custom ? Number(custom) : preset;
  const valid = amount >= min && amount <= max;

  const pay = async () => {
    if (!valid || !online) return;
    setBusy(true);
    setError(null);
    try {
      const id = open && open.amount === amount ? open.id : await createRecharge(amount);
      setOpen({ id, amount });
      const result = await payOnline(id);
      if (result === 'paid' || result === 'review') setDone({ amount, checking: result === 'review' });
      else if (result === 'failed') setError("The payment didn't go through. Please try again.");
      else return;
      setOpen(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      // The server's own words, e.g. while the last payment is still being checked or the payment page didn't open.
      setError(errorText(err));
      void refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const Icon = done.checking ? Clock3 : CircleCheck;
    return (
      <Screen footer={<Button title={activation ? 'Continue' : 'Done'} onPress={() => (activation ? router.replace('/') : router.back())} block />}>
        <View style={styles.success}>
          <Animated.View entering={ZoomIn.springify().damping(11)}>
            <Icon size={84} color={done.checking ? colors.warning : colors.call} strokeWidth={1.6} />
          </Animated.View>
          <Animated.View entering={FadeIn.delay(200)} style={{ alignItems: 'center', gap: space.sm }}>
            <Text variant="title" align="center">
              {done.checking ? "We're checking your payment" : `${formatBdt(done.amount)} received`}
            </Text>
            <Text tone="secondary" align="center">
              {done.checking
                ? `Thank you! It usually takes a few minutes. ${activation ? 'Your number is activated as soon as it is confirmed.' : 'The amount goes on your balance once it is confirmed.'}`
                : activation
                  ? `Thank you! We're registering ${formatPhone(account?.number ?? '') || 'your number'} in your name. This usually takes a few hours, and we'll let you know when it's ready.`
                  : 'It is on your calling balance now.'}
            </Text>
          </Animated.View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen back title={activation ? 'Activate your number' : 'Recharge'} scroll footer={<Button title={`Pay ${formatBdt(amount)}`} onPress={pay} loading={busy} disabled={!valid || !online} block />}>
      <View style={[styles.summary, { backgroundColor: colors.surface }]}>
        <View>
          <Text variant="caption" tone="secondary">
            {activation ? 'Your number' : 'Recharging'}
          </Text>
          <Text style={[styles.number, { color: colors.text }]}>{account?.number ? formatPhone(account.number) : 'Being chosen'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" tone="secondary">
            Balance
          </Text>
          <Text variant="heading">{formatBdt(account?.balance ?? 0)}</Text>
        </View>
      </View>

      {activation && (
        <Text tone="secondary" style={styles.note}>
          Your first recharge activates the number. It must be at least {formatBdt(minActivation)}, and all of it becomes your calling balance.
        </Text>
      )}

      <Text variant="heading" style={styles.section}>
        Amount
      </Text>
      <View style={styles.amounts}>
        {presets.map((a) => {
          const on = !custom && preset === a;
          return (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setPreset(a);
                setCustom('');
              }}
              style={[styles.amount, { backgroundColor: on ? colors.brandSoft : colors.element, borderColor: on ? colors.brand : 'transparent' }]}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 17, color: on ? colors.brand : colors.text }}>{formatBdt(a)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label="Or another amount"
        placeholder={`${min} to ${max.toLocaleString('en-US')}`}
        value={custom}
        onChangeText={(v) => setCustom(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        prefix="BDT"
        error={custom && (amount < min || amount > max) ? `Choose between ${formatBdt(min)} and ${formatBdt(max)}` : null}
      />

      {!online ? (
        <Text tone="secondary" style={styles.note}>
          Payments are paused right now. Please try again a little later.
        </Text>
      ) : (
        <View style={[styles.payment, { backgroundColor: colors.surface }]}>
          <View style={[styles.paymentIcon, { backgroundColor: colors.brandSoft }]}>
            <CreditCard size={18} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium">You pay on Enfinito Pay's secure page</Text>
            <Text variant="caption" tone="secondary">
              bKash, Nagad, Rocket, cards and more. Then you come straight back here.
            </Text>
          </View>
        </View>
      )}

      {error && (
        <Text tone="danger" style={{ marginTop: space.lg }}>
          {error}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: radius.lg, padding: space.lg, marginTop: space.sm },
  number: { fontFamily: fonts.bold, fontSize: 20, marginTop: 2, fontVariant: ['tabular-nums'] },
  note: { marginTop: space.lg },
  section: { marginTop: space.xl, marginBottom: space.md },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  amount: { width: '48.5%', height: 58, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  payment: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: 14, marginTop: space.lg },
  paymentIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingBottom: space.xxxl },
});
