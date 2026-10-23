import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Phone } from 'lucide-react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatDuration, formatPhone, formatWhen } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { useContacts } from '@/state/contacts';
import { useSession, type CallLog } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

/** Every call in and out, newest first; tap one to call back. */
export function RecentsScreen() {
  const { colors } = useTheme();
  const { recents: calls, account, markRecentsSeen } = useSession();
  const { nameOf } = useContacts();
  // Calls carry no names: the phone's contacts give them.
  const recents = useMemo(() => calls.map((c) => (c.name ? c : { ...c, name: nameOf(c.number) })), [calls, nameOf]);
  const { dial } = useCalls();
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const list = useMemo(() => (filter === 'missed' ? recents.filter((r) => r.direction === 'missed') : recents), [recents, filter]);
  const canCall = account?.stage === 'active';
  useFocusEffect(useCallback(() => markRecentsSeen(), [markRecentsSeen]));

  return (
    <Screen
      title="Recents"
      tabBar
      right={
        <View style={[styles.segment, { backgroundColor: colors.element }]}>
          {(['all', 'missed'] as const).map((f) => (
            <Pressable key={f} accessibilityRole="tab" accessibilityState={{ selected: filter === f }} onPress={() => setFilter(f)} style={[styles.segmentItem, filter === f && { backgroundColor: colors.background }]}>
              <Text variant="label" tone={filter === f ? 'default' : 'secondary'}>
                {f === 'all' ? 'All' : 'Missed'}
              </Text>
            </Pressable>
          ))}
        </View>
      }
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <FlatList
        data={list}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}>
              <Phone size={26} color={colors.textTertiary} />
            </View>
            <Text variant="heading">{filter === 'missed' ? 'No missed calls' : 'No calls yet'}</Text>
            <Text tone="secondary" align="center">
              Your calls show up here.
            </Text>
          </View>
        }
        renderItem={({ item }) => <RecentRow item={item} onCall={() => (canCall ? dial(item.number, item.name) : router.push('/'))} />}
      />
    </Screen>
  );
}

function RecentRow({ item, onCall }: { item: CallLog; onCall: () => void }) {
  const { colors } = useTheme();
  const missed = item.direction === 'missed';
  const Icon = item.direction === 'in' ? PhoneIncoming : item.direction === 'out' ? PhoneOutgoing : PhoneMissed;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Call ${item.name ?? item.number}`} onPress={onCall} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}>
      <Avatar name={item.name} />
      <View style={styles.text}>
        <Text variant="bodyMedium" tone={missed ? 'danger' : 'default'} numberOfLines={1}>
          {item.name ?? formatPhone(item.number)}
        </Text>
        <View style={styles.meta}>
          <Icon size={13} color={missed ? colors.danger : colors.textSecondary} />
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {item.name ? formatPhone(item.number) : missed ? 'Missed call' : item.direction === 'in' ? 'Incoming' : 'Outgoing'}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text variant="caption" tone="tertiary">
          {formatWhen(item.at)}
        </Text>
        {item.free && <Badge label="Free" tone="call" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  segmentItem: { paddingHorizontal: 14, height: 32, borderRadius: radius.pill, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, paddingVertical: 10, borderRadius: radius.md },
  text: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  right: { alignItems: 'flex-end', gap: 4 },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: 80, paddingHorizontal: space.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
