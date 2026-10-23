import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BellRing, CircleHelp, Copy, Grid3x3, LogOut, PhoneIncoming, Plus, ShieldCheck, Vibrate } from 'lucide-react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatPhone } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { useSession } from '@/state/session';
import { RINGTONES, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/theme';
import { fonts, palette, radius, space } from '@/theme/tokens';

const STATUS = {
  kyc: { label: 'Details needed', tone: 'warning' },
  activate: { label: 'Not active yet', tone: 'warning' },
  registering: { label: 'Being registered', tone: 'warning' },
  active: { label: 'Active', tone: 'call' },
} as const;

export function AccountScreen() {
  const { colors } = useTheme();
  const { account, signOut, devActivate } = useSession();
  const { simulateIncoming } = useCalls();
  const settings = useSettings();
  if (!account) return null;
  const status = STATUS[account.stage];
  const tone = RINGTONES.find((r) => r.id === settings.ringtone)?.name ?? 'Envo';
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
          <Text style={styles.balanceHint}>Calls to Envo numbers are free</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(account.stage === 'activate' ? '/activate' : '/recharge')}
            style={({ pressed }) => [styles.rechargeButton, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Plus size={16} color={palette.ink950} strokeWidth={2.6} />
            <Text style={styles.rechargeText}>{account.stage === 'activate' ? 'Activate' : 'Recharge'}</Text>
          </Pressable>
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
          <ListRow title="Your details" subtitle={`${account.email} · ${account.mobile}`} left={icon(<ShieldCheck size={18} color={colors.text} />)} chevron onPress={() => undefined} />
          <ListRow title="Help and support" subtitle="Call or message Enfinito" left={icon(<CircleHelp size={18} color={colors.text} />)} chevron onPress={() => undefined} />
          <ListRow title="Sign out" left={icon(<LogOut size={18} color={colors.danger} />, colors.dangerSoft)} danger onPress={signOut} />
        </ListGroup>

        {__DEV__ && (
          <ListGroup title="For development">
            <ListRow title="Try an incoming call" subtitle="Rings with your ringtone" left={icon(<PhoneIncoming size={18} color={colors.call} />, colors.callSoft)} onPress={() => simulateIncoming()} />
            {account.stage !== 'active' && <ListRow title="Mark the number as registered" left={icon(<ShieldCheck size={18} color={colors.text} />)} onPress={devActivate} />}
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
