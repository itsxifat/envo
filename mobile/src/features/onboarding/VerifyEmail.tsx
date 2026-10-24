import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MailCheck } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import { StepDots } from './StepDots';

/** Step 2: the six-digit code from the email (it confirms the address before the registration). */
export function VerifyEmailScreen() {
  const { colors } = useTheme();
  const { account, verifyEmail, resendCode, changeEmail, refresh, signOut } = useSession();
  const input = useRef<InputRef>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [changing, setChanging] = useState(false);
  const [email, setEmail] = useState(account?.email ?? '');

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(c);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/kyc');
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(errorText(err));
      setCode('');
      input.current?.focus();
      // The answer may have been lost on the way although Envo took the code: then this moves on.
      void refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await resendCode();
      setCooldown(30);
      setNote('A new code is on its way.');
    } catch (err) {
      setError(errorText(err));
      // e.g. the email is confirmed already: then this moves on.
      void refresh().catch(() => undefined);
    }
  };

  const saveEmail = async () => {
    setBusy(true);
    setError(null);
    try {
      await changeEmail(email.trim().toLowerCase());
      setChanging(false);
      setCooldown(30);
      setNote(`We sent a new code to ${email.trim().toLowerCase()}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      onBack={signOut}
      title=""
      scroll
      footer={
        changing ? (
          <Button title="Send the code here" onPress={saveEmail} loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} block />
        ) : (
          <Button title="Confirm" onPress={() => void submit(code)} loading={busy} disabled={code.length !== 6} block />
        )
      }
    >
      <StepDots step={1} />
      <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
        <MailCheck size={26} color={colors.brand} />
      </View>
      <Text variant="title" style={styles.title}>
        Check your email
      </Text>
      <Text tone="secondary" style={styles.lead}>
        We sent a 6-digit code to <Text variant="bodyMedium">{account?.email}</Text>. Enter it here to confirm your email.
      </Text>

      {changing ? (
        <View style={styles.fields}>
          <Input label="Your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus />
          <Button title={`Keep ${account?.email}`} variant="ghost" size="md" onPress={() => setChanging(false)} style={styles.link} />
        </View>
      ) : (
        <>
          <Pressable accessibilityRole="none" onPress={() => input.current?.focus()} style={styles.boxes}>
            {Array.from({ length: 6 }, (_, i) => {
              const filled = i < code.length;
              const current = i === code.length && !busy;
              return (
                <View key={i} style={[styles.box, { backgroundColor: colors.element, borderColor: error ? colors.danger : current ? colors.brand : 'transparent' }]}>
                  <Text style={[styles.digit, { color: colors.text }]}>{filled ? code[i] : ''}</Text>
                </View>
              );
            })}
            <TextInput
              ref={input}
              value={code}
              onChangeText={(v) => {
                const next = v.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                setError(null);
                if (next.length === 6) void submit(next);
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              caretHidden
              accessibilityLabel="6-digit code"
              style={styles.hidden}
            />
          </Pressable>
          {error && (
            <Text variant="caption" tone="danger" style={styles.message}>
              {error}
            </Text>
          )}
          {!error && note && (
            <Text variant="caption" tone="call" style={styles.message}>
              {note}
            </Text>
          )}
          <View style={styles.links}>
            <Button title={cooldown ? `Send again in ${cooldown}s` : 'Send the code again'} variant="ghost" size="md" disabled={cooldown > 0} onPress={resend} style={styles.link} />
            <Button title="Wrong email? Change it" variant="ghost" size="md" onPress={() => setChanging(true)} style={styles.link} />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: space.xl },
  title: { marginTop: space.lg },
  lead: { marginTop: space.sm },
  boxes: { flexDirection: 'row', gap: space.sm, marginTop: space.xxl },
  box: { flex: 1, height: 64, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  digit: { fontFamily: fonts.bold, fontSize: 26, fontVariant: ['tabular-nums'] },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  message: { marginTop: space.md, marginLeft: 4 },
  links: { marginTop: space.xl, alignItems: 'flex-start' },
  link: { paddingHorizontal: 4 },
  fields: { gap: space.lg, marginTop: space.xl },
});
