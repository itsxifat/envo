import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Mask, Rect } from 'react-native-svg';
import { CircleCheck, ScanFace } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { useSession } from '@/state/session';
import { AlwaysDark } from '@/theme/theme';
import { palette, space } from '@/theme/tokens';
import { shrink } from './pickers';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The three pictures: looking straight, then turning the head one way and the other. */
const STEPS = [
  { title: 'Look straight at the camera', text: 'Keep your face inside the circle', ms: 1800 },
  { title: 'Slowly turn your head to the left', text: 'Just a little, keep looking at the phone', ms: 2000 },
  { title: 'Now slowly to the right', text: 'Almost done', ms: 2000 },
] as const;

type Phase = { kind: 'ready' } | { kind: 'step'; step: number } | { kind: 'checking' } | { kind: 'passed' } | { kind: 'failed'; message: string };

/**
 * The live selfie, like banking apps take it: three pictures a moment apart while the person follows
 * the prompts. The server checks there is one face, the same in all three, and that the head really
 * turned (a printed photo can't), then matches it with the NID photo when the registration is sent.
 */
export function SelfieCheckScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { checkSelfie, setLiveSelfie } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const frames = useRef<string[]>([]);
  const progress = useSharedValue(0);

  const size = Math.min(width * 0.78, 320);
  const cx = width / 2;
  const cy = insets.top + 90 + size / 2;
  const ring = size / 2 + 10;
  const circumference = 2 * Math.PI * ring;
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));

  // Asks by itself once when the screen opens; after a "no", only the 'Allow the camera' button asks again.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !permission || permission.granted || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  // A phone without a working front camera never gets ready: say so instead of waiting.
  useEffect(() => {
    if (!permission?.granted || cameraReady) return;
    const t = setTimeout(() => setPhase({ kind: 'failed', message: "The front camera didn't start. Close this and try again, or restart the phone." }), 8000);
    return () => clearTimeout(t);
  }, [permission?.granted, cameraReady]);

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
        frames.current[phase.step] = await shrink(pic.uri, pic.width, pic.height);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (phase.step < STEPS.length - 1) setPhase({ kind: 'step', step: phase.step + 1 });
        else setPhase({ kind: 'checking' });
      } catch {
        setPhase({ kind: 'failed', message: "The camera didn't take the picture. Please try again." });
      }
    }, step.ms);
    return () => {
      clearTimeout(t);
      cancelAnimation(progress);
    };
  }, [phase, progress]);

  useEffect(() => {
    if (phase.kind !== 'checking') return;
    void (async () => {
      try {
        const id = await checkSelfie(frames.current as [string, string, string]);
        setLiveSelfie({ id, uri: frames.current[0]! });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase({ kind: 'passed' });
        setTimeout(() => router.back(), 900);
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPhase({ kind: 'failed', message: errorText(err) });
      }
    })();
  }, [phase, checkSelfie, setLiveSelfie]);

  const start = () => {
    frames.current = [];
    setPhase({ kind: 'step', step: 0 });
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
          <ScanFace size={48} color="#FFFFFF" />
          <Text variant="title" align="center" style={{ color: '#FFFFFF', marginTop: space.lg }}>
            Allow the camera
          </Text>
          <Text align="center" style={styles.muted}>
            Envo needs the camera for your live selfie. It is only used while you take it.
          </Text>
          <View style={styles.actions}>
            <Button title={permission.canAskAgain ? 'Allow the camera' : 'Open settings'} onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())} block />
            <Button title="Not now" variant="ghost" onPress={() => router.back()} block />
          </View>
        </View>
      </AlwaysDark>
    );
  }

  return (
    <AlwaysDark>
      <View style={styles.root}>
        <StatusBar style="light" />
        {permission?.granted && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" onCameraReady={() => setCameraReady(true)} />}
        {/* A dark veil with a round window for the face, and the ring that fills at each step. */}
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Mask id="window">
              <Rect width={width} height={height} fill="#FFFFFF" />
              <Circle cx={cx} cy={cy} r={size / 2} fill="#000000" />
            </Mask>
          </Defs>
          <Rect width={width} height={height} fill={palette.ink950} opacity={0.82} mask="url(#window)" />
          <Circle cx={cx} cy={cy} r={ring} stroke="rgba(255,255,255,0.18)" strokeWidth={5} fill="none" />
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
        </Svg>
        {phase.kind === 'passed' && (
          <View style={[styles.badge, { top: cy - 36, left: cx - 36 }]}>
            <CircleCheck size={72} color={palette.green400} />
          </View>
        )}

        <View style={[styles.copy, { top: cy + size / 2 + 36 }]}>
          <Text variant="title" align="center" style={{ color: '#FFFFFF' }}>
            {title}
          </Text>
          <Text align="center" style={styles.muted}>
            {text}
          </Text>
          {phase.kind === 'step' && (
            <View style={styles.dots}>
              {STEPS.map((_, i) => (
                <View key={i} style={[styles.dot, { backgroundColor: i <= phase.step ? palette.brand400 : 'rgba(255,255,255,0.25)' }]} />
              ))}
            </View>
          )}
        </View>

        <View style={[styles.actions, styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
          {(phase.kind === 'ready' || phase.kind === 'failed') && (
            <>
              <Button title={phase.kind === 'ready' ? 'Start' : 'Try again'} onPress={start} disabled={!cameraReady} block />
              <Button title="Cancel" variant="ghost" onPress={() => router.back()} block />
            </>
          )}
        </View>
      </View>
    </AlwaysDark>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink950 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  muted: { color: 'rgba(255,255,255,0.7)', marginTop: space.sm },
  copy: { position: 'absolute', left: space.xl, right: space.xl, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginTop: space.lg },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { position: 'absolute', width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xl },
  bottom: { position: 'absolute', left: space.xl, right: space.xl, bottom: 0 },
});
