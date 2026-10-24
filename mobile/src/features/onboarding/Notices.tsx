import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Download, PauseCircle, WifiOff, type LucideIcon } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { IconTileTone } from '@/components/ui/IconTile';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { confirmSignOut } from './OnboardingHeader';

/** Signing out here means no calls on this phone until signing in again. */
const SIGN_OUT_TEXT = "You won't get calls on this phone until you sign in again. You'll need your email and password.";

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** A whole screen saying what happened, with what to do about it in the footer. */
function NoticeScreen({ icon, tone, title, body, children, footer }: { icon: LucideIcon; tone: IconTileTone; title: string; body: string; children?: ReactNode; footer?: ReactNode }) {
  return (
    <Screen scroll footer={footer}>
      <View style={styles.center}>
        <EmptyState icon={icon} tone={tone} title={title} body={body} style={styles.state}>
          {children}
        </EmptyState>
      </View>
    </Screen>
  );
}

/** Enfinito paused the account: calls are stopped, support can help. */
export function PausedScreen() {
  const { colors } = useTheme();
  const { account, config, signOut } = useSession();
  const phone = config?.support.phone;
  const email = config?.support.email;
  return (
    <NoticeScreen
      icon={PauseCircle}
      tone="warning"
      title="Your Envo Phone is paused"
      body="Calls in and out are stopped for now. Your number and balance are kept. Contact us and we'll help you get going again."
      footer={
        <>
          {phone ? <Button title="Call support" onPress={() => open(`tel:${phone}`)} block /> : null}
          {/* The main button when there's no number to call. */}
          {email ? <Button title="Email support" variant={phone ? 'secondary' : 'primary'} onPress={() => open(`mailto:${email}`)} block /> : null}
          <Button title="Sign out" variant="ghost" onPress={() => confirmSignOut(signOut, SIGN_OUT_TEXT)} block />
        </>
      }
    >
      {account && (
        <Card padded={false} style={styles.card}>
          {account.number ? (
            <>
              <Row label="Your number" value={formatPhone(account.number)} />
              <View style={[styles.hairline, { backgroundColor: colors.border }]} />
            </>
          ) : null}
          <Row label="Calling balance" value={formatBdt(account.balance)} />
        </Card>
      )}
    </NoticeScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text tone="secondary">{label}</Text>
      <Text variant="figure" numberOfLines={1} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

/** Signed in, but Envo can't be reached to load the account (no internet, or Envo is down). */
export function OfflineScreen() {
  const { refresh, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await refresh().catch(() => undefined);
    setBusy(false);
  };
  return (
    <NoticeScreen
      icon={WifiOff}
      tone="warning"
      title="Can't reach Envo"
      body="Check your internet connection. We keep trying, and you stay signed in."
      footer={
        <>
          <Button title="Try again" onPress={() => void retry()} loading={busy} block />
          <Button title="Sign out" variant="ghost" onPress={() => confirmSignOut(signOut, SIGN_OUT_TEXT)} block />
        </>
      }
    />
  );
}

/** This version of the app is older than the one Enfinito still supports. */
export function UpdateScreen({ url }: { url: string }) {
  return (
    <NoticeScreen
      icon={Download}
      tone="brand"
      title="Update Envo Phone"
      body="A newer version of the app is needed to keep calling. It takes a minute, and you stay signed in."
      footer={url ? <Button title="Update now" onPress={() => open(url)} block /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  // Centred when there's room; on a small phone it keeps its height and the page scrolls.
  center: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.xl },
  // Centred in the room the footer leaves, rather than the empty state's usual top gap.
  state: { paddingTop: 0 },
  card: { alignSelf: 'stretch', marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, paddingVertical: space.md },
  value: { flexShrink: 1, textAlign: 'right' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
