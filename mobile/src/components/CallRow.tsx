import { Pressable, StyleSheet, View } from 'react-native';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react-native';

import { formatBdt, formatClock, formatPhone, formatTalk, formatWhen } from '@/lib/format';
import type { CallLog } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { iconStroke, radius, space } from '@/theme/tokens';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { Text } from './ui/Text';

/** "Outgoing", "Incoming", "Missed call". */
export const directionWord = (c: CallLog) => (c.direction === 'missed' ? 'Missed call' : c.direction === 'in' ? 'Incoming' : 'Outgoing');

/**
 * One call in a list: who, which way and how long, when and what it cost, and a green circle to call
 * back. A tap on the row itself opens the call's sheet (it never places a paid call by itself).
 */
export function CallRow({ item, onPress, onCall, time = 'when' }: { item: CallLog; onPress: () => void; onCall: () => void; time?: 'when' | 'clock' }) {
  const { colors } = useTheme();
  const missed = item.direction === 'missed';
  const Icon = item.direction === 'in' ? PhoneIncoming : item.direction === 'out' ? PhoneOutgoing : PhoneMissed;
  const who = item.name ?? formatPhone(item.number);
  const talk = formatTalk(item.duration);
  // A named call shows its number first; the arrow already says which way it went.
  const meta = [item.name ? formatPhone(item.number) : null, item.name && !missed ? null : directionWord(item), talk || null].filter(Boolean).join(' · ');
  const when = time === 'clock' ? formatClock(item.at) : formatWhen(item.at);
  const price = item.free ? 'free' : item.cost != null ? formatBdt(item.cost) : null;
  const spoken = `${missed ? 'Missed call from' : item.direction === 'in' ? 'Incoming call from' : 'Outgoing call to'} ${who}, ${[talk, price, when].filter(Boolean).join(', ')}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={spoken} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}>
      <Avatar name={item.name} size={44} />
      <View style={styles.text}>
        <Text variant="bodyMedium" tone={missed ? 'danger' : 'default'} numberOfLines={1}>
          {who}
        </Text>
        <View style={styles.meta}>
          <Icon size={14} color={missed ? colors.danger : colors.textSecondary} strokeWidth={2} />
          <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.flex}>
            {meta}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text variant="caption" tone="secondary" style={styles.tabular}>
          {when}
        </Text>
        {/* What a call out cost; calls in, missed calls and ones not charged yet show none. */}
        {item.free ? (
          <Badge label="Free" tone="call" style={styles.badge} />
        ) : item.cost != null ? (
          <Text variant="caption" tone="secondary" style={styles.tabular}>
            {formatBdt(item.cost)}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Call ${who}`}
        hitSlop={4}
        onPress={onCall}
        style={({ pressed }) => [styles.call, { backgroundColor: colors.callSoft }, pressed && styles.pressed]}
      >
        <Phone size={18} color={colors.callText} strokeWidth={iconStroke} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: radius.md },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  right: { alignItems: 'flex-end', gap: 4 },
  tabular: { fontVariant: ['tabular-nums'] },
  badge: { alignSelf: 'flex-end' },
  call: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.94 }] },
});
