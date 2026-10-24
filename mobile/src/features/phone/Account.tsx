import { type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { BellRing, CircleHelp, Clock3, Copy, Grid3x3, KeyRound, LogOut, Mail, PhoneIncoming, PhoneOff, ReceiptText, Smartphone, Trash2, Vibrate, Wallet, type LucideIcon } from 'lucide-react-native';

import { useSupportSheet } from '@/components/SupportSheet';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { formatBdt, formatPhone } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useCalls } from '@/state/calls';
import { useSession } from '@/state/session';
import { RINGTONES, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';

const STATUS = {
  verify: { label: 'Email to confirm', tone: 'warning' },
  kyc: { label: 'Details needed', tone: 'warning' },
  activate: { label: 'Not active yet', tone: 'warning' },
  registering: { label: 'Being registered', tone: 'warning' },
  active: { label: 'Active', tone: 'call' },
  suspended: { label: 'Paused', tone: 'danger' },
} as const;

export function AccountScreen() {
  const { colors } = useTheme();
  const { account, config, signOut, closeAccount } = useSession();
  const { simulateIncoming, simulateFailure } = useCalls();
  const settings = useSettings();
  const support = useSupportSheet();
  if (!account) return null;
  const status = STATUS[account.stage];
  const tone = RINGTONES.find((r) => r.id === settings.ringtone)?.name ?? 'Envo';
  const rate = config?.rate_per_min ?? 0;
  const tile = (icon: LucideIcon, t: IconTileTone = 'neutral') => <IconTile icon={icon} size="sm" tone={t} on="surface" />;
  const switchColours = { true: colors.brand, false: colors.track };

  const copyNumber = async () => {
    if (!account.number) return;
    try {
      await Clipboard.setStringAsync(account.number);
    } catch {
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast('Number copied');
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', "You won't get calls on this phone until you sign in again. You'll need your email and password.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);

  const confirmClose = () =>
    Alert.alert('Delete your account?', 'Your number stops working and is given back. Any balance left is settled by support. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void closeAccount()
            .then((deleted) => !deleted && Alert.alert('Request sent', "We've got your request and will be in touch to finish closing your account."))
            .catch((err) => Alert.alert("Couldn't do that", errorText(err))),
      },
    ]);

  // Recharge, or the first one that activates the number; nothing to pay while a payment is checked.
  const balanceAction = account.paymentInReview ? (
    <Badge label="Checking" tone="warning" />
  ) : !account.number ? null : account.stage === 'activate' ? (
    <Button title="Activate" variant="secondary" size="sm" on="surface" onPress={() => router.push('/activate')} />
  ) : (
    <Button title="Recharge" variant="secondary" size="sm" on="surface" onPress={() => router.push('/recharge')} />
  );

  // A failed call shows differently for each reason (Android dialogs fit three choices).
  const tryFailure = () =>
    Alert.alert(
      'Try a call that fails',
      'Which way should it fail?',
      [
        { text: 'No answer', onPress: () => simulateFailure('no-answer') },
        { text: 'Busy', onPress: () => simulateFailure('busy') },
        { text: 'Balance runs out', onPress: () => simulateFailure('balance') },
      ],
      { cancelable: true },
    );

  return (
    <Screen title="Account" scroll tabBar>
      <View style={styles.profile}>
        <Avatar name={account.name} size={56} />
        <View style={styles.flex}>
          <Text variant="heading" numberOfLines={2}>
            {account.name}
          </Text>
          <View style={styles.numberRow}>
            <Text tone="secondary" style={styles.tabular}>
              {account.number ? formatPhone(account.number) : 'No number yet'}
            </Text>
            {account.number && (
              <Pressable accessibilityRole="button" accessibilityLabel="Copy your number" hitSlop={4} onPress={() => void copyNumber()} style={({ pressed }) => [styles.copy, pressed && { backgroundColor: colors.element }]}>
                <Copy size={16} color={colors.textSecondary} strokeWidth={2} />
              </Pressable>
            )}
          </View>
          <Badge label={status.label} tone={status.tone} dot style={styles.status} />
        </View>
      </View>

      <View style={styles.groups}>
        <ListGroup title="Calling balance">
          <Row
            left={tile(Wallet)}
            title={formatBdt(account.balance)}
            figure
            subtitle={config?.free_onnet ? 'Calls to Envo numbers are free' : rate > 0 ? `${formatBdt(rate)} a minute` : undefined}
            right={balanceAction}
          />
          <ListRow title="Balance history" left={tile(ReceiptText)} chevron onPress={() => router.push('/history')} />
        </ListGroup>

        <ListGroup title="Sounds">
          <ListRow title="Ringtone" subtitle={tone} left={tile(BellRing)} chevron onPress={() => router.push('/ringtone')} />
          <ListRow title="Vibrate when ringing" left={tile(Vibrate)} right={<Switch value={settings.vibrate} onValueChange={settings.setVibrate} trackColor={switchColours} thumbColor={colors.onBrand} />} />
          <ListRow title="Keypad sounds" left={tile(Grid3x3)} right={<Switch value={settings.keypadSounds} onValueChange={settings.setKeypadSounds} trackColor={switchColours} thumbColor={colors.onBrand} />} />
        </ListGroup>

        <View style={styles.details}>
          <ListGroup title="Your details">
            <Row left={tile(Smartphone)} title={formatPhone(account.mobile)} subtitle="Mobile" />
            <Row left={tile(Mail)} title={account.email} subtitle="Email" middle />
          </ListGroup>
          {support.available && (
            <Text variant="caption" tone="secondary" style={styles.groupNote}>
              To change these, contact support.
            </Text>
          )}
        </View>

        <ListGroup title="Account">
          <ListRow title="Change password" left={tile(KeyRound)} chevron onPress={() => router.push('/password')} />
          {support.available ? <ListRow title="Help and support" left={tile(CircleHelp)} chevron onPress={support.open} /> : null}
        </ListGroup>

        <ListGroup>
          <ListRow title="Sign out" left={tile(LogOut, 'danger')} danger onPress={confirmSignOut} />
        </ListGroup>

        <ListGroup>
          {account.closeRequested ? (
            <Row
              left={tile(Clock3)}
              title="Closing requested"
              subtitle={support.available ? "We'll be in touch. Changed your mind? Contact support." : "We'll be in touch."}
              onPress={support.available ? support.open : undefined}
            />
          ) : (
            <Row left={tile(Trash2, 'danger')} title="Delete my account" subtitle="Your number is released and given back" danger onPress={confirmClose} />
          )}
        </ListGroup>

        {__DEV__ && (
          <ListGroup title="For development">
            <ListRow title="Try an incoming call" subtitle="Rings with your ringtone" left={tile(PhoneIncoming, 'call')} onPress={() => simulateIncoming()} />
            <ListRow title="Try a call that fails" subtitle="No answer, busy or out of balance" left={tile(PhoneOff)} onPress={tryFailure} />
          </ListGroup>
        )}
      </View>
      <Text variant="caption" tone="secondary" align="center" style={styles.footer}>
        {['Envo Phone by Enfinito', Constants.expoConfig?.version].filter(Boolean).join(' · ')}
      </Text>
      {support.sheet}
    </Screen>
  );
}

/** A list row whose text may run to two lines (ListRow keeps one), or whose title is an amount. */
function Row({ left, title, subtitle, right, onPress, danger, figure, middle }: { left: ReactNode; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; danger?: boolean; figure?: boolean; middle?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elementPressed }]}>
      {left}
      <View style={styles.rowText}>
        <Text variant={figure ? 'figure' : 'bodyMedium'} tone={danger ? 'danger' : 'default'} numberOfLines={middle ? 1 : 2} ellipsizeMode={middle ? 'middle' : 'tail'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // 36 across (44 to tap, with the slop), though the icon is small.
  copy: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  status: { marginTop: 2 },
  groups: { gap: space.xl, marginTop: space.xl },
  details: { gap: space.sm },
  groupNote: { marginLeft: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  rowText: { flex: 1, gap: 2 },
  footer: { marginTop: space.xxl },
});
