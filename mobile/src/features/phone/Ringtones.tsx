import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Music2, Volume2 } from 'lucide-react-native';

import { IconTile } from '@/components/ui/IconTile';
import { ListGroup } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { RINGTONES, useSettings, type RingtoneId } from '@/state/settings';
import { Sounds } from '@/state/sounds';
import { useTheme } from '@/theme/theme';
import { iconStroke, space } from '@/theme/tokens';

/** About one pass of a ringtone: the row shows it playing this long. */
const PLAY_MS = 4000;

/** Pick the ringtone; tapping one chooses it and plays it once (a second tap stops it). */
export function RingtonesScreen() {
  const { colors } = useTheme();
  const { ringtone, setRingtone } = useSettings();
  const [playing, setPlaying] = useState<RingtoneId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      Sounds.preview(null);
    },
    [],
  );

  const tap = (r: (typeof RINGTONES)[number]) => {
    void Haptics.selectionAsync();
    if (timer.current) clearTimeout(timer.current);
    if (playing === r.id) {
      Sounds.preview(null);
      setPlaying(null);
      return;
    }
    setRingtone(r.id);
    Sounds.preview(r.source);
    setPlaying(r.id);
    timer.current = setTimeout(() => setPlaying(null), PLAY_MS);
  };

  return (
    <Screen back title="Ringtone" scroll>
      <Text tone="secondary" style={styles.lead}>
        Made for Envo. Tap one to hear it.
      </Text>
      <ListGroup>
        {RINGTONES.map((r) => {
          const on = r.id === ringtone;
          const sounding = r.id === playing;
          return (
            <Pressable
              key={r.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, checked: on }}
              accessibilityLabel={`${r.name}, ${sounding ? 'playing' : r.note}`}
              accessibilityHint={sounding ? 'Tap to stop' : 'Plays it once'}
              onPress={() => tap(r)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elementPressed }]}
            >
              {sounding ? <PlayingTile /> : <IconTile icon={Music2} size="sm" on="surface" />}
              <View style={styles.text}>
                <Text variant="bodyMedium">{r.name}</Text>
                <Text variant="caption" tone="secondary">
                  {sounding ? 'Playing · tap to stop' : r.note}
                </Text>
              </View>
              <View style={[styles.radio, { borderColor: on ? colors.brand : colors.borderStrong }]}>{on && <View style={[styles.radioDot, { backgroundColor: colors.brand }]} />}</View>
            </Pressable>
          );
        })}
      </ListGroup>
    </Screen>
  );
}

/** The tile of the ringtone that is playing: a speaker that breathes (still when motion is reduced). */
function PlayingTile() {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!reduce) opacity.value = withRepeat(withTiming(0.4, { duration: 600 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View style={[styles.tile, { backgroundColor: colors.background }]}>
      <Animated.View style={style}>
        <Volume2 size={18} color={colors.text} strokeWidth={iconStroke} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  text: { flex: 1, gap: 2 },
  // The same as a small IconTile on a grey list.
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
