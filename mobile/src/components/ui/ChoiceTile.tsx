import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { fonts, radius } from '@/theme/tokens';
import { Text } from './Text';

export interface ChoiceTileProps {
  label: string;
  caption?: string;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/** One answer of a choice (gender, occupation, an amount): white with a border, blue with a tick when chosen. */
export function ChoiceTile({ label, caption, selected, onPress, style }: ChoiceTileProps) {
  const { colors } = useTheme();
  const tone = selected ? colors.brand : undefined;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tile,
        { minHeight: caption ? 64 : 52 },
        { backgroundColor: selected ? colors.brandSoft : pressed ? colors.element : colors.field, borderColor: selected ? colors.brand : colors.borderStrong },
        style,
      ]}
    >
      <Text style={[styles.label, { color: tone ?? colors.text }]}>{label}</Text>
      {caption ? (
        <Text variant="small" style={{ color: tone ?? colors.textSecondary }}>
          {caption}
        </Text>
      ) : null}
      {selected && (
        <View style={styles.check}>
          <Check size={16} color={colors.brand} strokeWidth={2.5} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The side padding keeps the label clear of the tick in the corner.
  tile: { borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 8, gap: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  check: { position: 'absolute', top: 8, right: 8 },
});
