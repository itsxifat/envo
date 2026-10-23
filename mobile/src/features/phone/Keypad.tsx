import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Clock3, Delete, Phone, Sparkles, Wallet } from 'lucide-react-native';

import { Badge } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatPhone, formatTyping } from '@/lib/format';
import { isEnvoNumber, useCalls } from '@/state/calls';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { Sounds } from '@/state/sounds';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];

export function KeypadScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { account, recents, minActivation, devActivate } = useSession();
  const { dial } = useCalls();
  const { keypadSounds } = useSettings();
  const [digits, setDigits] = useState('');
  const shake = useSharedValue(0);
  const shaking = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const stage = account?.stage ?? 'activate';

  // A name for the number, when it was called before.
  const known = useMemo(() => recents.find((r) => r.name && r.number === digits)?.name ?? null, [recents, digits]);
  const free = isEnvoNumber(digits);

  const press = (d: string) => {
    if (digits.length >= 15) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (keypadSounds) Sounds.key(d);
    setDigits((x) => x + d);
  };

  const call = () => {
    if (!digits) {
      // An empty keypad redials the last number, like most phones.
      const last = recents.find((r) => r.direction === 'out');
      if (last) setDigits(last.number);
      return;
    }
    if (stage !== 'active') {
      shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (stage === 'activate') router.push('/activate');
      return;
    }
    dial(digits, known);
    setDigits('');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + space.sm }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={[styles.chip, { backgroundColor: colors.surface }]}>
          <View style={[styles.dot, { backgroundColor: stage === 'active' ? colors.call : colors.warning }]} />
          <Text variant="label">{account?.number ? formatPhone(account.number) : 'No number yet'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Recharge" onPress={() => router.push('/recharge')} style={[styles.chip, { backgroundColor: colors.brandSoft }]}>
          <Wallet size={15} color={colors.brand} />
          <Text variant="label" tone="brand">
            {formatBdt(account?.balance ?? 0)}
          </Text>
        </Pressable>
      </View>

      {stage === 'activate' && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/activate')} style={[styles.banner, { backgroundColor: colors.brandSoft }]}>
          <Sparkles size={18} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text variant="label">Activate your number</Text>
            <Text variant="caption" tone="secondary">
              Recharge {formatBdt(minActivation)} or more to start calling.
            </Text>
          </View>
          <Text variant="label" tone="brand">
            Activate
          </Text>
        </Pressable>
      )}
      {stage === 'registering' && (
        <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
          <Clock3 size={18} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text variant="label">Registering your number</Text>
            <Text variant="caption" tone="secondary">
              Usually a few hours. We'll let you know when you can call.
            </Text>
          </View>
          {__DEV__ && (
            <Pressable onPress={devActivate} hitSlop={8}>
              <Text variant="small" tone="tertiary">
                Dev: ready
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <Pressable
        style={styles.display}
        onLongPress={async () => {
          const text = (await Clipboard.getStringAsync()).replace(/[^\d+*#]/g, '').slice(0, 15);
          if (text) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setDigits(text);
          }
        }}
        accessibilityHint="Long-press to paste a number"
      >
        <Text style={[styles.number, { color: colors.text, fontSize: digits.length > 12 ? 30 : 38 }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatTyping(digits)}
        </Text>
        <View style={styles.under}>
          {known && <Text tone="secondary">{known}</Text>}
          {free && (
            <Animated.View entering={FadeIn} exiting={FadeOut}>
              <Badge label="Free call on Envo" tone="call" />
            </Animated.View>
          )}
          {!digits && <Text tone="tertiary">Enter a number</Text>}
        </View>
      </Pressable>

      <View style={styles.pad}>
        {[0, 3, 6, 9].map((start) => (
          <View key={start} style={styles.padRow}>
            {KEYS.slice(start, start + 3).map(([d, letters]) => (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={d === '*' ? 'Star' : d === '#' ? 'Hash' : d}
                onPress={() => press(d)}
                onLongPress={d === '0' ? () => setDigits((x) => (x.length < 15 ? `${x}+` : x)) : undefined}
                style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.elementPressed : colors.element }]}
              >
                <Text style={[styles.keyDigit, { color: colors.text }]}>{d}</Text>
                {letters ? <Text style={[styles.keyLetters, { color: colors.textSecondary }]}>{letters}</Text> : null}
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + 92 }]}>
        <View style={styles.side} />
        <Animated.View style={shaking}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Call"
            onPress={call}
            style={({ pressed }) => [styles.callButton, { backgroundColor: colors.call, opacity: stage === 'active' || !digits ? 1 : 0.55, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
          >
            <Phone size={30} color="#FFFFFF" fill="#FFFFFF" />
          </Pressable>
        </Animated.View>
        <View style={styles.side}>
          {digits.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete"
              accessibilityHint="Long-press to clear"
              onPress={() => setDigits((x) => x.slice(0, -1))}
              onLongPress={() => setDigits('')}
              hitSlop={12}
              style={({ pressed }) => [styles.delete, pressed && { backgroundColor: colors.element }]}
            >
              <Delete size={28} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const KEY = 78;
const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 14, borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, padding: space.md, marginTop: space.lg },
  display: { flex: 1, minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  number: { fontFamily: fonts.semibold, letterSpacing: 1, fontVariant: ['tabular-nums'], textAlign: 'center' },
  under: { minHeight: 26, alignItems: 'center', justifyContent: 'center' },
  pad: { gap: 14 },
  padRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  keyDigit: { fontFamily: fonts.medium, fontSize: 32, lineHeight: 36 },
  keyLetters: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.4, marginTop: -2 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: space.xl },
  side: { width: 96, alignItems: 'center' },
  callButton: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  delete: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
