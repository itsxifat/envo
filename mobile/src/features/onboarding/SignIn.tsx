import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useSession } from '@/state/session';
import { space } from '@/theme/tokens';

export function SignInScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<InputRef>(null);
  const ready = /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= 8;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace('/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title="" scroll footer={<Button title="Sign in" onPress={submit} loading={busy} disabled={!ready} block />}>
      <View style={styles.head}>
        <LogoMark size={52} />
        <Text variant="title" style={styles.title}>
          Welcome back
        </Text>
        <Text tone="secondary">Sign in to make and take calls on your Envo number.</Text>
      </View>
      <View style={styles.fields}>
        <Input label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <Input ref={passwordRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" returnKeyType="done" onSubmitEditing={submit} />
        <Button title="Forgot password?" variant="ghost" size="md" style={styles.forgot} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm, marginTop: space.md },
  title: { marginTop: space.lg },
  fields: { gap: space.lg, marginTop: space.xl },
  forgot: { alignSelf: 'flex-start', paddingHorizontal: 4 },
});
