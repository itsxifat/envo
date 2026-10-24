import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { ApiError, errorText } from '@/lib/api';
import { startOf, useSession } from '@/state/session';
import { space } from '@/theme/tokens';
import { focusField, OnboardingHeader } from './OnboardingHeader';

const MOBILE = /^01[3-9]\d{8}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

/** The 11 digits from 01, also when typed or pasted with the country code ("+880 1712…"). */
function mobileDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return (d.length > 11 && d.startsWith('880') ? d.slice(2) : d).slice(0, 11);
}

/** Step 1 of getting a number: who you are and how to sign in. */
export function SignUpScreen() {
  const { signUp } = useSession();
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // An account with this email exists already: said under the email, with a way to sign in.
  const [taken, setTaken] = useState<{ email: string; message: string } | null>(null);
  const nameRef = useRef<InputRef>(null);
  const mobileRef = useRef<InputRef>(null);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  const email = form.email.trim().toLowerCase();
  const errors = {
    name: form.name.trim().length < 2 ? 'Enter your full name' : null,
    mobile: !MOBILE.test(form.mobile) ? 'Enter your mobile number, like 01712345678' : null,
    email: !EMAIL.test(email) ? 'Enter a valid email' : null,
    password: form.password.length < 8 ? 'Use at least 8 characters' : null,
  };
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isTaken = !!taken && taken.email === email;

  const submit = async () => {
    if (busy) return;
    setTried(true);
    // The first field to fix gets the cursor, and scrolls into view.
    const first = errors.name ? nameRef : errors.mobile ? mobileRef : errors.email ? emailRef : errors.password ? passwordRef : null;
    if (first) return focusField(first.current);
    Keyboard.dismiss();
    setBusy(true);
    setFailed(null);
    setTaken(null);
    try {
      router.replace(startOf(await signUp({ ...form, name: form.name.trim(), email })));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setTaken({ email, message: errorText(err) });
      else setFailed(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<OnboardingHeader step={0} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
      scroll
      keyboardFooter="hide"
      footer={
        <>
          {failed && <Notice tone="danger" icon={CircleAlert} title={failed} />}
          <Button title="Continue" onPress={() => void submit()} loading={busy} block />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.title}>
        Create your account
      </Text>
      <Text tone="secondary" style={styles.lead}>
        About 5 minutes. Keep your NID card nearby: the BTRC requires every number to be registered in its owner's name.
      </Text>
      <View style={styles.fields}>
        <Input
          ref={nameRef}
          label="Full name"
          placeholder="As on your NID"
          value={form.name}
          onChangeText={set('name')}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={60}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => focusField(mobileRef.current)}
          error={tried ? errors.name : null}
        />
        <Input
          ref={mobileRef}
          label="Mobile number"
          placeholder="01XXXXXXXXX"
          value={form.mobile}
          onChangeText={(v) => set('mobile')(mobileDigits(v))}
          keyboardType="phone-pad"
          autoComplete="tel"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => focusField(emailRef.current)}
          hint="Your own mobile, 11 digits. It goes on your number's registration."
          error={tried ? errors.mobile : null}
        />
        <View>
          <Input
            ref={emailRef}
            label="Email"
            placeholder="you@example.com"
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusField(passwordRef.current)}
            hint="We send a 6-digit code here"
            error={isTaken ? taken.message : tried ? errors.email : null}
          />
          {isTaken && <Button title="Sign in instead" variant="secondary" size="md" onPress={() => router.replace({ pathname: '/sign-in', params: { email } })} style={styles.signIn} />}
        </View>
        <Input
          ref={passwordRef}
          label="Password"
          value={form.password}
          onChangeText={set('password')}
          secureTextEntry
          autoComplete="new-password"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          hint="At least 8 characters"
          error={tried ? errors.password : null}
        />
      </View>
      <Text variant="caption" tone="secondary" style={styles.terms}>
        By continuing you agree to Enfinito's terms and privacy policy.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: space.sm },
  lead: { marginTop: space.sm },
  fields: { gap: space.lg, marginTop: space.xl },
  signIn: { alignSelf: 'flex-start', marginTop: space.md },
  terms: { marginTop: space.lg },
});
