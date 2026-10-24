import { useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Asterisk, ClipboardPaste, Delete, Phone, Wallet } from 'lucide-react-native';

import { useCallGate, type GateReason } from '@/components/CallGate';
import { ReturnToCallContext } from '@/components/ReturnToCallBar';
import { useTabBarHeight } from '@/components/TabBar';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatPhone, formatTyping } from '@/lib/format';
import { isEnvoNumber } from '@/lib/numbers';
import { toast } from '@/lib/toast';
import { useCalls } from '@/state/calls';
import { normalizeNumber, useContacts } from '@/state/contacts';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { Sounds } from '@/state/sounds';
import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, palette, radius, space } from '@/theme/tokens';

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

/** Why calls out can't be made right now, in one line above the number, and the link that helps. */
const BLOCKED: Record<GateReason, { text: string; link?: { label: string; href: '/activate' | '/recharge' } }> = {
  activate: { text: 'Activate your number to call', link: { label: 'Activate', href: '/activate' } },
  checking: { text: "We're checking your payment" },
  registering: { text: 'You can call once your number is registered' },
  empty: { text: 'Your balance has run out', link: { label: 'Recharge', href: '/recharge' } },
  offline: { text: 'No internet. Calls need a connection.' },
  'no-number': { text: "We're picking your number" },
};
/** With the balance used up while calls to Envo numbers are free: those still go out. */
const ENVO_ONLY = { text: 'Only free calls to Envo numbers', link: { label: 'Recharge', href: '/recharge' as const } };

const MAX_DIGITS = 15;
const BLOCKED_LINE = 40;
const SUGGESTION = 48;
/** Under the suggestions: the number, the line under it and the space below. */
const NUMBER_BLOCK = 44 + 8 + 24 + 16;

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));

/** The first phone number in some copied text: "Call +880 1712-345678 today" → "01712345678". */
function numberIn(text: string): string {
  // A stray figure ("at 5 pm", "No. 12") isn't a number to call: it needs 3 digits or more.
  const runs = /\+?\d[\d\s().-]{1,24}/g;
  for (let m = runs.exec(text); m; m = runs.exec(text)) {
    const n = normalizeNumber(m[0]);
    if (n.replace(/\D/g, '').length >= 3) return n.slice(0, MAX_DIGITS);
  }
  return '';
}

