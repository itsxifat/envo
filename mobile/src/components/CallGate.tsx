import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { formatBdt } from '@/lib/format';
import { isEnvoOnServer } from '@/lib/numbers';
import { outOfBalance, useSession } from '@/state/session';
import { space } from '@/theme/tokens';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import { Text } from './ui/Text';

/** Why a call out can't be made right now, most important first. */
export type GateReason = 'offline' | 'no-number' | 'checking' | 'activate' | 'registering' | 'empty';

/**
 * Every place that starts a call asks here first. When calling isn't possible it says why, in a sheet,
 * with the one thing to do about it: `guard(() => dial(number…), number)`, and render `sheet` somewhere
 * on the screen. With the balance used up, calls to Envo numbers still go out while those are free
 * (`envoOnly`): the number is checked with Envo first.
 */
export function useCallGate(): {
  reason: GateReason | null;
  canCall: boolean;
  envoOnly: boolean;
  guard: (fn: () => void, number?: string) => void;
  sheet: ReactNode;
} {
  const { account, offline, config, minActivation } = useSession();
  // What the sheet says stays while it slides away.
  const [shown, setShown] = useState<GateReason>('offline');
  const [visible, setVisible] = useState(false);

  const reason: GateReason | null = offline
    ? 'offline'
    : !account?.number
      ? 'no-number'
      : account.stage === 'activate' && account.paymentInReview
        ? 'checking'
        : account.stage === 'activate'
          ? 'activate'
          : account.stage === 'registering'
            ? 'registering'
            : outOfBalance(account)
              ? 'empty'
              : null;

  const envoOnly = reason === 'empty' && !!config?.free_onnet;
  const guard = useCallback(
    (fn: () => void, number?: string) => {
      if (!reason) return fn();
      const refuse = () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setShown(reason);
        setVisible(true);
      };
      if (envoOnly && number) {
        void isEnvoOnServer(number).then((envo) => (envo ? fn() : refuse()), refuse);
        return;
      }
      refuse();
    },
    [reason, envoOnly],
  );

  const paused = !!config && !config.payment.online;
  const min = formatBdt(minActivation);
  const copy: Record<GateReason, { title: string; body: string; action?: { title: string; go: () => void } }> = {
    offline: { title: 'No internet', body: 'Calls need a connection. Check your Wi-Fi or mobile data.' },
    'no-number': { title: "We're picking your number", body: "We'll email you when it's ready to activate." },
    checking: { title: "We're checking your payment", body: "Usually a few minutes. You can call once it's confirmed." },
    activate: paused
      ? { title: 'Activate your number first', body: `A first recharge of ${min} or more activates it. All of it becomes your calling balance. Payments are paused for a moment. Please try again in a little while.` }
      : {
          title: 'Activate your number first',
          body: `A first recharge of ${min} or more activates it. All of it becomes your calling balance.`,
          action: { title: `Activate with ${min}`, go: () => router.push('/activate') },
        },
    registering: { title: 'Your number is being registered', body: "Usually a few hours. We'll email you when you can call." },
    empty: envoOnly
      ? {
          title: 'Recharge to call this number',
          body: 'Your calling balance has run out. Calls to Envo numbers are still free, and you can still get calls.',
          action: { title: 'Recharge', go: () => router.push('/recharge') },
        }
      : {
          title: 'Recharge to call',
          body: 'Your calling balance has run out. You can still get calls.',
          action: { title: 'Recharge', go: () => router.push('/recharge') },
        },
  };
  const c = copy[shown];
  const close = () => setVisible(false);

  const sheet = (
    <Sheet visible={visible} onClose={close} title={c.title}>
      <Text tone="secondary">{c.body}</Text>
      <View style={styles.buttons}>
        {c.action ? (
          <>
            <Button
              title={c.action.title}
              onPress={() => {
                close();
                c.action!.go();
              }}
              block
            />
            <Button title="Not now" variant="ghost" onPress={close} block />
          </>
        ) : (
          <Button title="OK" onPress={close} block />
        )}
      </View>
    </Sheet>
  );

  return { reason, canCall: reason === null, envoOnly, guard, sheet };
}

const styles = StyleSheet.create({
  buttons: { gap: space.sm, marginTop: space.xl },
});
