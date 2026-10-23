import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Phone, PhoneOff } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { fonts, palette, space } from '@/theme/tokens';
import { CallBackdrop, PulsingAvatar } from './CallVisuals';

/** Someone is calling: who, and two big buttons. */
export function IncomingScreen() {
  const insets = useSafeAreaInsets();
  const { incoming, answer, decline } = useCalls();
  if (!incoming) return <View style={{ flex: 1, backgroundColor: palette.ink950 }} />;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }]}>
      <StatusBar style="light" />
      <CallBackdrop />
      <Animated.View entering={FadeInDown.duration(450)} style={styles.who}>
        <Text style={styles.kind}>{incoming.free ? 'Envo call · free' : 'Incoming call'}</Text>
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit>
          {incoming.name ?? formatPhone(incoming.number)}
        </Text>
        {incoming.name && <Text style={styles.number}>{formatPhone(incoming.number)}</Text>}
      </Animated.View>

      <View style={styles.middle}>
        <PulsingAvatar name={incoming.name} active />
      </View>

      <Animated.View entering={FadeInUp.delay(150).duration(450)} style={styles.buttons}>
        <View style={styles.choice}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decline"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              decline();
            }}
            style={({ pressed }) => [styles.button, { backgroundColor: palette.red500, transform: [{ scale: pressed ? 0.93 : 1 }] }]}
          >
            <PhoneOff size={32} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.label}>Decline</Text>
        </View>
        <View style={styles.choice}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Answer"
            onPress={() => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              answer();
            }}
            style={({ pressed }) => [styles.button, { backgroundColor: palette.green500, transform: [{ scale: pressed ? 0.93 : 1 }] }]}
          >
            <Phone size={32} color="#FFFFFF" fill="#FFFFFF" />
          </Pressable>
          <Text style={styles.label}>Answer</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950, alignItems: 'center', paddingHorizontal: space.xl },
  who: { alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  kind: { fontFamily: fonts.medium, fontSize: 15, color: 'rgba(255,255,255,0.66)' },
  name: { fontFamily: fonts.bold, fontSize: 36, color: '#FFFFFF', letterSpacing: -1, textAlign: 'center' },
  number: { fontFamily: fonts.medium, fontSize: 17, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.4 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  buttons: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  choice: { alignItems: 'center', gap: 10 },
  button: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.medium, fontSize: 15, color: '#FFFFFF' },
});
