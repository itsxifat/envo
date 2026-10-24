import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Copy, MessageSquareText, Phone } from 'lucide-react-native';

import { useCallGate } from '@/components/CallGate';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListGroup } from '@/components/ui/ListRow';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { isEnvoNumber } from '@/lib/numbers';
import { toast } from '@/lib/toast';
import { useCalls } from '@/state/calls';
import type { Person } from '@/state/contacts';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { iconStroke, space } from '@/theme/tokens';

/**
 * A contact's numbers, from a tap on them in Contacts: call one (the green circle), copy it, or invite
 * someone who isn't on Envo yet by SMS.
 */
export function useContactSheet(): { open: (person: Person) => void; sheet: ReactNode } {
  const { colors } = useTheme();
  const { account, config } = useSession();
  const { dial } = useCalls();
  const gate = useCallGate();
  // The person stays shown while the sheet slides away.
  const [person, setPerson] = useState<Person | null>(null);
  const [visible, setVisible] = useState(false);
  const close = () => setVisible(false);
  const free = !!config?.free_onnet;
  const many = !!person && person.numbers.length > 1;
  // Only someone whose number works can invite people to call it.
  const invite = !!person && !person.envo && account?.stage === 'active' && !!account.number;

  const call = (number: string) => {
    if (!person) return;
    close();
    gate.guard(() => dial(number, person.name), number);
  };

  const copy = async (number: string) => {
    try {
      await Clipboard.setStringAsync(number);
    } catch {
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast('Number copied');
    close();
  };

  const sendInvite = () => {
    if (!person || !account?.number) return;
    const text = `I'm on Envo: ${formatPhone(account.number)}.${free ? ' Calls between Envo numbers are free.' : ''}`;
    close();
    void Linking.openURL(`sms:${person.numbers[0]}?body=${encodeURIComponent(text)}`).catch(() => undefined);
  };

  const sheet = (
    <>
      <Sheet visible={visible} onClose={close}>
        {person && (
          <>
            <View style={styles.head}>
              <Avatar name={person.name} size={56} />
              <Text variant="heading" numberOfLines={2} accessibilityRole="header" style={styles.flex}>
                {person.name}
              </Text>
            </View>
            <View style={styles.numbers}>
              <ListGroup>
                {person.numbers.map((n) => (
                  <View key={n} style={styles.row}>
                    <View style={styles.number}>
                      <Text variant="bodyMedium" numberOfLines={1} style={[styles.shrink, styles.tabular]}>
                        {formatPhone(n)}
                      </Text>
                      {free && isEnvoNumber(n) && <Badge label="Free" tone="call" />}
                    </View>
                    {/* With several numbers each one is copied on its own row. */}
                    {many && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Copy ${formatPhone(n)}`}
                        hitSlop={4}
                        onPress={() => void copy(n)}
                        style={({ pressed }) => [styles.circle, pressed && { backgroundColor: colors.elementPressed }]}
                      >
                        <Copy size={18} color={colors.textSecondary} strokeWidth={iconStroke} />
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${formatPhone(n)}`}
                      hitSlop={4}
                      onPress={() => call(n)}
                      style={({ pressed }) => [styles.circle, { backgroundColor: colors.callSoft }, pressed && styles.pressed]}
                    >
                      <Phone size={18} color={colors.callText} strokeWidth={iconStroke} />
                    </Pressable>
                  </View>
                ))}
              </ListGroup>
            </View>
            {(!many || invite) && (
              <View style={styles.buttons}>
                {!many && <Button title="Copy number" variant="secondary" block onPress={() => void copy(person.numbers[0]!)} />}
                {invite && <Button title="Invite to Envo" variant="secondary" icon={MessageSquareText} block onPress={sendInvite} />}
              </View>
            )}
          </>
        )}
      </Sheet>
      {gate.sheet}
    </>
  );

  return {
    open: (p) => {
      setPerson(p);
      setVisible(true);
    },
    sheet,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  numbers: { marginTop: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingVertical: space.sm, paddingLeft: space.lg, paddingRight: space.sm },
  number: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.94 }] },
  buttons: { gap: space.sm, marginTop: space.xl },
});
