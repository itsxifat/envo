import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useSession } from '@/state/session';
import { space } from '@/theme/tokens';
import { StepDots } from './StepDots';

const MOBILE = /^01[3-9]\d{8}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

/** Step 1 of getting a number: who you are and how to sign in. */
export function SignUpScreen() {
  const { signUp } = useSession();
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const mobileRef = useRef<InputRef>(null);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  const errors = {
    name: form.name.trim().length < 2 ? 'Enter your full name' : null,
    mobile: !MOBILE.test(form.mobile) ? 'Enter your mobile number, like 01712345678' : null,
    email: !EMAIL.test(form.email.trim()) ? 'Enter a valid email' : null,
    password: form.password.length < 8 ? 'Use at least 8 characters' : null,
  };
  const ok = !Object.values(errors).some(Boolean);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setTried(true);
    if (!ok) return;
    setBusy(true);
    try {
      await signUp({ ...form, name: form.name.trim(), email: form.email.trim().toLowerCase() });
      router.replace('/kyc');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title="" scroll footer={<Button title="Continue" onPress={submit} loading={busy} block />}>
      <StepDots step={0} />
      <Text variant="title" style={styles.title}>
        Create your account
      </Text>
      <Text tone="secondary" style={styles.lead}>
        It takes about three minutes. Next we ask for your NID, as the BTRC requires for every number.
      </Text>
      <View style={styles.fields}>
        <Input label="Full name" placeholder="As on your NID" value={form.name} onChangeText={set('name')} autoCapitalize="words" autoComplete="name" returnKeyType="next" onSubmitEditing={() => mobileRef.current?.focus()} error={tried ? errors.name : null} />
        <Input ref={mobileRef} label="Mobile number" placeholder="01712345678" value={form.mobile} onChangeText={(v) => set('mobile')(v.replace(/\D/g, '').slice(0, 11))} keyboardType="phone-pad" autoComplete="tel" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} error={tried ? errors.mobile : null} hint="We send important messages here" />
        <Input ref={emailRef} label="Email" placeholder="you@example.com" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} error={tried ? errors.email : null} />
        <Input ref={passwordRef} label="Password" placeholder="At least 8 characters" value={form.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" returnKeyType="done" onSubmitEditing={submit} error={tried ? errors.password : null} />
      </View>
      <Text variant="caption" tone="tertiary" style={styles.note}>
        By continuing you agree to Enfinito's terms and privacy policy.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: space.lg },
  lead: { marginTop: space.sm },
  fields: { gap: space.lg, marginTop: space.xl },
  note: { marginTop: space.lg },
});