export function KeypadScreen() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const tabBarHeight = useTabBarHeight();
  // The green return-to-call bar takes room above the screen while a call goes on.
  const callBar = useContext(ReturnToCallContext);
  const { account, config, recents } = useSession();
  const { people, nameOf } = useContacts();
  const { dial } = useCalls();
  const { keypadSounds } = useSettings();
  const gate = useCallGate();
  const reduce = useReducedMotion();
  const [digits, setDigits] = useState('');
  // The real room once laid out (the window minus the tab bar, before that).
  const [screen, setScreen] = useState<number | null>(null);
  const [display, setDisplay] = useState(0);
  const shake = useSharedValue(0);
  const shaking = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const blocked = gate.envoOnly ? ENVO_ONLY : gate.reason ? BLOCKED[gate.reason] : null;
  // The call button stays green when some numbers can still be called.
  const callable = gate.canCall || gate.envoOnly;
  const paused = !!config && !config.payment.online;
  // Nothing to pay with while payments are paused, so no link to the payment.
  const link = blocked?.link && !(gate.reason === 'activate' && paused) ? blocked.link : null;

  // Keys as big as the screen allows: 360 × 640 phones and 3-button navigation still fit.
  const room = (screen ?? height - callBar - tabBarHeight) - insets.top - (blocked ? BLOCKED_LINE : 0);
  const KEY = clamp(60, 76, Math.floor((room - 196) / 5.54));
  const rowGap = Math.round(KEY * 0.18);

  // A name for the number, when it is in the contacts or was called before.
  const known = useMemo(() => nameOf(digits) ?? recents.find((r) => r.name && r.number === digits)?.name ?? null, [nameOf, recents, digits]);
  const envo = isEnvoNumber(digits);
  const free = !!config?.free_onnet && envo;
  const rate = config?.rate_per_min ?? 0;
  // What a minute costs, once the number is whole.
  const price = !free && digits.length >= 11 && rate > 0 ? `${formatBdt(rate)} a minute` : null;

  // People whose number has the digits typed so far (not once the number is a known one).
  const suggestions = useMemo(() => {
    if (digits.length < 3 || !/^\d+$/.test(digits)) return [];
    const found = new Map<string, string | null>();
    let exact = false;
    const add = (number: string, name: string | null) => {
      if (number === digits) exact = true;
      else if (number.includes(digits) && !found.has(number)) found.set(number, name);
    };
    for (const p of people) for (const n of p.numbers) add(n, p.name);
    for (const r of recents) add(normalizeNumber(r.number), r.name ?? nameOf(r.number));
    return exact ? [] : [...found].slice(0, 2).map(([number, name]) => ({ number, name }));
  }, [digits, people, recents, nameOf]);
  // As many as fit above the number: two, or one on smaller keypads.
  const fit = Math.max(0, Math.floor((display - NUMBER_BLOCK) / SUGGESTION));
  const shown = suggestions.slice(0, Math.min(KEY < 68 ? 1 : 2, fit));

  const press = (d: string) => {
    if (digits.length >= MAX_DIGITS) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (keypadSounds) Sounds.key(d);
    setDigits((x) => x + d);
  };

  const call = () => {
    // An empty keypad brings back the last number called, like most phones.
    const last = digits ? null : recents.find((r) => r.direction === 'out');
    if (last) return setDigits(normalizeNumber(last.number).slice(0, MAX_DIGITS));
    // Nothing to call back: a keypad that can call waits for a number, one that can't still says why.
    if (!digits && callable) return;
    // Can't call now: it shakes, buzzes and says why (the sheet).
    if (!callable && !reduce) shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 }));
    gate.guard(() => {
      dial(digits, known);
      setDigits('');
    }, digits);
  };

  // The clipboard is read only when asked (Android tells the person each time it is read).
  const paste = async () => {
    void Haptics.selectionAsync();
    const text = await Clipboard.getStringAsync().catch(() => '');
    const number = numberIn(text);
    if (!number) return toast('Nothing to paste');
    setDigits(number);
    toast('Number pasted');
  };

  const under = free ? (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.underRow}>
      {known && (
        <Text tone="secondary" numberOfLines={1} style={styles.shrink}>
          {known}
        </Text>
      )}
      <Badge label="Free call on Envo" tone="call" dot />
    </Animated.View>
  ) : price ? (
    <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.tabular}>
      {known ? `${known} · ${price}` : price}
    </Text>
  ) : known ? (
    <Text tone="secondary" numberOfLines={1}>
      {known}
    </Text>
  ) : null;

  return (
    <View onLayout={(e) => setScreen(e.nativeEvent.layout.height)} style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + space.sm }]}>
      <StatusBar style={dark || callBar ? 'light' : 'dark'} />
      <View style={styles.top}>
        <View style={styles.from}>
          <View style={[styles.dot, { backgroundColor: callable ? colors.call : colors.warning }]} />
          <Text variant="label" tone="secondary" numberOfLines={1} style={[styles.shrink, styles.tabular]}>
            {account?.number ? `From ${formatPhone(account.number)}` : 'No number yet'}
          </Text>
        </View>
        {gate.canCall && account && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Balance ${formatBdt(account.balance)}. Recharge`}
            onPress={() => router.push('/recharge')}
            style={({ pressed }) => [styles.balance, pressed && styles.faded]}
          >
            <Wallet size={16} color={colors.brand} strokeWidth={2} />
            <Text variant="label" style={[styles.link, styles.tabular, { color: colors.brand }]}>
              {formatBdt(account.balance)}
            </Text>
          </Pressable>
        )}
      </View>

      {blocked && (
        <View style={styles.blocked} accessibilityLiveRegion="polite">
          <Text variant="label" tone="warning" style={styles.shrink}>
            {blocked.text}
          </Text>
          {link && (
            <Pressable accessibilityRole="button" accessibilityLabel={link.label} hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }} onPress={() => router.push(link.href)} style={({ pressed }) => [styles.blockedLink, pressed && styles.faded]}>
              <Text variant="label" style={[styles.link, { color: colors.brand }]}>
                {link.label}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <View onLayout={(e) => setDisplay(e.nativeEvent.layout.height)} style={styles.display}>
        {shown.map((s) => (
          <Pressable
            key={s.number}
            accessibilityRole="button"
            accessibilityLabel={s.name ? `${s.name}, ${formatPhone(s.number)}` : formatPhone(s.number)}
            accessibilityHint="Puts this number in"
            onPress={() => {
              void Haptics.selectionAsync();
              setDigits(s.number.slice(0, MAX_DIGITS));
            }}
            style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.surface }]}
          >
            <Avatar name={s.name} size={32} />
            <View style={styles.shrink}>
              <Text variant="bodyMedium" numberOfLines={1} style={!s.name && styles.tabular}>
                {s.name ?? formatPhone(s.number)}
              </Text>
              {s.name ? (
                <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.tabular}>
                  {formatPhone(s.number)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        <Text variant="phoneLg" accessibilityLiveRegion="polite" numberOfLines={1} adjustsFontSizeToFit style={[styles.number, digits.length > 12 && styles.numberLong]}>
          {formatTyping(digits)}
        </Text>
        <View style={styles.under}>{under}</View>
      </View>

      <View style={{ gap: rowGap }}>
        {[0, 3, 6, 9].map((start) => (
          <View key={start} style={styles.padRow}>
            {KEYS.slice(start, start + 3).map(([d, letters]) => (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={d === '*' ? 'Star' : d === '#' ? 'Hash' : d}
                accessibilityHint={d === '0' ? 'Long-press for plus' : undefined}
                onPress={() => press(d)}
                onLongPress={d === '0' ? () => setDigits((x) => (x.length < MAX_DIGITS ? `${x}+` : x)) : undefined}
                style={({ pressed }) => [styles.key, { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: pressed ? colors.elementPressed : colors.element }]}
              >
                {d === '*' ? (
                  <Asterisk size={Math.round(KEY * 0.32)} color={colors.text} strokeWidth={iconStroke} />
                ) : (
                  <Text maxFontSizeMultiplier={1.3} style={[styles.keyDigit, { color: colors.text, fontSize: Math.round(KEY * 0.44), lineHeight: Math.round(KEY * 0.5) }]}>
                    {d}
                  </Text>
                )}
                {letters ? (
                  <Text maxFontSizeMultiplier={1.3} style={[styles.keyLetters, { color: colors.textSecondary }]}>
                    {letters}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      {/* Three columns lined up with the keys: paste or nothing, call, delete. */}
      <View style={[styles.padRow, styles.actions, { marginTop: Math.round(KEY * 0.24) }]}>
        <View style={{ width: KEY, height: KEY }}>
          {!digits && (
            <Pressable accessibilityRole="button" accessibilityLabel="Paste a number" onPress={() => void paste()} style={({ pressed }) => [styles.side, { borderRadius: KEY / 2 }, pressed && { backgroundColor: colors.element }]}>
              <ClipboardPaste size={22} color={colors.textSecondary} strokeWidth={iconStroke} />
              <Text maxFontSizeMultiplier={1.3} style={[styles.sideLabel, { color: colors.textSecondary }]}>
                Paste
              </Text>
            </Pressable>
          )}
        </View>
        <Animated.View style={shaking}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={digits ? `Call ${formatPhone(digits)}` : 'Redial last number'}
            onPress={call}
            style={({ pressed }) => [
              styles.callButton,
              { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: !callable ? colors.disabled : pressed ? colors.callPressed : colors.call },
              pressed && callable && styles.callPressed,
            ]}
          >
            <Phone size={30} color={callable ? palette.white : colors.onDisabled} fill={callable ? palette.white : colors.onDisabled} strokeWidth={iconStroke} />
          </Pressable>
        </Animated.View>
        <View style={{ width: KEY, height: KEY }}>
          {digits.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete"
              accessibilityHint="Long-press to clear"
              onPress={() => setDigits((x) => x.slice(0, -1))}
              onLongPress={() => setDigits('')}
              style={({ pressed }) => [styles.side, { borderRadius: KEY / 2 }, pressed && { backgroundColor: colors.element }]}
            >
              <Delete size={26} color={colors.textSecondary} strokeWidth={iconStroke} />
            </Pressable>
          )}
        </View>
      </View>
      {gate.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  faded: { opacity: 0.6 },
  top: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  from: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  balance: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { fontFamily: fonts.semibold },
  blocked: { minHeight: BLOCKED_LINE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  blockedLink: { minHeight: BLOCKED_LINE, justifyContent: 'center' },
  // The number sits just above the keys; suggestions go above it.
  display: { flex: 1, minHeight: 72, justifyContent: 'flex-end', paddingBottom: space.lg },
  suggestion: { height: SUGGESTION, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, borderRadius: radius.md },
  // Keeps its height while empty, so nothing moves with the first digit.
  number: { textAlign: 'center', minHeight: 44 },
  numberLong: { fontSize: 30, lineHeight: 38 },
  under: { minHeight: 24, marginTop: space.sm, alignItems: 'center', justifyContent: 'center' },
  underRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, maxWidth: '100%' },
  padRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  key: { alignItems: 'center', justifyContent: 'center' },
  keyDigit: { fontFamily: fonts.regular },
  keyLetters: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 12, letterSpacing: 1.4 },
  actions: { alignItems: 'center', paddingBottom: space.lg },
  side: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  sideLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  callButton: { alignItems: 'center', justifyContent: 'center' },
  callPressed: { transform: [{ scale: 0.94 }] },
});
