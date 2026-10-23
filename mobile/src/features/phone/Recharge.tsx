import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { CircleCheck, CreditCard, Smartphone } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';

const AMOUNTS = [100, 200, 500, 1000];
const METHODS = [
  { id: 'bkash', label: 'bKash', dot: '#E2136E', icon: 'phone' },
  { id: 'nagad', label: 'Nagad', dot: '#F7941D', icon: 'phone' },
  { id: 'card', label: 'Card or internet banking', dot: '#1F57EB', icon: 'card' },
] as const;

/**
 * Add calling balance. As the activation step it asks for at least the minimum Enfinito set; after
 * paying, the number is registered and the balance is there for calls.
 */
export function RechargeScreen({ activation }: { activation?: boolean }) {
  const { colors } = useTheme();
  const { account, minActivation, recharge } = useSession();
  const min = activation ? minActivation : 50;
  const [preset, setPreset] = useState<number>(activation ? Math.max(minActivation, 200) : 200);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('bkash');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const amount = custom ? Number(custom) : preset;
  const valid = amount >= min && amount <= 20_000;

  const pay = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await recharge(amount);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(amount);
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return (
      <Screen footer={<Button title={activation ? 'Start using Envo' : 'Done'} onPress={() => (activation ? router.replace('/') : router.back())} block />}>
        <View style={styles.success}>
          <Animated.View entering={ZoomIn.springify().damping(11)}>
            <CircleCheck size={84} color={colors.call} strokeWidth={1.6} />
          </Animated.View>
          <Animated.View entering={FadeIn.delay(200)} style={{ alignItems: 'center', gap: space.sm }}>
            <Text variant="title" align="center">
              {formatBdt(done)} received
            </Text>
            <Text tone="secondary" align="center">
              {activation
                ? `Thank you! We're registering ${formatPhone(account?.number ?? '')} in your name with ICC. This usually takes a few hours, and we'll let you know when it's ready.`
                : 'It is on your calling balance now.'}
            </Text>
          </Animated.View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen back title={activation ? 'Activate your number' : 'Recharge'} scroll footer={<Button title={`Pay ${valid ? formatBdt(amount) : ''}`.trim()} onPress={pay} loading={busy} disabled={!valid} block />}>
      <View style={[styles.summary, { backgroundColor: colors.surface }]}>
        <View>
          <Text variant="caption" tone="secondary">
            {activation ? 'Your number' : 'Recharging'}
          </Text>
          <Text style={[styles.number, { color: colors.text }]}>{formatPhone(account?.number ?? '')}</Text>
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
        {AMOUNTS.map((a) => {
          const on = !custom && preset === a;
          const allowed = a >= min;
          return (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !allowed }}
              disabled={!allowed}
              onPress={() => {
                setPreset(a);
                setCustom('');
              }}
              style={[styles.amount, { backgroundColor: on ? colors.brandSoft : colors.element, borderColor: on ? colors.brand : 'transparent', opacity: allowed ? 1 : 0.4 }]}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 17, color: on ? colors.brand : colors.text }}>{formatBdt(a)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label="Or another amount"
        placeholder={`${min} to 20,000`}
        value={custom}
        onChangeText={(v) => setCustom(v.replace(/\D/g, '').slice(0, 5))}
        keyboardType="number-pad"
        prefix="BDT"
        error={custom && !valid ? `Choose between ${formatBdt(min)} and BDT 20,000` : null}
      />

      <Text variant="heading" style={styles.section}>
        Pay with
      </Text>
      <View style={[styles.methods, { backgroundColor: colors.surface }]}>
        {METHODS.map((m, i) => {
          const on = method === m.id;
          return (
            <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setMethod(m.id)} style={[styles.method, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <View style={[styles.methodIcon, { backgroundColor: `${m.dot}1F` }]}>
                {m.icon === 'card' ? <CreditCard size={18} color={m.dot} /> : <Smartphone size={18} color={m.dot} />}
              </View>
              <Text variant="bodyMedium" style={{ flex: 1 }}>
                {m.label}
              </Text>
              <View style={[styles.radio, { borderColor: on ? colors.brand : colors.textTertiary }]}>{on && <View style={[styles.radioDot, { backgroundColor: colors.brand }]} />}</View>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
        You pay on Enfinito Pay's secure page and come straight back here.
      </Text>
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
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingBottom: space.xxxl },
});
