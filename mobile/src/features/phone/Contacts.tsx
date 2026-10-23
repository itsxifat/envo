import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Contact, ContactField, ContactsSortOrder, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts';
import { BookUser, ChevronDown, ChevronUp, Phone, Search } from 'lucide-react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { isEnvoNumber, useCalls } from '@/state/calls';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

interface Person {
  id: string;
  name: string;
  numbers: string[];
  envo: boolean;
}

/** "+880 1712-345678" → "01712345678", the way numbers are dialled in Bangladesh. */
export function normalizeNumber(raw: string): string {
  let n = raw.replace(/[^\d+]/g, '');
  if (n.startsWith('+880')) n = `0${n.slice(4)}`;
  else if (n.startsWith('880') && n.length === 13) n = `0${n.slice(3)}`;
  return n;
}

export function ContactsScreen() {
  const { colors } = useTheme();
  const { account } = useSession();
  const { dial } = useCalls();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], { sortOrder: ContactsSortOrder.GivenName });
    setPeople(
      rows
        .map((r, i) => {
          // Free Envo numbers first, so they are the ones shown and called.
          const numbers = [...new Set((r.phones ?? []).map((p) => normalizeNumber(p.number ?? '')).filter((n) => n.length >= 3))].sort((a, b) => Number(isEnvoNumber(b)) - Number(isEnvoNumber(a)));
          return { id: String(i), name: r.fullName?.trim() || (numbers[0] ? formatPhone(numbers[0]) : 'No name'), numbers, envo: numbers.some(isEnvoNumber) };
        })
        .filter((p) => p.numbers.length > 0),
    );
  }, []);

  useEffect(() => {
    void getPermissionsAsync().then((p) => {
      setAllowed(p.granted);
      if (p.granted) void load();
    });
  }, [load]);

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
      ...(envo.length ? [{ title: 'On Envo · free calls', data: envo, envo: true }] : []),
      ...[...byLetter.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))).map(([title, data]) => ({ title, data, envo: false })),
    ];
  }, [people, q]);

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
            Envo shows your phone's contacts here and marks the ones you can call for free. They stay on your phone.
          </Text>
          <Button
            title="Allow access to contacts"
            onPress={async () => {
              const p = await requestPermissionsAsync();
              setAllowed(p.granted);
              if (p.granted) void load();
            }}
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
                {item.envo && <Badge label="Free" tone="call" style={styles.badge} />}
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
                    {isEnvoNumber(n) && <Badge label="Free" tone="call" style={styles.badge} />}
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
