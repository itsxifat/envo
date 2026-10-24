import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { BookUser, ChevronDown, ChevronUp, Phone, Search } from 'lucide-react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { isEnvoNumber } from '@/lib/numbers';
import { useCalls } from '@/state/calls';
import { useContacts, type Person } from '@/state/contacts';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

export function ContactsScreen() {
  const { colors } = useTheme();
  const { account, config } = useSession();
  const { dial } = useCalls();
  const { allowed, people, ask } = useContacts();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
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

  const call = (number: string, name: string) => (account?.stage === 'active' ? dial(number, name) : router.push('/'));

  if (allowed === false) {
    return (
      <Screen title="Contacts" tabBar>
        <View style={styles.ask}>
          <View style={[styles.askIcon, { backgroundColor: colors.brandSoft }]}>
            <BookUser size={32} color={colors.brand} />
          </View>
          <Text variant="heading" align="center">
            Call your contacts from Envo
          </Text>
          <Text tone="secondary" align="center">
            {free ? "Envo shows your phone's contacts here and marks the ones you can call for free. They stay on your phone." : "Envo shows your phone's contacts here, so you can call them in a tap. They stay on your phone."}
          </Text>
          <Button
            title="Allow access to contacts"
            onPress={() => void ask()}
            style={{ marginTop: space.md }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Contacts" subtitle={people.length ? `${people.length} people` : undefined} tabBar contentStyle={{ paddingHorizontal: 0 }}>
      <View style={styles.search}>
        <Input placeholder="Search name or number" value={q} onChangeText={setQ} right={<Search size={18} color={colors.textTertiary} style={{ marginRight: space.lg }} />} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(p, i) => `${p.id}-${i}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 120 }}
        renderSectionHeader={({ section }) => (
          <Text variant="small" tone={section.envo ? 'call' : 'tertiary'} style={styles.sectionTitle}>
            {section.title}
          </Text>
        )}
        ListEmptyComponent={
          allowed === null ? undefined : (
            <Text tone="secondary" align="center" style={{ marginTop: 60 }}>
              {q ? 'Nobody matches that.' : 'No contacts with phone numbers yet.'}
            </Text>
          )
        }
        renderItem={({ item, section }) => {
          const many = item.numbers.length > 1;
          // A person can be listed twice (On Envo and A-Z): only the row tapped opens.
          const key = `${section.title}:${item.id}`;
          const expanded = open === key;
          return (
            <View>
              <Pressable
                accessibilityRole="button"
                onPress={() => (many ? setOpen(expanded ? null : key) : call(item.numbers[0]!, item.name))}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
              >
                <Avatar name={item.name} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {formatPhone(item.numbers[0]!)}
                    {many ? `  ·  ${item.numbers.length - 1} more` : ''}
                  </Text>
                </View>
                {free && item.envo && <Badge label="Free" tone="call" style={styles.badge} />}
                {many ? (
                  <View style={[styles.callIcon, { backgroundColor: colors.element }]}>
                    {expanded ? <ChevronUp size={18} color={colors.textSecondary} /> : <ChevronDown size={18} color={colors.textSecondary} />}
                  </View>
                ) : (
                  <View style={[styles.callIcon, { backgroundColor: colors.callSoft }]}>
                    <Phone size={17} color={colors.call} />
                  </View>
                )}
              </Pressable>
              {expanded &&
                item.numbers.map((n) => (
                  <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Call ${n}`} onPress={() => call(n, item.name)} style={({ pressed }) => [styles.subRow, pressed && { backgroundColor: colors.surface }]}>
                    <Text variant="body" style={{ flex: 1 }}>
                      {formatPhone(n)}
                    </Text>
                    {free && isEnvoNumber(n) && <Badge label="Free" tone="call" style={styles.badge} />}
                    <View style={[styles.callIcon, { backgroundColor: colors.callSoft }]}>
                      <Phone size={17} color={colors.call} />
                    </View>
                  </Pressable>
                ))}
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: space.xl, paddingBottom: space.sm },
  sectionTitle: { marginTop: space.lg, marginBottom: space.xs, marginLeft: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, paddingVertical: 10, borderRadius: radius.md },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginLeft: 64, paddingVertical: 10, paddingHorizontal: space.sm, borderRadius: radius.md },
  badge: { alignSelf: 'center' },
  callIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  ask: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingBottom: 120 },
  askIcon: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
