import { useCallback, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Phone, PhoneOff } from 'lucide-react-native';

import { NIGHT } from '@/components/ui/NumberCard';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { useCalls, type Call } from '@/state/calls';
import { useContacts } from '@/state/contacts';
import { AlwaysDark } from '@/theme/theme';
import { fonts, iconStroke, palette, space } from '@/theme/tokens';
import { avatarTop, CallBackdrop, PulsingAvatar } from './CallVisuals';

/** Someone is calling: who, and two big buttons. */
export function IncomingScreen() {
  return (
    <AlwaysDark>
      <IncomingView />
    </AlwaysDark>
  );
}

function IncomingView() {
  const insets = useSafeAreaInsets();
  const { incoming, answer, decline, silence } = useCalls();
  const { nameOf } = useContacts();
  // The caller stays drawn while the screen closes after an answer or a decline.
  const last = useRef<Call | null>(incoming);
  if (incoming) last.current = incoming;
  const shown = incoming ?? last.current;
  const [middle, setMiddle] = useState(0);

  // Back only quiets the ringing: the call stays until it is answered or declined.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (incoming) silence();
        else if (router.canGoBack()) router.back();
        else router.replace('/');
        return true;
      });
      return () => sub.remove();
    }, [incoming, silence]),
  );

  if (!shown) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CallBackdrop />
      </View>
    );
  }
  const name = shown.name ?? nameOf(shown.number);

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + space.xxl }]}>
      <StatusBar style="light" />
      <CallBackdrop />
      <Animated.View entering={FadeInDown.duration(450)} style={[styles.who, { paddingTop: insets.top + space.xxxl }]}>
        {/* Taking a call is always free, so every call says the same. */}
        <Text style={styles.kind}>Call to your Envo number</Text>
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit accessibilityRole="header">
          {name ?? formatPhone(shown.number)}
        </Text>
        {name && <Text style={styles.number}>{formatPhone(shown.number)}</Text>}
      </Animated.View>

      <View onLayout={(e) => setMiddle(e.nativeEvent.layout.height)} style={styles.middle}>
        <View style={{ marginTop: avatarTop(middle) }}>
          <PulsingAvatar name={name} active={!!incoming} />
        </View>
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
            style={({ pressed }) => [styles.button, { backgroundColor: palette.red500 }, pressed && styles.pressed]}
          >
            <PhoneOff size={30} color={palette.white} strokeWidth={iconStroke} />
          </Pressable>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>
            Decline
          </Text>
        </View>
        <View style={styles.choice}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Answer"
            onPress={() => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              answer();
            }}
            style={({ pressed }) => [styles.button, { backgroundColor: palette.green500 }, pressed && styles.pressed]}
          >
            <Phone size={30} color={palette.white} fill={palette.white} strokeWidth={iconStroke} />
          </Pressable>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>
            Answer
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950, alignItems: 'center', paddingHorizontal: space.xl },
  who: { alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  kind: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: NIGHT.muted, marginBottom: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: NIGHT.text, textAlign: 'center' },
  number: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: NIGHT.muted, fontVariant: ['tabular-nums'] },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  buttons: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  choice: { alignItems: 'center', gap: 10 },
  button: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.93 }] },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.86)' },
});
