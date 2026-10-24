import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { CircleAlert, ClipboardPaste } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { ApiError, errorText } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import { confirmSignOut, focusField, OnboardingHeader, TextLink } from './OnboardingHeader';

const EMAIL = /^\S+@\S+\.\S+$/;

/** Six digits in a row from what was copied, e.g. the whole email ("Your code is 123456"). */
function codeIn(text: string): string | null {
  const own = /(?:^|\D)(\d{6})(?!\d)/.exec(text)?.[1];
  if (own) return own;
  const digits = text.replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

/** Step 2: the six-digit code from the email (it confirms the address before the registration). */
export function VerifyEmailScreen() {
  const { colors } = useTheme();
  const { account, verifyEmail, resendCode, changeEmail, refresh, signOut } = useSession();
  const input = useRef<InputRef>(null);
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'call' | 'danger' } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [changing, setChanging] = useState(false);
  const [email, setEmail] = useState(account?.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  // When the last code went out: a while later, a word about the spam folder.
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [spamHint, setSpamHint] = useState(false);
  const clearing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sending = useRef(false);
  const reduce = useReducedMotion();
  const shake = useSharedValue(0);
  const shaking = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    setSpamHint(false);
    const t = setTimeout(() => setSpamHint(true), 30_000);
    return () => clearTimeout(t);
  }, [sentAt]);

  useEffect(
    () => () => {
      if (clearing.current) clearTimeout(clearing.current);
    },
    [],
  );

  // While the email is being changed, back returns to the code (once a new email being saved has its
  // answer, so an error isn't missed); otherwise it leaves the app.
  useFocusEffect(
    useCallback(() => {
      if (!changing) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!busy) setChanging(false);
        return true;
      });
      return () => sub.remove();
    }, [changing, busy]),
  );

  const submit = async (c: string) => {
    // The sixth digit sends the code by itself: a tap on Confirm at that moment doesn't send it twice.
    if (sending.current) return;
    if (c.length < 6) {
      setError('Enter all 6 digits');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return focusField(input.current);
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(c);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/kyc', params: { from: 'verify' } });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(errorText(err));
      // A wrong or used-up code shakes, then clears for the next try; a lost connection keeps the digits.
      if (err instanceof ApiError && err.status === 400) {
        if (!reduce) shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 }));
        if (clearing.current) clearTimeout(clearing.current);
        clearing.current = setTimeout(() => {
          setCode('');
          focusField(input.current);
        }, 400);
      }
      // The answer may have been lost on the way although Envo took the code: then this moves on.
      void refresh().catch(() => undefined);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  // Reads the clipboard only when asked to (Android says so each time it's read).
  const paste = async () => {
    if (sending.current) return;
    const found = codeIn(await Clipboard.getStringAsync().catch(() => ''));
    if (!found) return toast('No code to paste');
    setCode(found);
    setError(null);
    void submit(found);
  };

  const resend = async () => {
    setNote(null);
    try {
      await resendCode();
      setCooldown(30);
      setSentAt(Date.now());
      setNote({ text: 'A new code is on its way.', tone: 'call' });
    } catch (err) {
      setNote({ text: errorText(err), tone: 'danger' });
      // e.g. the email is confirmed already: then this moves on.
      void refresh().catch(() => undefined);
    }
  };

  const startChanging = () => {
    setEmail(account?.email ?? '');
    setEmailError(null);
    // The code's field goes away while the email is changed (it gets the cursor again after).
    setFocused(false);
    setChanging(true);
  };

  const saveEmail = async () => {
    if (busy) return;
    const next = email.trim().toLowerCase();
    if (!EMAIL.test(next)) return setEmailError('Enter a valid email');
    setBusy(true);
    setEmailError(null);
    try {
      await changeEmail(next);
      setChanging(false);
      setCode('');
      setError(null);
      setCooldown(30);
      setSentAt(Date.now());
      setNote({ text: `We sent a new code to ${next}.`, tone: 'call' });
    } catch (err) {
      setEmailError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // No way back from here: the account is made. Android's back leaves the app (or ends changing the email).
  return (
    <Screen
      header={<OnboardingHeader step={1} />}
      scroll
      footer={
        changing ? (
          <Button title="Send the code here" onPress={() => void saveEmail()} loading={busy} block />
        ) : (
          <>
            <Button title="Confirm" onPress={() => void submit(code)} loading={busy} block />
            <Button title="Sign out" variant="ghost" onPress={() => confirmSignOut(signOut)} block />
          </>
        )
      }
    >
      {changing ? (
        <>
          <Text variant="title" accessibilityRole="header" style={styles.title}>
            Change your email
          </Text>
          <Text tone="secondary" style={styles.lead}>
            We'll send a new 6-digit code there.
          </Text>
          <View style={styles.fields}>
            <Input
              label="Your email"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setEmailError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              returnKeyType="send"
              onSubmitEditing={() => void saveEmail()}
              error={emailError}
            />
            <TextLink title={`Keep ${account?.email ?? 'my email'}`} onPress={() => setChanging(false)} />
          </View>
        </>
      ) : (
        <>
          <Text variant="title" accessibilityRole="header" style={styles.title}>
            Check your email
          </Text>
          <View style={styles.lead}>
            <Text tone="secondary">We sent a 6-digit code to</Text>
            <Text variant="bodyMedium" numberOfLines={1} ellipsizeMode="middle">
              {account?.email}
            </Text>
            <Text tone="secondary">Enter it below.</Text>
          </View>

          <Animated.View style={[styles.boxes, shaking]}>
            {/* The boxes only show the hidden field's digits; tapping them brings the keyboard back. */}
            <Pressable accessible={false} importantForAccessibility="no-hide-descendants" onPress={() => focusField(input.current)} style={styles.boxRow}>
              {Array.from({ length: 6 }, (_, i) => {
                const current = focused && !busy && i === code.length;
                return (
                  <View key={i} style={[styles.box, { backgroundColor: colors.field, borderColor: error ? colors.danger : current ? colors.brand : colors.borderStrong }]}>
                    {i < code.length ? <Text style={styles.digit}>{code[i]}</Text> : current ? <Caret /> : null}
                  </View>
                );
              })}
            </Pressable>
            <TextInput
              ref={input}
              value={code}
              onChangeText={(v) => {
                const next = v.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                setError(null);
                if (next.length === 6) void submit(next);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              caretHidden
              accessibilityLabel="6-digit code"
              accessibilityHint={error ?? undefined}
              style={styles.hidden}
            />
          </Animated.View>
          <View accessibilityLiveRegion="polite">
            {error ? (
              <View style={styles.message}>
                <CircleAlert size={14} color={colors.danger} strokeWidth={2} style={styles.messageIcon} />
                <Text variant="caption" tone="danger" style={styles.flex}>
                  {error}
                </Text>
              </View>
            ) : note ? (
              <Text variant="caption" tone={note.tone} style={styles.message}>
                {note.text}
              </Text>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Paste code"
            hitSlop={4}
            onPress={() => void paste()}
            style={({ pressed }) => [styles.chip, { backgroundColor: colors.brandSoft }, pressed && styles.pressed]}
          >
            <ClipboardPaste size={16} color={colors.brand} strokeWidth={2} />
            <Text variant="label" tone="brand">
              Paste code
            </Text>
          </Pressable>

          <View style={styles.links}>
            <TextLink title={cooldown ? `Send again in ${cooldown}s` : 'Send the code again'} disabled={cooldown > 0} onPress={() => void resend()} />
            <TextLink title="Wrong email? Change it" onPress={startChanging} />
          </View>
          {spamHint && (
            <Text variant="caption" tone="secondary">
              No email? Check your spam or promotions folder.
            </Text>
          )}
        </>
      )}
    </Screen>
  );
}

/** The blinking bar in the box that the next digit goes into (still when motion is reduced). */
function Caret() {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const shown = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      shown.value = 1;
      return;
    }
    shown.value = withRepeat(withSequence(withDelay(500, withTiming(0, { duration: 0 })), withDelay(500, withTiming(1, { duration: 0 }))), -1);
    return () => cancelAnimation(shown);
  }, [reduce, shown]);
  const blink = useAnimatedStyle(() => ({ opacity: shown.value }));
  return <Animated.View style={[styles.caret, { backgroundColor: colors.brand }, blink]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: space.sm },
  lead: { marginTop: space.sm },
  fields: { gap: space.sm, marginTop: space.xl },
  boxes: { marginTop: space.xl },
  boxRow: { flexDirection: 'row', gap: space.sm },
  box: { flex: 1, height: 56, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  digit: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30, fontVariant: ['tabular-nums'] },
  caret: { width: 2, height: 24, borderRadius: 1 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  message: { flexDirection: 'row', gap: 6, marginTop: space.sm },
  messageIcon: { marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, marginTop: space.lg },
  pressed: { opacity: 0.7 },
  links: { marginTop: space.md, alignItems: 'flex-start' },
});
