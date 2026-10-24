import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text as Span, Share, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Check, Copy, Share2, type LucideIcon } from 'lucide-react-native';

import { formatAmount, formatPhone } from '@/lib/format';
import { toast } from '@/lib/toast';
import { AlwaysDark, useTheme } from '@/theme/theme';
import { fonts, gradients, palette, radius, shadow, type } from '@/theme/tokens';
import { PulseDot } from './Steps';
import { Text } from './Text';

/*
 * The person's number on the night card (navy into ink, like Welcome and the call screens). Text on it
 * is never fainter than 64% white, so it stays readable even on the lighter corner in dark mode.
 */

/** Text colours on the night card (and other night surfaces). */
export const NIGHT = {
  text: palette.white,
  soft: 'rgba(255,255,255,0.72)',
  muted: 'rgba(255,255,255,0.64)',
  line: 'rgba(255,255,255,0.12)',
  amber: palette.amber400,
};

const STATUS = {
  ready: { fg: palette.green300, bg: 'rgba(34,197,94,0.18)' },
  waiting: { fg: palette.amber400, bg: 'rgba(245,158,11,0.18)' },
  alert: { fg: palette.red300, bg: 'rgba(248,113,113,0.18)' },
} as const;

export type CardStatus = { label: string; tone: 'ready' | 'waiting' | 'alert'; pulse?: boolean };

