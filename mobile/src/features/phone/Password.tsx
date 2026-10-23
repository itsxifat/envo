import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { useSession } from '@/state/session';
import { space } from '@/theme/tokens';

/** A new password. Every other phone and browser signed in to the account is signed out. */
export function PasswordScreen() {
  const { changePassword } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRef = useRef<InputRef>(null);
  const ready = current.length > 0 && next.length >= 8;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title="Change password" scroll footer={<Button title="Save new password" onPress={save} loading={busy} disabled={!ready} block />}>
      <Text tone="secondary" style={styles.lead}>
        Other phones and browsers signed in to your account are signed out. This phone stays signed in.
      </Text>
      <View style={styles.fields}>
        <Input label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" returnKeyType="next" onSubmitEditing={() => nextRef.current?.focus()} />
        <Input ref={nextRef} label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" hint="At least 8 characters" returnKeyType="done" onSubmitEditing={save} />
        {error && <Text tone="danger">{error}</Text>}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.sm },
  fields: { gap: space.lg, marginTop: space.xl },
});
