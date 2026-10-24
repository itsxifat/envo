import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CircleAlert } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { ApiError, errorText } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useSession } from '@/state/session';
import { space } from '@/theme/tokens';

/** A new password. Every other phone and browser signed in to the account is signed out. */
export function PasswordScreen() {
  const { changePassword } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  // The button always works: what's missing shows once it is pressed.
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  // Envo said the current password is wrong: shown under that field.
  const [wrong, setWrong] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<InputRef>(null);
  const nextRef = useRef<InputRef>(null);
  const currentError = tried && !current ? 'Enter your current password' : wrong;
  const nextError = tried && next.length < 8 ? 'Use at least 8 characters' : null;

  const save = async () => {
    setTried(true);
    if (!current) return currentRef.current?.focus();
    if (next.length < 8) return nextRef.current?.focus();
    setBusy(true);
    setError(null);
    setWrong(null);
    try {
      await changePassword(current, next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast('Password changed');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      const message = errorText(err);
      if (err instanceof ApiError && err.status === 400 && /current password/i.test(message)) {
        setWrong(message);
        currentRef.current?.focus();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      title="Change password"
      scroll
      footer={
        <>
          {error && <Notice tone="danger" icon={CircleAlert} title={error} />}
          <Button title="Save new password" onPress={() => void save()} loading={busy} block />
        </>
      }
    >
      <Text tone="secondary" style={styles.lead}>
        Changing it signs you out on your other phones and browsers. This phone stays signed in.
      </Text>
      <View style={styles.fields}>
        <Input
          ref={currentRef}
          label="Current password"
          value={current}
          onChangeText={(v) => {
            setCurrent(v);
            setWrong(null);
          }}
          error={currentError}
          secureTextEntry
          autoComplete="current-password"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => nextRef.current?.focus()}
        />
        <Input
          ref={nextRef}
          label="New password"
          value={next}
          onChangeText={setNext}
          error={nextError}
          secureTextEntry
          autoComplete="new-password"
          hint="At least 8 characters"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.sm },
  fields: { gap: space.lg, marginTop: space.xl },
});
