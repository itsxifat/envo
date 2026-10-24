import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, Plus, Volume2 } from 'lucide-react-native';

import { useCallGate } from '@/components/CallGate';
import { Button } from '@/components/ui/Button';
import { NIGHT } from '@/components/ui/NumberCard';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatDuration, formatPhone, formatTalk } from '@/lib/format';
import { useCalls, type Call, type CallFailReason } from '@/state/calls';
import { useContacts } from '@/state/contacts';
import { useSession } from '@/state/session';
import { AlwaysDark } from '@/theme/theme';
import { fonts, iconStroke, palette, radius, space } from '@/theme/tokens';
import { avatarTop, CallBackdrop, PulsingAvatar } from './CallVisuals';

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const PAD_GAP = 12;
/** The digits typed during the call, above the in-call keypad. */
const TYPED = 32;

/** White at the strengths the call screens use (never under 64% for text). */
const LABEL = 'rgba(255,255,255,0.8)';
const STRONG = 'rgba(255,255,255,0.86)';
const GLASS = 'rgba(255,255,255,0.10)';
const GLASS_PRESSED = 'rgba(255,255,255,0.20)';

const FAILED: Record<CallFailReason, string> = {
  'no-answer': 'No answer',
  busy: 'Busy',
  offline: "Can't connect. Check your internet.",
  balance: 'Your balance ran out',
};

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));

/** The call in progress: who, how long, and the controls. Always dark, like a phone's own call screen. */
export function CallScreen() {
  return (
    <AlwaysDark>
      <CallView />
    </AlwaysDark>
  );
}

