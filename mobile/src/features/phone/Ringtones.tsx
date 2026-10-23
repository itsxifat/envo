import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, Music2 } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { RINGTONES, useSettings } from '@/state/settings';
import { Sounds } from '@/state/sounds';
import { useTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

/** Pick the ringtone; tapping one plays it once. */
export function RingtonesScreen() {
  const { colors } = useTheme();
  const { ringtone, setRingtone } = useSettings();
  useEffect(() => () => Sounds.preview(null), []);

  return (
    <Screen back title="Ringtone" scroll>
      <Text tone="secondary" style={{ marginBottom: space.lg }}>
        Made for Envo. Tap one to hear it.
      </Text>
      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        {RINGTONES.map((r, i) => {
          const on = r.id === ringtone;
          return (
            <Pressable
              key={r.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                void Haptics.selectionAsync();
                setRingtone(r.id);
                Sounds.preview(r.source);
              }}
              style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { backgroundColor: colors.elementPressed }]}
            >
              <View style={[styles.icon, { backgroundColor: on ? colors.brand : colors.background }]}>
                <Music2 size={18} color={on ? '#FFFFFF' : colors.textSecondary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyMedium">{r.name}</Text>
                <Text variant="caption" tone="secondary">
                  {r.note}
                </Text>
              </View>
              {on && <Check size={22} color={colors.brand} strokeWidth={2.6} />}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
