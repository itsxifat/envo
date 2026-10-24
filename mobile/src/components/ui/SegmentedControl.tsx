import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme/theme';
import { fonts, palette, radius, shadow } from '@/theme/tokens';
import { Text } from './Text';

export interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** Two or three choices in a grey track ("All" / "Missed"); the chosen one is lifted. */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const { colors, dark } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: colors.element }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 7, bottom: 7 }}
            onPress={() => {
              if (on) return;
              void Haptics.selectionAsync();
              onChange(o.value);
            }}
            style={[styles.item, on && (dark ? { backgroundColor: palette.ink700 } : [{ backgroundColor: colors.background }, shadow.raised])]}
          >
            <Text style={[styles.label, { color: on ? colors.text : colors.textSecondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', minHeight: 36, padding: 3, borderRadius: radius.pill },
  item: { minHeight: 30, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
});
