import { useMemo, useState } from 'react';
import { Linking, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { Phone, Search } from 'lucide-react-native';

import { useCallGate } from '@/components/CallGate';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { useContacts, type Person } from '@/state/contacts';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { iconStroke, radius, space } from '@/theme/tokens';
import { useContactSheet } from './ContactSheet';

/** Three made-up people for the picture on the permission screen (their tints are blue, green and orange). */
const SAMPLE = ['Ayesha Rahman', 'Karim Hossain', 'Sadia Mim'];

export function ContactsScreen() {
  const { colors } = useTheme();
  const { config } = useSession();
  const { dial } = useCalls();
  const { allowed, canAskAgain, people, ask } = useContacts();
  const gate = useCallGate();
  const contactSheet = useContactSheet();
  const [q, setQ] = useState('');
  // Calls to Envo numbers are free only when Enfinito makes them so.
  const free = !!config?.free_onnet;

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const match = (p: Person) => !needle || p.name.toLowerCase().includes(needle) || (digits.length > 0 && p.numbers.some((n) => n.includes(digits)));
    const found = people.filter(match);
    const envo = found.filter((p) => p.envo);
    const byLetter = new Map<string, Person[]>();
    for (const p of found) {
      const letter = /[A-Za-z]/.test(p.name[0] ?? '') ? p.name[0]!.toUpperCase() : '#';
      byLetter.set(letter, [...(byLetter.get(letter) ?? []), p]);
    }
    return [
      ...(envo.length ? [{ title: free ? 'On Envo · free calls' : 'On Envo', data: envo, envo: true }] : []),
      ...[...byLetter.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))).map(([title, data]) => ({ title, data, envo: false })),
    ];
  }, [people, q, free]);

  if (allowed === false) {
    return (
      <Screen title="Contacts" tabBar>
        <View style={styles.ask}>
          <View style={styles.faces} importantForAccessibility="no-hide-descendants">
            {SAMPLE.map((name, i) => (
              <View key={name} style={[styles.face, { borderColor: colors.background }, i > 0 && styles.overlap]}>
                <Avatar name={name} size={48} />
              </View>
            ))}
            {free && <Badge label="Free" tone="call" dot style={styles.freeBadge} />}
          </View>
          <Text variant="heading" align="center" accessibilityRole="header" style={styles.askTitle}>
            {free ? "See who's on Envo" : 'Call your contacts from Envo'}
          </Text>
          <Text tone="secondary" align="center" style={styles.askBody}>
            {free ? 'Calls to Envo numbers are free. Your contacts stay on your phone.' : "Call anyone in your phone's contacts in a tap. They stay on your phone."}
          </Text>
          <Button
            title={canAskAgain ? 'Allow contacts' : 'Open settings'}
            size="md"
            onPress={() => void (canAskAgain ? ask().catch(() => undefined) : Linking.openSettings().catch(() => undefined))}
            style={styles.askButton}
          />
          {!canAskAgain && (
            <Text variant="caption" tone="secondary" align="center" style={styles.askNote}>
              Contacts are off for Envo. Turn them on in Settings, then Permissions.
            </Text>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Contacts" subtitle={people.length ? `${people.length.toLocaleString('en-US')} ${people.length === 1 ? 'person' : 'people'}` : undefined} tabBar contentStyle={styles.content}>
      <View style={styles.search}>
        <Input placeholder="Search name or number" value={q} onChangeText={setQ} right={<Search size={18} color={colors.textTertiary} strokeWidth={iconStroke} style={{ marginRight: space.lg }} />} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(p, i) => `${p.id}-${i}`}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text variant="small" tone={section.envo ? 'call' : 'secondary'} accessibilityRole="header" style={styles.sectionTitle}>
            {section.title}
          </Text>
        )}
        ListEmptyComponent={
          allowed === null ? undefined : (
            <Text tone="secondary" align="center" style={styles.empty}>
              {q ? 'Nobody matches that.' : 'No contacts with phone numbers yet.'}
            </Text>
          )
        }
        renderItem={({ item }) => {
          const more = item.numbers.length - 1;
          const first = formatPhone(item.numbers[0]!);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${first}${more ? `, and ${more} more` : ''}`}
              onPress={() => contactSheet.open(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
            >
              <Avatar name={item.name} />
              <View style={styles.text}>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.tabular}>
                  {more ? `${first} · ${more} more` : first}
                </Text>
              </View>
              {free && item.envo && <Badge label="Free" tone="call" style={styles.badge} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${item.name}`}
                hitSlop={4}
                onPress={() => gate.guard(() => dial(item.numbers[0]!, item.name), item.numbers[0])}
                style={({ pressed }) => [styles.call, { backgroundColor: colors.callSoft }, pressed && styles.pressed]}
              >
                <Phone size={18} color={colors.callText} strokeWidth={iconStroke} />
              </Pressable>
            </Pressable>
          );
        }}
      />
      {contactSheet.sheet}
      {gate.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Screen leaves a space above the tab bar; the list runs down to the bar and keeps its own space.
  content: { paddingHorizontal: 0, marginBottom: -space.xl },
  search: { paddingHorizontal: space.xl, paddingBottom: space.sm },
  list: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: space.xl },
  sectionTitle: { marginTop: space.lg, marginBottom: space.xs, marginLeft: space.sm },
  empty: { marginTop: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: radius.md },
  text: { flex: 1, gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  badge: { alignSelf: 'center' },
  call: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.94 }] },
  ask: { alignItems: 'center', paddingTop: 96 },
  faces: { flexDirection: 'row' },
  // A ring of the page colour keeps the overlapping faces apart; each overlaps the last by 14.
  face: { borderWidth: 3, borderRadius: 27 },
  overlap: { marginLeft: -14 },
  freeBadge: { position: 'absolute', top: -8, right: -22 },
  askTitle: { marginTop: space.xl },
  askBody: { marginTop: space.sm, maxWidth: 300 },
  askButton: { marginTop: space.xl },
  askNote: { marginTop: space.md, maxWidth: 300 },
});