function CallView() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { call: live, hangup, toggleMute, toggleSpeaker, toggleHold, sendDigit, retry, close } = useCalls();
  const { account, config } = useSession();
  const { nameOf } = useContacts();
  const gate = useCallGate();
  // The last call stays drawn while the screen closes after it.
  const last = useRef<Call | null>(live);
  if (live) last.current = live;
  const call = live ?? last.current;
  const [now, setNow] = useState(Date.now);
  const [keypad, setKeypad] = useState(false);
  const [typed, setTyped] = useState('');
  const [middle, setMiddle] = useState(0);
  const state = call?.state;
  const talking = state === 'connected' || state === 'held';

  useEffect(() => {
    if (!talking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [talking]);

  // Back leaves the call going on (the green bar at the top leads back to it); a call that is over
  // closes instead.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (live && (live.state === 'failed' || live.state === 'ended')) close();
        else if (router.canGoBack()) router.back();
        else router.replace('/');
        return true;
      });
      return () => sub.remove();
    }, [live, close]),
  );

  if (!call) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CallBackdrop />
      </View>
    );
  }

  const out = call.direction === 'out';
  const name = call.name ?? nameOf(call.number);
  const ringing = state === 'calling' || state === 'ringing';
  const failed = state === 'failed';
  const ended = state === 'ended';
  const over = failed || ended;
  const rate = config?.rate_per_min ?? 0;
  const paid = out && !call.free && rate > 0;
  const secs = call.connectedAt ? Math.max(0, Math.floor(((over ? (call.endedAt ?? now) : now) - call.connectedAt) / 1000)) : 0;
  const status = failed
    ? FAILED[call.reason ?? 'no-answer']
    : state === 'calling'
      ? 'Calling…'
      : state === 'ringing'
        ? 'Ringing…'
        : state === 'held'
          ? `On hold · ${formatDuration(secs)}`
          : ended
            ? secs > 0
              ? `Call ended · ${formatTalk(secs)}`
              : 'Call ended'
            : formatDuration(secs);
  // What it costs, before it is answered and once it is over (a connected call shows only its timer).
  const cost = ringing && paid ? `${formatBdt(rate)} a minute` : ended && out && secs > 0 ? (call.free ? 'Free call' : rate > 0 ? `Cost about ${formatBdt(Math.ceil(secs / 60) * rate)}` : null) : null;
  // Envo charges each started minute: the balance won't cover the next one.
  const low = paid && talking && (account?.balance ?? 0) - Math.ceil(secs / 60) * rate < rate;
  // The keypad stays through the moment "Call ended" shows (the screen closes then); a failed call
  // shows the person again.
  const pad = keypad && !failed;
  // On a short screen the in-call keypad takes the room of the lines under the name.
  const compact = pad && height < 760;
  const padKey = clamp(44, 66, Math.floor((middle - space.lg - TYPED - 4 * PAD_GAP) / 4));
  // A failed call can't be tried again with no balance left: it offers the recharge instead (from here,
  // so the recharge screen doesn't open over a call that is over). A free call to an Envo number can.
  const offerRecharge = call.reason === 'balance' || (gate.reason === 'empty' && !(gate.envoOnly && call.free));

  const controls = [
    { key: 'mute', label: call.muted ? 'Unmute' : 'Mute', on: call.muted, icon: call.muted ? MicOff : Mic, onPress: toggleMute, disabled: over },
    { key: 'keypad', label: 'Keypad', on: pad, icon: Grid3x3, onPress: () => setKeypad((k) => !k), disabled: over },
    { key: 'speaker', label: 'Speaker', on: call.speaker, icon: Volume2, onPress: toggleSpeaker, disabled: over },
    { key: 'hold', label: state === 'held' ? 'Resume' : 'Hold', on: state === 'held', icon: state === 'held' ? Play : Pause, onPress: toggleHold, disabled: !talking },
  ];

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + space.xl }]}>
      <StatusBar style="light" />
      <CallBackdrop />
      <Animated.View entering={FadeInDown.duration(400)} style={[styles.who, { paddingTop: insets.top + (compact ? space.lg : space.xxxl) }]}>
        {out && call.free && !compact && (
          <View style={styles.freePill}>
            <Text maxFontSizeMultiplier={1.3} style={styles.freeText}>
              Free call on Envo
            </Text>
          </View>
        )}
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit accessibilityRole="header">
          {name ?? formatPhone(call.number)}
        </Text>
        {name && !compact && <Text style={styles.number}>{formatPhone(call.number)}</Text>}
        <Text style={styles.status}>{status}</Text>
        {!compact && (
          // One line the same height whatever it holds, so the avatar doesn't jump when the call connects.
          <View style={styles.slot}>
            {call.muted && talking ? (
              <View style={styles.muted}>
                <Text maxFontSizeMultiplier={1.3} style={styles.mutedText}>
                  Muted
                </Text>
              </View>
            ) : cost ? (
              <Text style={styles.cost}>{cost}</Text>
            ) : null}
          </View>
        )}
      </Animated.View>

      <View onLayout={(e) => setMiddle(e.nativeEvent.layout.height)} style={[styles.middle, pad && styles.middlePad]}>
        {pad ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.pad, ended && styles.inert]}>
            <Text style={styles.typed} numberOfLines={1}>
              {typed || ' '}
            </Text>
            {[0, 3, 6, 9].map((start) => (
              <View key={start} style={styles.padRow}>
                {PAD.slice(start, start + 3).map((d) => (
                  <Pressable
                    key={d}
                    accessibilityRole="button"
                    accessibilityLabel={d === '*' ? 'Star' : d === '#' ? 'Hash' : d}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      sendDigit(d);
                      setTyped((t) => (t + d).slice(-16));
                    }}
                    style={({ pressed }) => [styles.padKey, { width: padKey, height: padKey, borderRadius: padKey / 2, backgroundColor: pressed ? 'rgba(255,255,255,0.22)' : GLASS }]}
                  >
                    <Text maxFontSizeMultiplier={1.3} style={[styles.padDigit, { fontSize: Math.round(padKey * 0.42), lineHeight: Math.round(padKey * 0.5) }]}>
                      {d}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </Animated.View>
        ) : (
          <View style={{ marginTop: avatarTop(middle) }}>
            <PulsingAvatar name={name} active={ringing} />
          </View>
        )}
      </View>

      {failed ? (
        <View style={styles.failButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => {
              void Haptics.selectionAsync();
              close();
            }}
            style={({ pressed }) => [styles.glass, { backgroundColor: pressed ? GLASS_PRESSED : 'rgba(255,255,255,0.12)' }, pressed && styles.pressedSoft]}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.glassText}>
              Close
            </Text>
          </Pressable>
          {offerRecharge ? (
            <Button
              title="Recharge"
              variant="brand"
              icon={Plus}
              onPress={() => {
                close();
                router.push('/recharge');
              }}
              style={styles.flex}
            />
          ) : (
            <Button
              title="Call again"
              variant="call"
              icon={Phone}
              onPress={() =>
                gate.guard(() => {
                  // A new call: the keypad starts closed, with nothing typed.
                  setKeypad(false);
                  setTyped('');
                  retry();
                }, call.number)
              }
              style={styles.flex}
            />
          )}
        </View>
      ) : (
        <>
          {low && (
            <View style={styles.low}>
              <Text maxFontSizeMultiplier={1.3} style={styles.lowText}>
                Less than a minute of balance left
              </Text>
            </View>
          )}
          <View style={[styles.controls, { marginBottom: compact ? space.lg : space.xxl }]}>
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
                style={[styles.control, c.disabled && styles.dim]}
              >
                <View style={[styles.controlCircle, { backgroundColor: c.on ? palette.white : GLASS }]}>
                  <c.icon size={24} color={c.on ? palette.ink950 : palette.white} strokeWidth={iconStroke} />
                </View>
                <Text maxFontSizeMultiplier={1.3} style={styles.controlLabel}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="End call"
            accessibilityState={{ disabled: ended }}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              hangup();
            }}
            disabled={ended}
            style={({ pressed }) => [styles.end, pressed && styles.pressed, ended && styles.dim]}
          >
            <PhoneOff size={30} color={palette.white} strokeWidth={iconStroke} />
          </Pressable>
        </>
      )}
      {gate.sheet}
    </View>
  );
}

