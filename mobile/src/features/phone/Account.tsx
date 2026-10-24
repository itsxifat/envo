import { Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BellRing, CircleHelp, Clock3, Copy, Grid3x3, KeyRound, LogOut, PhoneIncoming, Plus, ShieldCheck, Trash2, Vibrate } from 'lucide-react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { formatBdt, formatPhone } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { useSession } from '@/state/session';
import { RINGTONES, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/theme';
import { fonts, palette, radius, space } from '@/theme/tokens';

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
  const { simulateIncoming } = useCalls();
  const settings = useSettings();
  if (!account) return null;
  const status = STATUS[account.stage];
  // The first recharge is paid and support is checking it: nothing to pay again.
  const checking = account.stage === 'activate' && account.paymentInReview;
  const tone = RINGTONES.find((r) => r.id === settings.ringtone)?.name ?? 'Envo';
  const support = [
    ...(config?.support.phone ? [{ text: `Call ${config.support.phone}`, onPress: () => void Linking.openURL(`tel:${config.support.phone}`) }] : []),
    ...(config?.support.email ? [{ text: 'Send an email', onPress: () => void Linking.openURL(`mailto:${config.support.email}`) }] : []),
  ];
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
  // Neutral tiles take the page colour so they stand out on the grey list.
  const icon = (node: React.ReactNode, bg = colors.background) => <View style={[styles.rowIcon, { backgroundColor: bg }]}>{node}</View>;

  return (
    <Screen title="Account" scroll tabBar>
      <View style={styles.profile}>
        <Avatar name={account.name} size={60} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="heading">{account.name}</Text>
          <View style={styles.numberRow}>
            <Text tone="secondary">{account.number ? formatPhone(account.number) : 'No number yet'}</Text>
            {account.number && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy your number"
                hitSlop={10}
                onPress={async () => {
                  await Clipboard.setStringAsync(account.number!);
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }}
              >
                <Copy size={15} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
        <Badge label={status.label} tone={status.tone} />
      </View>

      <View style={styles.balanceCard}>
        <LinearGradient colors={['#1F57EB', '#14306f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Text style={styles.balanceLabel}>Calling balance</Text>
        <Text style={styles.balance}>{formatBdt(account.balance)}</Text>
        <View style={styles.balanceBottom}>
          {checking ? (
            <>
              <Clock3 size={18} color="#FFFFFF" />
              <Text style={styles.balanceHint}>We're checking your payment. Your number is activated as soon as it is confirmed.</Text>
            </>
          ) : (
            <>
              <Text style={styles.balanceHint}>{config?.free_onnet ? 'Calls to Envo numbers are free' : ''}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(account.stage === 'activate' ? '/activate' : '/recharge')}
                style={({ pressed }) => [styles.rechargeButton, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Plus size={16} color={palette.ink950} strokeWidth={2.6} />
                <Text style={styles.rechargeText}>{account.stage === 'activate' ? 'Activate' : 'Recharge'}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>

      <View style={styles.groups}>
        <ListGroup title="Sounds">
          <ListRow title="Ringtone" subtitle={tone} left={icon(<BellRing size={18} color={colors.brand} />, colors.brandSoft)} onPress={() => router.push('/ringtone')} chevron />
          <ListRow
            title="Vibrate when ringing"
            left={icon(<Vibrate size={18} color={colors.text} />)}
            right={<Switch value={settings.vibrate} onValueChange={settings.setVibrate} trackColor={{ true: colors.brand, false: colors.elementPressed }} thumbColor="#FFFFFF" />}
          />
          <ListRow
            title="Keypad sounds"
            left={icon(<Grid3x3 size={18} color={colors.text} />)}
            right={<Switch value={settings.keypadSounds} onValueChange={settings.setKeypadSounds} trackColor={{ true: colors.brand, false: colors.elementPressed }} thumbColor="#FFFFFF" />}
          />
        </ListGroup>

        <ListGroup title="Account">
          <ListRow title="Your details" subtitle={`${account.email} · ${account.mobile}`} left={icon(<ShieldCheck size={18} color={colors.text} />)} />
          <ListRow title="Change password" left={icon(<KeyRound size={18} color={colors.text} />)} chevron onPress={() => router.push('/password')} />
          <ListRow title="Help and support" subtitle={support.length ? 'Call or email Enfinito' : 'Coming soon'} left={icon(<CircleHelp size={18} color={colors.text} />)} chevron={support.length > 0} onPress={support.length ? () => Alert.alert('Help and support', 'How would you like to reach us?', [...support, { text: 'Cancel', style: 'cancel' }]) : undefined} />
          <ListRow title="Sign out" left={icon(<LogOut size={18} color={colors.danger} />, colors.dangerSoft)} danger onPress={signOut} />
        </ListGroup>

        <ListGroup>
          <ListRow
            title={account.closeRequested ? 'Closing requested' : 'Delete my account'}
            subtitle={account.closeRequested ? 'We will be in touch' : 'Your number is released and given back'}
            left={icon(<Trash2 size={18} color={colors.danger} />, colors.dangerSoft)}
            danger
            onPress={account.closeRequested ? undefined : confirmClose}
          />
        </ListGroup>

        {__DEV__ && (
          <ListGroup title="For development">
            <ListRow title="Try an incoming call" subtitle="Rings with your ringtone" left={icon(<PhoneIncoming size={18} color={colors.call} />, colors.callSoft)} onPress={() => simulateIncoming()} />
          </ListGroup>
        )}
      </View>
      <Text variant="caption" tone="tertiary" align="center" style={{ marginTop: space.xl }}>
        Envo Phone by Enfinito
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.xl },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceCard: { borderRadius: radius.xl, overflow: 'hidden', padding: space.xl, gap: 4 },
  balanceLabel: { fontFamily: fonts.medium, fontSize: 14, color: 'rgba(255,255,255,0.72)' },
  balance: { fontFamily: fonts.bold, fontSize: 36, color: '#FFFFFF', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  balanceBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, gap: space.md },
  balanceHint: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.72)', flex: 1 },
  rechargeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', height: 40, paddingHorizontal: 16, borderRadius: radius.pill },
  rechargeText: { fontFamily: fonts.semibold, fontSize: 14, color: palette.ink950 },
  groups: { gap: space.xl, marginTop: space.xl },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
