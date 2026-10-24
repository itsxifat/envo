import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Phone } from 'lucide-react-native';

import { formatBdt, formatClock, formatDay, formatPhone, formatTalk } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useCalls } from '@/state/calls';
import type { CallLog } from '@/state/session';
import { space } from '@/theme/tokens';
import { useCallGate } from './CallGate';
import { directionWord } from './CallRow';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import { Text } from './ui/Text';

/** A call's details, from a tap on it in a list: when, how long, what it cost; call back or copy the number. */
export function useCallSheet(): { open: (item: CallLog) => void; sheet: ReactNode } {
  const { dial } = useCalls();
  const gate = useCallGate();
  // The call stays shown while the sheet slides away.
  const [item, setItem] = useState<CallLog | null>(null);
  const [visible, setVisible] = useState(false);
  const close = () => setVisible(false);

  const talk = item ? formatTalk(item.duration) : '';
  // Only calls out have a price, once they connected or were charged.
  const priced = !!item && item.direction === 'out' && (item.duration > 0 || item.cost != null);
  const cost = [talk, priced ? (item.free ? 'Free call' : item.cost != null ? formatBdt(item.cost) : null) : null].filter(Boolean).join(' · ');

  const sheet = (
    <>
      <Sheet visible={visible} onClose={close}>
        {item && (
          <>
            <View style={styles.head}>
              <Avatar name={item.name} size={56} />
              <View style={styles.flex}>
                <Text variant="heading" numberOfLines={1} accessibilityRole="header">
                  {item.name ?? formatPhone(item.number)}
                </Text>
                {item.name && <Text tone="secondary">{formatPhone(item.number)}</Text>}
              </View>
            </View>
            <View style={styles.lines}>
              <Text variant="caption" tone="secondary">
                {`${directionWord(item)} · ${formatDay(item.at)}, ${formatClock(item.at)}`}
              </Text>
              {cost ? (
                <Text variant="caption" tone="secondary">
                  {cost}
                </Text>
              ) : null}
            </View>
            <View style={styles.buttons}>
              <Button
                title="Call"
                variant="call"
                icon={Phone}
                block
                onPress={() => {
                  close();
                  gate.guard(() => dial(item.number, item.name), item.number);
                }}
              />
              <Button
                title="Copy number"
                variant="secondary"
                block
                onPress={async () => {
                  try {
                    await Clipboard.setStringAsync(item.number);
                  } catch {
                    return;
                  }
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  toast('Number copied');
                  close();
                }}
              />
            </View>
          </>
        )}
      </Sheet>
      {gate.sheet}
    </>
  );

  return {
    open: (c) => {
      setItem(c);
      setVisible(true);
    },
    sheet,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lines: { gap: 2, marginTop: space.lg },
  buttons: { gap: space.sm, marginTop: space.xl },
});
