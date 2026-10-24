import { createContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Phone } from 'lucide-react-native';

import { formatDuration } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { useTheme } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Text } from './ui/Text';

/** The height the return-to-call bar takes above the screens (0 while it is hidden). */
export const ReturnToCallContext = createContext(0);

/** Height of the bar under the status bar. */
export const RETURN_BAR = 40;

/**
 * The green bar at the top while a call goes on and its screen is closed (back from the call screen):
 * a tap goes back to the call.
 */
export function ReturnToCallBar({ top }: { top: number }) {
  const { colors } = useTheme();
  const { call } = useCalls();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const talking = !!call?.connectedAt && (call.state === 'connected' || call.state === 'held');
  const label = talking ? `Return to call · ${formatDuration(Math.max(0, Math.floor((now - call.connectedAt!) / 1000)))}` : 'Return to call';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/call')}
      style={({ pressed }) => [styles.bar, { height: top + RETURN_BAR, paddingTop: top, backgroundColor: pressed ? colors.callPressed : colors.call }]}
    >
      <StatusBar style="light" />
      <Phone size={16} color="#FFFFFF" strokeWidth={2} />
      <Text maxFontSizeMultiplier={1.3} style={styles.text}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
});
