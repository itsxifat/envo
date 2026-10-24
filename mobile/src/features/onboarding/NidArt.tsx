import Svg, { Rect } from 'react-native-svg';

import { useTheme } from '@/theme/theme';

/** The back's barcode: where each stripe starts and how wide it is. */
const BARS: [number, number][] = [
  [8, 2],
  [11.5, 1],
  [14, 3],
  [18.5, 1],
  [21, 2],
  [24.5, 1],
  [27, 3],
  [31.5, 1],
  [34, 2],
  [37.5, 1],
  [40, 3],
  [44.5, 1],
  [46, 2],
];

/** A small drawing of the NID card for the photo slots: the front with its photo and lines, the back with its barcode. */
export function NidArt({ side }: { side: 'front' | 'back' }) {
  const { colors } = useTheme();
  const ink = colors.brand;
  return (
    <Svg width={56} height={40} viewBox="0 0 56 40" accessible={false} importantForAccessibility="no-hide-descendants">
      <Rect x={0.75} y={0.75} width={54.5} height={38.5} rx={7} fill={colors.brandSoft} stroke={ink} strokeWidth={1.5} />
      {side === 'front' ? (
        <>
          <Rect x={7} y={9} width={14} height={18} rx={2.5} fill={ink} />
          <Rect x={25} y={11} width={24} height={3} rx={1.5} fill={ink} />
          <Rect x={25} y={18} width={18} height={3} rx={1.5} fill={ink} fillOpacity={0.55} />
          <Rect x={25} y={25} width={21} height={3} rx={1.5} fill={ink} fillOpacity={0.55} />
        </>
      ) : (
        BARS.map(([x, w]) => <Rect key={x} x={x} y={10} width={w} height={20} fill={ink} />)
      )}
    </Svg>
  );
}