export interface NumberCardProps {
  number: string | null;
  /** Default 'Your Envo number'. */
  label?: string;
  /** Shown instead of the number while there is none, e.g. "We're picking your number". */
  placeholder?: string;
  status?: CardStatus;
  /** Default: on when there is a number. */
  copy?: boolean;
  share?: boolean;
  /** The digit groups arrive one after the other (the number reveal). */
  revealDigits?: boolean;
  size?: 'hero' | 'compact';
  /** compact only: replaces the status pill on the right. */
  right?: ReactNode;
  /** hero only: shown under a hairline. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function NumberCard({ number, label = 'Your Envo number', placeholder, status, copy, share = false, revealDigits, size = 'hero', right, children, style }: NumberCardProps) {
  const { dark } = useTheme();
  const compact = size === 'compact';
  const surface = [
    styles.card,
    compact ? styles.compact : styles.hero,
    // Something behind the gradient, so Android draws the shadow.
    { backgroundColor: dark ? palette.ink900 : palette.ink950 },
    dark ? styles.raisedEdge : shadow.hero,
    style,
  ];
  const groups = number ? formatPhone(number).split(' ') : [];

  return (
    <AlwaysDark>
      <View style={surface}>
        <LinearGradient {...(dark ? gradients.nightRaised : gradients.night)} style={[StyleSheet.absoluteFill, { borderRadius: compact ? radius.lg : radius.xl }]} />
        {compact ? (
          <View style={styles.compactRow}>
            <View style={styles.flex}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.compactNumber} numberOfLines={1} adjustsFontSizeToFit>
                {number ? formatPhone(number) : (placeholder ?? 'No number yet')}
              </Text>
            </View>
            {right ?? (status && <StatusPill status={status} />)}
          </View>
        ) : (
          <>
            <View style={styles.top}>
              <Text style={[styles.label, styles.flex]} numberOfLines={1}>
                {label}
              </Text>
              {status && <StatusPill status={status} />}
            </View>
            <View style={styles.numberRow}>
              {number ? <Digits groups={groups} reveal={!!revealDigits} /> : <Text style={styles.placeholder}>{placeholder ?? ''}</Text>}
              {number && (copy ?? true) && <CopyButton number={number} />}
              {number && share && <ShareButton number={number} />}
            </View>
            {children && (
              <>
                <View style={styles.hairline} />
                {children}
              </>
            )}
          </>
        )}
      </View>
    </AlwaysDark>
  );
}

/** "09639 437 002": the prefix group dimmer than the rest. */
function Digits({ groups, reveal }: { groups: string[]; reveal: boolean }) {
  const [width, setWidth] = useState(0);
  const spoken = groups.join(' ');
  if (!reveal) {
    return (
      <Text style={[type.phone, styles.number]} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={spoken}>
        {/* A plain span inherits the number's size; only its colour differs. */}
        <Span style={{ color: NIGHT.muted }}>{groups[0]}</Span>
        {groups.length > 1 ? ` ${groups.slice(1).join(' ')}` : ''}
      </Text>
    );
  }
  // Each group comes in on its own, so they can't share one shrinking text: size them to the room
  // instead (an 11-digit number is about 8 em wide in Geist, spaces and spacing included).
  const fontSize = width ? Math.min(type.phone.fontSize, Math.floor(width / 8.3)) : type.phone.fontSize;
  return (
    <View accessible accessibilityLabel={spoken} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.groups}>
      {groups.map((g, i) => (
        <Animated.View key={i} entering={FadeInDown.delay(300 + i * 160).springify().damping(14)}>
          <Text style={[type.phone, { fontSize, color: i === 0 ? NIGHT.muted : NIGHT.text }]}>{g}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

function StatusPill({ status }: { status: CardStatus }) {
  const look = STATUS[status.tone];
  return (
    <View accessible accessibilityLabel={`Status: ${status.label}`} style={[styles.pill, { backgroundColor: look.bg }]}>
      <PulseDot color={look.fg} size={6} pulse={!!status.pulse} />
      <Text maxFontSizeMultiplier={1.3} style={[styles.pillText, { color: look.fg }]}>
        {status.label}
      </Text>
    </View>
  );
}

function CopyButton({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <CircleButton
      icon={copied ? Check : Copy}
      label="Copy your number"
      onPress={async () => {
        try {
          await Clipboard.setStringAsync(number);
        } catch {
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast('Number copied');
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    />
  );
}

function ShareButton({ number }: { number: string }) {
  return <CircleButton icon={Share2} label="Share your number" onPress={() => void Share.share({ message: `My Envo number: ${formatPhone(number)}` }).catch(() => undefined)} />;
}

function CircleButton({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.circle, { backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : NIGHT.line }]}>
      <Icon size={16} color={NIGHT.text} strokeWidth={2} />
    </Pressable>
  );
}

/** The calling balance on the card, with a button on the right (or a full-width one under it). */
export function CardBalance({ amount, amountTone = 'default', note, noteTone = 'default', action }: { amount: number; amountTone?: 'default' | 'warning'; note?: string; noteTone?: 'default' | 'warning'; action?: ReactNode }) {
  // A block button goes under the balance; any other sits on its right.
  const below = isValidElement<CardButtonProps>(action) && !!action.props.block;
  return (
    <View>
      <View style={styles.balanceRow}>
        <View style={styles.flex}>
          <Text style={styles.label}>Calling balance</Text>
          <View style={styles.amountRow} accessible accessibilityLabel={`BDT ${formatAmount(amount)}`}>
            <Text style={styles.currency}>BDT</Text>
            <Text style={[type.amount, styles.shrink, { color: amountTone === 'warning' ? NIGHT.amber : NIGHT.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {formatAmount(amount)}
            </Text>
          </View>
          {note ? <Text style={[styles.note, { color: noteTone === 'warning' ? NIGHT.amber : NIGHT.soft }]}>{note}</Text> : null}
        </View>
        {!below && action}
      </View>
      {below && action}
    </View>
  );
}

export interface CardButtonProps {
  title: string;
  onPress?: () => void;
  icon?: LucideIcon;
  /** Full width under the text, and taller. */
  block?: boolean;
  disabled?: boolean;
}

/** The white pill on the night card. */
export function CardButton({ title, onPress, icon: Icon, block, disabled }: CardButtonProps) {
  const fg = disabled ? NIGHT.muted : palette.ink950;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={block ? undefined : { top: 4, bottom: 4 }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.cardButton,
        block && styles.cardButtonBlock,
        { backgroundColor: disabled ? 'rgba(255,255,255,0.16)' : pressed ? palette.grey200 : palette.white },
        pressed && !disabled && styles.pressed,
      ]}
    >
      {Icon && <Icon size={16} color={fg} strokeWidth={2.5} />}
      <Text maxFontSizeMultiplier={1.3} style={[styles.cardButtonText, { fontSize: block ? 16 : 14, color: fg }]}>
        {title}
      </Text>
    </Pressable>
  );
}

/** A sentence on the night card. */
export function CardText({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' }) {
  return <Text style={[styles.cardText, { color: tone === 'warning' ? NIGHT.amber : NIGHT.soft }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  card: { overflow: 'hidden' },
  hero: { borderRadius: radius.xl, padding: 20 },
  compact: { borderRadius: radius.lg, padding: 16 },
  raisedEdge: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  top: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: NIGHT.muted },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 36 },
  number: { flex: 1, color: NIGHT.text },
  groups: { flex: 1, flexDirection: 'row', gap: 8 },
  placeholder: { ...type.heading, flex: 1, color: NIGHT.text },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: NIGHT.line, marginVertical: 16 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  compactNumber: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'], color: NIGHT.text, marginTop: 2 },
  pill: { minHeight: 24, paddingHorizontal: 10, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  balanceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  currency: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: NIGHT.soft },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 4 },
  cardButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cardButtonBlock: { minHeight: 48, alignSelf: 'stretch', marginTop: 16 },
  cardButtonText: { fontFamily: fonts.semibold, color: palette.ink950 },
  pressed: { transform: [{ scale: 0.98 }] },
  cardText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
