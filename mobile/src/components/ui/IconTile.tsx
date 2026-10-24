import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { iconStroke } from '@/theme/tokens';

export type IconTileTone = 'neutral' | 'brand' | 'call' | 'warning' | 'danger';

export interface IconTileProps {
  icon: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  tone?: IconTileTone;
  /** What it sits on: a neutral tile takes the other colour so it stands out. */
  on?: 'page' | 'surface';
  style?: StyleProp<ViewStyle>;
}

const SIZES = {
  sm: { box: 32, radius: 10, icon: 18 },
  md: { box: 44, radius: 14, icon: 22 },
  lg: { box: 64, radius: 20, icon: 28 },
} as const;

/** An icon on a rounded square: list rows, quick actions, empty states. */
export function IconTile({ icon: Icon, size = 'md', tone = 'neutral', on = 'page', style }: IconTileProps) {
  const { colors } = useTheme();
  const s = SIZES[size];
  const [bg, fg] = {
    neutral: [on === 'surface' ? colors.background : colors.element, colors.text],
    brand: [colors.brandSoft, colors.brand],
    call: [colors.callSoft, colors.callText],
    warning: [colors.warningSoft, colors.warningText],
    danger: [colors.dangerSoft, colors.danger],
  }[tone];
  return (
    <View style={[styles.tile, { width: s.box, height: s.box, borderRadius: s.radius, backgroundColor: bg }, style]}>
      <Icon size={s.icon} color={fg} strokeWidth={iconStroke} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
