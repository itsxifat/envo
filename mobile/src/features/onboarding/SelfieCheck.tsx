import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Mask, Rect } from 'react-native-svg';
import { ChevronsLeft, ChevronsRight, CircleCheck, ScanFace } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { IconTile } from '@/components/ui/IconTile';
import { Text } from '@/components/ui/Text';
import { ApiError, errorText } from '@/lib/api';
import { useSession } from '@/state/session';
import { AlwaysDark } from '@/theme/theme';
import { fonts, iconStroke, palette, radius, space } from '@/theme/tokens';
import { shrink } from './pickers';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The three pictures: looking straight, then turning the head one way and the other. */
const STEPS = [
  { title: 'Look straight at the camera', text: 'Keep your face inside the circle', ms: 1800, turn: null },
  { title: 'Turn your head a little to the left', text: 'Just a little, keep looking at the phone', ms: 2400, turn: 'left' },
  { title: 'Now a little to the right', text: 'Almost done', ms: 2400, turn: 'right' },
] as const;

/** What helps when the check doesn't pass. */
const TIPS = ['Face a window or a lamp', 'Take off glasses and cap', 'Hold the phone at eye level'];

type Phase = { kind: 'ready' } | { kind: 'step'; step: number } | { kind: 'checking' } | { kind: 'passed' } | { kind: 'failed'; message: string; tips: boolean };

/** Words on the dark screen never get fainter than 64% white. */
const SOFT = 'rgba(255,255,255,0.72)';
const MUTED = 'rgba(255,255,255,0.64)';
/** How far the ring and its line reach outside the face window. */
const RING_OUT = 13;
/** Room kept under the ring for the words on their panel, the buttons and the gaps between. */
const BELOW = 380;

/**
 * The live selfie, like banking apps take it: three pictures a moment apart while the person follows
 * the prompts. The server checks there is one face, the same in all three, and that the head really
 * turned (a printed photo can't), then matches it with the NID photo when the registration is sent.
 */
