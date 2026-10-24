import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { PhoneCall, PhoneMissed } from 'lucide-react-native';

import { useCallGate } from '@/components/CallGate';
import { CallRow } from '@/components/CallRow';
import { useCallSheet } from '@/components/CallSheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { formatDay } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { useContacts } from '@/state/contacts';
import { useSession, type CallLog } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';

type Filter = 'all' | 'missed';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missed', label: 'Missed' },
];

/** Every call in and out, newest first, by day. A tap shows the call; the green circle calls back. */
export function RecentsScreen() {
  const { colors } = useTheme();
  const { recents: calls, recentsLoaded, account, offline, config, refresh, markRecentsSeen } = useSession();
  const { nameOf } = useContacts();
  const { dial } = useCalls();
  const gate = useCallGate();
  const callSheet = useCallSheet();
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => markRecentsSeen(), [markRecentsSeen]));

  // Calls carry no names: the phone's contacts give them.
  const recents = useMemo(() => calls.map((c) => (c.name ? c : { ...c, name: nameOf(c.number) })), [calls, nameOf]);
  const sections = useMemo(() => {
    const days = new Map<string, CallLog[]>();
    for (const c of recents) {
      if (filter === 'missed' && c.direction !== 'missed') continue;
      const day = formatDay(c.at);
      const list = days.get(day);
      if (list) list.push(c);
      else days.set(day, [c]);
    }
    return [...days].map(([title, data]) => ({ title, data }));
  }, [recents, filter]);
  // Until the list has come once, "no calls yet" may not be true.
  const loading = !recentsLoaded && !offline && (account?.stage === 'active' || account?.stage === 'registering');

  const pull = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      // The list stays as it is; the offline notices say why.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      title="Calls"
      tabBar
      right={<SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />}
      contentStyle={styles.content}
    >
      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} colors={[colors.brand]} tintColor={colors.brand} progressBackgroundColor={colors.surface} />}
        renderSectionHeader={({ section }) => (
          <Text variant="small" tone="secondary" accessibilityRole="header" style={styles.day}>
            {section.title}
          </Text>
        )}
        renderItem={({ item, section }) => (
          <CallRow item={item} time={section.title === 'Today' ? 'when' : 'clock'} onPress={() => callSheet.open(item)} onCall={() => gate.guard(() => dial(item.number, item.name), item.number)} />
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brand} style={styles.loading} />
          ) : filter === 'missed' ? (
            <EmptyState icon={PhoneMissed} title="No missed calls" />
          ) : (
            <EmptyState
              icon={PhoneCall}
              title="No calls yet"
              body={`Calls you make and get show up here.${config?.free_onnet ? ' Calls to Envo numbers are free.' : ''}`}
              action={{ title: 'Open keypad', onPress: () => router.navigate('/keypad') }}
            />
          )
        }
      />
      {callSheet.sheet}
      {gate.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Screen leaves a space above the tab bar; the list runs down to the bar and keeps its own space.
  content: { paddingHorizontal: 0, marginBottom: -space.xl },
  list: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: space.xl },
  day: { marginTop: space.lg, marginBottom: space.xs, marginLeft: space.sm },
  loading: { marginTop: 72 },
});
