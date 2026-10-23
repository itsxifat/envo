import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { palette } from '@/theme/tokens';

/** The Envo mark: an ink tile with blue signal bars, as on the website. */
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24">
        <Path d="M7 9.5v5M10.3 7v10M13.7 9v6M17 11v2" stroke={palette.brand500} strokeWidth={2} strokeLinecap="round" fill="none" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: palette.ink950,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