const tabular = ['tabular-nums'] as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: palette.ink950, alignItems: 'center', paddingHorizontal: space.xl },
  who: { alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  freePill: { backgroundColor: 'rgba(34,197,94,0.16)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, marginBottom: 6 },
  freeText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: palette.green300 },
  name: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: NIGHT.text, textAlign: 'center' },
  number: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: NIGHT.muted, fontVariant: tabular },
  status: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: NIGHT.soft, fontVariant: tabular, textAlign: 'center' },
  cost: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: NIGHT.muted, fontVariant: tabular },
  slot: { minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  muted: { minHeight: 24, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' },
  mutedText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: STRONG },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', alignSelf: 'stretch' },
  middlePad: { paddingTop: space.lg },
  pad: { gap: PAD_GAP, alignSelf: 'stretch' },
  typed: { fontFamily: fonts.semibold, fontSize: 26, lineHeight: TYPED, color: NIGHT.text, textAlign: 'center', letterSpacing: 2, fontVariant: tabular },
  padRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  padKey: { alignItems: 'center', justifyContent: 'center' },
  padDigit: { fontFamily: fonts.regular, color: NIGHT.text },
  low: { minHeight: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(245,158,11,0.18)', justifyContent: 'center', marginBottom: space.lg },
  lowText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: palette.amber400 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  control: { alignItems: 'center', gap: 8, width: 72 },
  controlCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  controlLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: LABEL },
  end: { width: 76, height: 76, borderRadius: 38, backgroundColor: palette.red500, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.94 }] },
  pressedSoft: { transform: [{ scale: 0.98 }] },
  dim: { opacity: 0.4 },
  inert: { opacity: 0.4, pointerEvents: 'none' },
  failButtons: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch' },
  glass: { flex: 1, minHeight: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  glassText: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: NIGHT.text },
});
