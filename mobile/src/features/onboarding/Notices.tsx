import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Download, PauseCircle, WifiOff } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';

function Notice({ icon, title, text, footer }: { icon: React.ReactNode; title: string; text: string; footer?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Screen footer={footer}>
      <View style={styles.center}>
        <View style={[styles.icon, { backgroundColor: colors.surface }]}>{icon}</View>
        <Text variant="title" align="center">
          {title}
        </Text>
        <Text tone="secondary" align="center">
          {text}
        </Text>
      </View>
    </Screen>
  );
}

/** Enfinito paused the account: calls are stopped, support can help. */
export function PausedScreen() {
  const { colors } = useTheme();
  const { config, signOut } = useSession();
  const phone = config?.support.phone;
  return (
    <Notice
      icon={<PauseCircle size={34} color={colors.warning} />}
      title="Your Envo Phone is paused"
      text="Calls are stopped for now. Please contact us and we'll help you get going again."
      footer={
        <>
          {phone ? <Button title={`Call ${phone}`} onPress={() => void Linking.openURL(`tel:${phone}`)} block /> : null}
          <Button title="Sign out" variant="ghost" onPress={signOut} block />
        </>
      }
    />
  );
}

/** Signed in, but Envo can't be reached to load the account (no internet, or Envo is down). */
export function OfflineScreen() {
  const { colors } = useTheme();
  const { refresh, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await refresh().catch(() => undefined);
    setBusy(false);
  };
  return (
    <Notice
      icon={<WifiOff size={32} color={colors.warning} />}
      title="Can't reach Envo"
      text="Check your internet connection. We keep trying, and you stay signed in."
      footer={
        <>
          <Button title="Try again" onPress={() => void retry()} loading={busy} block />
          <Button title="Sign out" variant="ghost" onPress={signOut} block />
        </>
      }
    />
  );
}

/** This version of the app is older than the one Enfinito still supports. */
export function UpdateScreen({ url }: { url: string }) {
  const { colors } = useTheme();
  return (
    <Notice
      icon={<Download size={32} color={colors.brand} />}
      title="Update Envo Phone"
      text="A newer version of the app is needed to keep calling. It takes a minute, and you stay signed in."
      footer={url ? <Button title="Update now" onPress={() => void Linking.openURL(url)} block /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.md },
  icon: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
