import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { CircleCheck, Clock3, CreditCard, Smartphone } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { formatBdt, formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';

const CHANNELS = [
  { id: 'bkash', label: 'bKash', color: '#E2136E' },
  { id: 'nagad', label: 'Nagad', color: '#F7941D' },
  { id: 'rocket', label: 'Rocket', color: '#8C3494' },
] as const;

type Method = 'online' | 'manual';
type Done = { amount: number; checking: boolean };

/**
 * Add calling balance: on the payment page (card, bKash, Nagad), or by sending bKash / Nagad yourself
 * and entering the transaction ID. As the activation step it asks for at least Enfinito's minimum.
 */
export function RechargeScreen({ activation }: { activation?: boolean }) {
  const { colors } = useTheme();
  const { account, config, minActivation, createRecharge, payOnline, payManual, refresh } = useSession();
  const min = activation ? minActivation : (config?.recharge.min ?? 50);
  const max = config?.recharge.max ?? 10_000;
  const presets = (config?.recharge.presets ?? [100, 200, 500, 1000]).filter((a) => a >= min);
  const [picked, setPreset] = useState<number | null>(null);
  // Like the method below: the tapped amount counts while it is offered (the settings can arrive later).
  const preset = picked !== null && presets.includes(picked) ? picked : (presets.find((a) => a >= 200) ?? presets[0] ?? min);
  const [custom, setCustom] = useState('');
  const methods: Method[] = [...(config?.payment.online ? (['online'] as const) : []), ...(config?.payment.manual ? (['manual'] as const) : [])];
  const [chosen, setMethod] = useState<Method | null>(null);
  // The settings can arrive (or change) after the screen opens: a choice counts while it is offered.
  const method = chosen && methods.includes(chosen) ? chosen : (methods[0] ?? null);
  // Without the settings there is nothing to pay with: ask for them again.
  useEffect(() => {
    if (!config) void refresh().catch(() => undefined);
  }, [config, refresh]);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]['id']>('bkash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // A recharge started but not paid (the payment page was closed): paying again uses it.
  const [open, setOpen] = useState<{ id: number; amount: number } | null>(null);
  const amount = custom ? Number(custom) : preset;
  const valid = amount >= min && amount <= max && (method !== 'manual' || reference.trim().length >= 3);

  const pay = async () => {
    if (!valid || !method) return;
    setBusy(true);
    setError(null);
    try {
      const id = open && open.amount === amount ? open.id : await createRecharge(amount);
      setOpen({ id, amount });
      if (method === 'manual') {
        await payManual(id, channel, reference.trim());
        setDone({ amount, checking: true });
      } else {
        const result = await payOnline(id);
        if (result === 'paid' || result === 'review') setDone({ amount, checking: result === 'review' });
        else if (result === 'failed') setError("The payment didn't go through. Please try again.");
        else return;
      }
      setOpen(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      // The server's own words, e.g. while the last payment is still being checked.
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

  const label = method === 'manual' ? `I've sent ${formatBdt(amount)}` : `Pay ${formatBdt(amount)}`;
  return (
    <Screen back title={activation ? 'Activate your number' : 'Recharge'} scroll footer={<Button title={label} onPress={pay} loading={busy} disabled={!valid || !method} block />}>
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

      <Text variant="heading" style={styles.section}>
        Pay with
      </Text>
      {!methods.length ? (
        <Text tone="secondary">Payments are paused right now. Please try again a little later.</Text>
      ) : (
        <View style={[styles.methods, { backgroundColor: colors.surface }]}>
          {methods.map((m, i) => {
            const on = method === m;
            return (
              <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setMethod(m)} style={[styles.method, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={[styles.methodIcon, { backgroundColor: colors.brandSoft }]}>{m === 'online' ? <CreditCard size={18} color={colors.brand} /> : <Smartphone size={18} color={colors.brand} />}</View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">{m === 'online' ? 'Card, bKash or Nagad' : 'Send money yourself'}</Text>
                  <Text variant="caption" tone="secondary">
                    {m === 'online' ? 'On a secure payment page, then straight back here' : 'bKash or Nagad, then enter the transaction ID'}
                  </Text>
                </View>
                <View style={[styles.radio, { borderColor: on ? colors.brand : colors.textTertiary }]}>{on && <View style={[styles.radioDot, { backgroundColor: colors.brand }]} />}</View>
              </Pressable>
            );
          })}
        </View>
      )}

      {method === 'manual' && (
        <View style={[styles.manual, { backgroundColor: colors.surface }]}>
          {!!config?.payment.manual_instructions && <Text tone="secondary">{config.payment.manual_instructions}</Text>}
          <View style={styles.channels}>
            {CHANNELS.map((c) => {
              const on = channel === c.id;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setChannel(c.id)}
                  style={[styles.channel, { backgroundColor: on ? `${c.color}1A` : colors.background, borderColor: on ? c.color : 'transparent' }]}
                >
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? c.color : colors.text }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Input label="Transaction ID" placeholder="e.g. 9JH4K2L8PQ" value={reference} onChangeText={(v) => setReference(v.replace(/\s/g, '').slice(0, 40))} autoCapitalize="characters" autoCorrect={false} />
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
  methods: { borderRadius: radius.lg, overflow: 'hidden' },
  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14 },
  methodIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  manual: { borderRadius: radius.lg, padding: space.lg, gap: space.md, marginTop: space.md },
  channels: { flexDirection: 'row', gap: space.sm },
  channel: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingBottom: space.xxxl },
});
