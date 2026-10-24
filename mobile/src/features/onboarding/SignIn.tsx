import { useRef, useState } from 'react';
import { Keyboard, Linking, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { CircleAlert } from 'lucide-react-native';

import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { API_URL, errorText } from '@/lib/api';
import { startOf, useSession } from '@/state/session';
import { fonts, space } from '@/theme/tokens';
import { focusField, TextLink } from './OnboardingHeader';

/** The website, where a forgotten password is reset (the link in the email opens there). */
const WEB_URL = API_URL.replace(/\/api$/, '').replace('localhost:4310', 'localhost:5173');

const EMAIL = /^\S+@\S+\.\S+$/;

export function SignInScreen() {
  const { signIn } = useSession();
  // Sign up sends the email along when it already has an account.
  const params = useLocalSearchParams<{ email?: string }>();
  const given = typeof params.email === 'string' ? params.email : '';
  const [email, setEmail] = useState(given);
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  const clean = email.trim().toLowerCase();
  // No length rule here: older passwords may be shorter than today's 8 characters.
  const errors = {
    email: !clean ? 'Enter your email' : !EMAIL.test(clean) ? 'Enter a valid email' : null,
    password: !password ? 'Enter your password' : null,
  };

  const submit = async () => {
    if (busy) return;
    setTried(true);
    if (errors.email) return focusField(emailRef.current);
    if (errors.password) return focusField(passwordRef.current);
    Keyboard.dismiss();
    setBusy(true);
    setFailed(null);
    try {
      router.replace(startOf(await signIn(clean, password)));
    } catch (err) {
      setFailed(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Opens inside the app, like the payment page, so coming back is one tap.
  const forgot = () => {
    const url = `${WEB_URL}/forgot-password`;
    void WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
  };

  return (
    <Screen
      back
      title=""
      scroll
      footer={
        <>
          {failed && <Notice tone="danger" icon={CircleAlert} title={failed} />}
          <Button title="Sign in" onPress={() => void submit()} loading={busy} block />
        </>
      }
    >
      <View style={styles.head}>
        <View style={styles.brand}>
          <LogoMark size={40} />
          <Text style={styles.brandName}>envo</Text>
        </View>
        <Text variant="title" accessibilityRole="header" style={styles.title}>
          Welcome back
        </Text>
        <Text tone="secondary">Sign in to make and take calls on your Envo number.</Text>
      </View>
      <View style={styles.fields}>
        <Input
          ref={emailRef}
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setFailed(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => focusField(passwordRef.current)}
          error={tried ? errors.email : null}
        />
        <Input
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setFailed(null);
          }}
          secureTextEntry
          autoComplete="current-password"
          autoFocus={!!given}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          error={tried ? errors.password : null}
        />
        <TextLink title="Forgot password?" role="link" onPress={forgot} style={styles.forgot} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm, marginTop: space.md },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  title: { marginTop: space.lg },
  fields: { gap: space.lg, marginTop: space.xl },
  forgot: { marginTop: -space.sm },
});
