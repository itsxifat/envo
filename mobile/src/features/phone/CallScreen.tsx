import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Grid3x3, Mic, MicOff, Pause, PhoneOff, Play, Volume2 } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { formatDuration, formatPhone } from '@/lib/format';
import { useCalls } from '@/state/calls';
import { fonts, palette, space } from '@/theme/tokens';
import { CallBackdrop, PulsingAvatar } from './CallVisuals';

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/** The call in progress: who, how long, and the controls. Always dark, like a phone's own call screen. */
export function CallScreen() {
  const insets = useSafeAreaInsets();
  const { call, hangup, toggleMute, toggleSpeaker, toggleHold, sendDigit } = useCalls();
  const [now, setNow] = useState(Date.now());
  const [keypad, setKeypad] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (call?.state !== 'connected' && call?.state !== 'held') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call?.state]);

  if (!call) return <View style={{ flex: 1, backgroundColor: palette.ink950 }} />;
  const ringing = call.state === 'calling' || call.state === 'ringing';
  const status =
    call.state === 'calling'
      ? 'Calling…'
      : call.state === 'ringing'
        ? 'Ringing…'
        : call.state === 'held'
          ? 'On hold'
          : call.state === 'ended'
            ? 'Call ended'
            : formatDuration(Math.max(0, Math.floor((now - (call.connectedAt ?? now)) / 1000)));

  const controls = [
    { key: 'mute', label: call.muted ? 'Unmute' : 'Mute', on: call.muted, icon: call.muted ? MicOff : Mic, onPress: toggleMute },
    { key: 'keypad', label: 'Keypad', on: keypad, icon: Grid3x3, onPress: () => setKeypad(!keypad) },
    { key: 'speaker', label: 'Speaker', on: call.speaker, icon: Volume2, onPress: toggleSpeaker },
    { key: 'hold', label: call.state === 'held' ? 'Resume' : 'Hold', on: call.state === 'held', icon: call.state === 'held' ? Play : Pause, onPress: toggleHold, disabled: ringing },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
      <StatusBar style="light" />
      <CallBackdrop />
      <Animated.View entering={FadeInDown.duration(400)} style={styles.who}>
        {call.free && (
          <View style={styles.freePill}>
            <Text style={styles.freeText}>Free call on Envo</Text>
          </View>
        )}
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit>
          {call.name ?? formatPhone(call.number)}
        </Text>
        {call.name && <Text style={styles.number}>{formatPhone(call.number)}</Text>}
        <Text style={[styles.status, call.state === 'ended' && { color: palette.red400 }]}>{status}</Text>
      </Animated.View>

      <View style={styles.middle}>
        {keypad ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.pad}>
            <Text style={styles.typed} numberOfLines={1}>
              {typed || ' '}
            </Text>
            {[0, 3, 6, 9].map((start) => (
              <View key={start} style={styles.padRow}>
                {PAD.slice(start, start + 3).map((d) => (
                  <Pressable
                    key={d}
                    accessibilityRole="button"
                    accessibilityLabel={d}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      sendDigit(d);
                      setTyped((t) => (t + d).slice(-16));
                    }}
                    style={({ pressed }) => [styles.padKey, { backgroundColor: pressed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)' }]}
                  >
                    <Text style={styles.padDigit}>{d}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </Animated.View>
        ) : (
          <PulsingAvatar name={call.name} active={ringing} />
        )}
      </View>

      <View style={styles.controls}>
        {controls.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={c.label}
            accessibilityState={{ selected: c.on, disabled: c.disabled }}
            disabled={c.disabled}
            onPress={() => {
              void Haptics.selectionAsync();
              c.onPress();
            }}
            style={[styles.control, c.disabled && { opacity: 0.35 }]}
          >
            <View style={[styles.controlCircle, { backgroundColor: c.on ? '#FFFFFF' : 'rgba(255,255,255,0.12)' }]}>
              <c.icon size={26} color={c.on ? palette.ink950 : '#FFFFFF'} />
            </View>
            <Text style={styles.controlLabel}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End call"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          hangup();
        }}
        disabled={call.state === 'ended'}
        style={({ pressed }) => [styles.end, { transform: [{ scale: pressed ? 0.94 : 1 }], opacity: call.state === 'ended' ? 0.5 : 1 }]}
      >
        <PhoneOff size={32} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950, alignItems: 'center', paddingHorizontal: space.xl },
  who: { alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  freePill: { backgroundColor: 'rgba(34,197,94,0.16)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, marginBottom: 6 },
  freeText: { fontFamily: fonts.semibold, fontSize: 12, color: palette.green400 },
  name: { fontFamily: fonts.bold, fontSize: 32, color: '#FFFFFF', letterSpacing: -0.8, textAlign: 'center' },
  number: { fontFamily: fonts.medium, fontSize: 16, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.4 },
  status: { fontFamily: fonts.medium, fontSize: 16, color: 'rgba(255,255,255,0.78)', marginTop: 4, fontVariant: ['tabular-nums'] },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  pad: { gap: 12, alignSelf: 'stretch' },
  typed: { fontFamily: fonts.semibold, fontSize: 26, color: '#FFFFFF', textAlign: 'center', letterSpacing: 2, marginBottom: 4 },
  padRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  padKey: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
  padDigit: { fontFamily: fonts.medium, fontSize: 28, color: '#FFFFFF' },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: space.xxl },
  control: { alignItems: 'center', gap: 8, width: 72 },
  controlCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  controlLabel: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.86)' },
  end: { width: 78, height: 78, borderRadius: 39, backgroundColor: palette.red500, alignItems: 'center', justifyContent: 'center' },
});