export function SelfieCheckScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const { checkSelfie, setLiveSelfie } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  // A new key starts the camera afresh when it didn't come up.
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const frames = useRef<string[]>([]);
  // False once the screen is closed (e.g. with back while checking): the check then doesn't go back again.
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  const progress = useSharedValue(0);
  const flash = useSharedValue(0);
  const spin = useSharedValue(0);

  // The face window as big as the screen allows with the words and buttons still fitting under it.
  const room = height - insets.top - insets.bottom - BELOW;
  const size = Math.max(180, Math.min(width * 0.78, 320, room - 2 * RING_OUT - space.lg));
  const top = insets.top + Math.min(72, Math.max(space.lg, room - size - 2 * RING_OUT));
  const cx = width / 2;
  const cy = top + RING_OUT + size / 2;
  const ring = size / 2 + 10;
  const circumference = 2 * Math.PI * ring;
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));
  const flashing = useAnimatedStyle(() => ({ opacity: flash.value }));
  const spinning = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  // Asks by itself once when the screen opens; after a "no", only the 'Allow the camera' button asks again.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !permission || permission.granted || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission().catch(() => undefined);
  }, [permission, requestPermission]);

  // A phone without a working front camera never gets ready: say so instead of waiting.
  useEffect(() => {
    if (!permission?.granted || cameraReady) return;
    const t = setTimeout(() => setPhase({ kind: 'failed', message: "The front camera didn't start. Try again, or restart the phone.", tips: false }), 8000);
    return () => clearTimeout(t);
  }, [permission?.granted, cameraReady, cameraKey]);

  // Each step: the ring fills while the person follows the prompt, then the picture is taken.
  useEffect(() => {
    if (phase.kind !== 'step') return;
    const step = STEPS[phase.step]!;
    progress.value = 0;
    progress.value = withTiming(1, { duration: step.ms, easing: Easing.linear });
    const t = setTimeout(async () => {
      try {
        const pic = await camera.current?.takePictureAsync({ quality: 0.7, shutterSound: false });
        if (!pic) throw new Error('No picture');
        // Taken: a quick flash and a tap say so.
        if (!reduce) flash.value = withSequence(withTiming(0.5, { duration: 80 }), withTiming(0, { duration: 80 }));
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        frames.current[phase.step] = await shrink(pic.uri, pic.width, pic.height);
        if (phase.step < STEPS.length - 1) setPhase({ kind: 'step', step: phase.step + 1 });
        else setPhase({ kind: 'checking' });
      } catch {
        setPhase({ kind: 'failed', message: "The camera didn't take the picture. Please try again.", tips: false });
      }
    }, step.ms);
    return () => {
      clearTimeout(t);
      cancelAnimation(progress);
    };
  }, [phase, progress, flash, reduce]);

  useEffect(() => {
    if (phase.kind !== 'checking') return;
    void (async () => {
      try {
        const id = await checkSelfie(frames.current as [string, string, string]);
        setLiveSelfie({ id, uri: frames.current[0]! });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase({ kind: 'passed' });
        setTimeout(() => {
          if (shown.current) router.back();
        }, 900);
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        // The face check's own answers come with tips; a lost connection doesn't need them.
        setPhase({ kind: 'failed', message: errorText(err), tips: err instanceof ApiError && err.status === 422 });
      }
    })();
  }, [phase, checkSelfie, setLiveSelfie]);

  // While the server checks, an arc goes round the ring (it stays put when motion is reduced); the
  // ring shows full in green or red once it's done.
  useEffect(() => {
    if (phase.kind === 'checking') {
      progress.value = 0;
      spin.value = 0;
      if (!reduce) spin.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1, false);
    } else if (phase.kind === 'passed' || phase.kind === 'failed') {
      progress.value = withTiming(1, { duration: 200 });
    } else if (phase.kind === 'ready') {
      progress.value = 0;
    }
    return () => cancelAnimation(spin);
  }, [phase.kind, progress, spin, reduce]);

  const start = () => {
    frames.current = [];
    setPhase({ kind: 'step', step: 0 });
  };
  const restartCamera = () => {
    setCameraReady(false);
    setCameraKey((k) => k + 1);
    setPhase({ kind: 'ready' });
  };

  const step = phase.kind === 'step' ? STEPS[phase.step]! : null;
  const title =
    phase.kind === 'ready'
      ? 'Take a live selfie'
      : step
        ? step.title
        : phase.kind === 'checking'
          ? 'Checking it’s you…'
          : phase.kind === 'passed'
            ? 'Thank you!'
            : 'Let’s try that again';
  const text =
    phase.kind === 'ready'
      ? 'Hold the phone at eye level in good light. We take three pictures while you follow the prompts.'
      : phase.kind === 'step'
        ? STEPS[phase.step]!.text
        : phase.kind === 'checking'
          ? 'This takes a few seconds.'
          : phase.kind === 'passed'
            ? 'Your selfie is done.'
            : phase.message;

  if (permission && !permission.granted) {
    return (
      <AlwaysDark>
        <View style={[styles.root, styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
          <StatusBar style="light" />
          <IconTile icon={ScanFace} size="lg" tone="brand" />
          <Text variant="title" align="center" style={styles.permissionTitle}>
            Allow the camera
          </Text>
          <Text align="center" style={styles.soft}>
            Envo needs the camera for your live selfie. It is only used while you take it.
          </Text>
          <View style={styles.permissionActions}>
            <Button
              title={permission.canAskAgain ? 'Allow the camera' : 'Open settings'}
              onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings()).catch(() => undefined)}
              block
            />
            <Button title="Not now" variant="ghost" onPress={() => router.back()} block />
          </View>
        </View>
      </AlwaysDark>
    );
  }

  // Which way to turn, just outside the ring when there is room (the preview is a mirror, so the
  // person's left is the screen's left).
  const arrowLeft = step?.turn === 'left' ? Math.max(space.lg, cx - ring - 8 - 36) : Math.min(width - space.lg - 36, cx + ring + 8);
  const failedToStart = phase.kind === 'failed' && !cameraReady;

  return (
    <AlwaysDark>
      <View style={styles.root}>
        <StatusBar style="light" />
        {permission?.granted && <CameraView key={cameraKey} ref={camera} style={StyleSheet.absoluteFill} facing="front" onCameraReady={() => setCameraReady(true)} />}
        {/* A dark veil with a round window for the face, and the ring that fills at each step. */}
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Mask id="window">
              <Rect width={width} height={height} fill="#FFFFFF" />
              <Circle cx={cx} cy={cy} r={size / 2} fill="#000000" />
            </Mask>
          </Defs>
          <Rect width={width} height={height} fill={palette.ink950} opacity={0.9} mask="url(#window)" />
          <Circle cx={cx} cy={cy} r={ring} stroke="rgba(255,255,255,0.18)" strokeWidth={5} fill="none" />
          {phase.kind !== 'checking' && (
            <AnimatedCircle
              cx={cx}
              cy={cy}
              r={ring}
              stroke={phase.kind === 'failed' ? palette.red400 : phase.kind === 'passed' ? palette.green400 : palette.brand400}
              strokeWidth={5}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              animatedProps={ringProps}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )}
        </Svg>
        {phase.kind === 'checking' && (
          <Animated.View pointerEvents="none" style={[styles.overlay, { left: cx - ring - 3, top: cy - ring - 3, width: 2 * ring + 6, height: 2 * ring + 6 }, spinning]}>
            <Svg width={2 * ring + 6} height={2 * ring + 6}>
              <Circle cx={ring + 3} cy={ring + 3} r={ring} stroke={palette.brand400} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={`${circumference / 4} ${circumference}`} />
            </Svg>
          </Animated.View>
        )}
        {step?.turn && <TurnArrow key={step.turn} side={step.turn} left={arrowLeft} top={cy - 18} />}
        {phase.kind === 'passed' && (
          <View style={[styles.overlay, styles.badge, { top: cy - 36, left: cx - 36 }]}>
            <CircleCheck size={72} color={palette.green400} strokeWidth={iconStroke} />
          </View>
        )}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashing]} />

        {/* Under the ring: the words on a solid panel, and the buttons at the bottom. */}
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.column, { paddingTop: cy + size / 2 + RING_OUT + space.lg, paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.panel} accessibilityLiveRegion="polite">
            <Text align="center" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text align="center" style={styles.soft}>
              {text}
            </Text>
            {phase.kind === 'failed' && phase.tips && (
              <View style={styles.tips}>
                {TIPS.map((t) => (
                  <View key={t} style={styles.tip}>
                    <View style={styles.tipDot} />
                    <Text style={styles.tipText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
            {phase.kind === 'step' && <Text style={styles.stepCount}>{`Step ${phase.step + 1} of ${STEPS.length}`}</Text>}
          </View>
          <View style={styles.flex} />
          {(phase.kind === 'ready' || phase.kind === 'failed') && (
            <View style={styles.actions}>
              {failedToStart ? (
                <Button title="Try again" onPress={restartCamera} block />
              ) : (
                <Button title={!cameraReady ? 'Starting the camera…' : phase.kind === 'ready' ? 'Start' : 'Try again'} onPress={start} disabled={!cameraReady} block />
              )}
              <Button title="Cancel" variant="ghost" onPress={() => router.back()} block />
            </View>
          )}
        </View>
      </View>
    </AlwaysDark>
  );
}

/** Chevrons beside the ring that keep nudging the way to turn (still when motion is reduced). */
function TurnArrow({ side, left, top }: { side: 'left' | 'right'; left: number; top: number }) {
  const reduce = useReducedMotion();
  const nudge = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      nudge.value = 0;
      return;
    }
    nudge.value = withRepeat(withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(nudge);
  }, [nudge, reduce]);
  const sliding = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * nudge.value, transform: [{ translateX: (side === 'left' ? -12 : 12) * nudge.value }] }));
  const Icon = side === 'left' ? ChevronsLeft : ChevronsRight;
  return (
    <Animated.View pointerEvents="none" style={[styles.overlay, { left, top }, sliding]}>
      <Icon size={36} color={palette.brand400} strokeWidth={iconStroke} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  overlay: { position: 'absolute' },
  badge: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  flash: { backgroundColor: '#FFFFFF', opacity: 0 },
  column: { paddingHorizontal: space.xl },
  panel: { backgroundColor: palette.ink950, borderRadius: radius.lg, padding: space.lg, alignItems: 'center', gap: space.sm },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: '#FFFFFF' },
  soft: { color: SOFT },
  tips: { alignSelf: 'stretch', gap: 6, marginTop: space.xs },
  tip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  tipDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: MUTED },
  tipText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: SOFT },
  stepCount: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: MUTED, fontVariant: ['tabular-nums'] },
  actions: { gap: space.sm },
  permissionTitle: { color: '#FFFFFF', marginTop: space.lg },
  permissionActions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xl },
});
