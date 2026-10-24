import { Alert, Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

import type { InputRef } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, space } from '@/theme/tokens';

/*
 * The top of the screens that get a number: a back chevron, how far along the person is, and "3 of 5".
 * The steps are the account, the email code, the NID details, the address and the photos. Below it,
 * small pieces these screens share.
 */

export function OnboardingHeader({ step, count = 5, onBack }: { step: number; count?: number; onBack?: () => void }) {
  const { colors } = useTheme();
  // `step` counts from 0; people read "1 of 5".
  const now = Math.min(count, Math.max(1, step + 1));
  return (
    <View style={styles.row}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.back, { backgroundColor: pressed ? colors.element : 'transparent' }]}
        >
          <ChevronLeft size={26} color={colors.text} strokeWidth={iconStroke} />
        </Pressable>
      ) : (
        // The bar keeps its place whether or not there is a way back.
        <View style={styles.back} />
      )}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${now} of ${count}`}
        accessibilityValue={{ min: 1, max: count, now }}
        style={styles.bar}
      >
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={[styles.segment, { backgroundColor: i < now ? colors.brand : colors.track }]} />
        ))}
      </View>
      <Text variant="small" tone="secondary" importantForAccessibility="no" style={styles.count}>
        {`${now} of ${count}`}
      </Text>
    </View>
  );
}

/** A link in place of a button: blue words, 44 high so it's easy to tap. */
export function TextLink({ title, onPress, disabled, role = 'button', style }: { title: string; onPress: () => void; disabled?: boolean; role?: 'button' | 'link'; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={{ left: 8, right: 8 }}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.pressed, style]}
    >
      {/* Wraps with large text rather than cutting the words off. */}
      <Text style={[styles.linkText, { color: disabled ? colors.textSecondary : colors.brand }]}>{title}</Text>
    </Pressable>
  );
}

/**
 * Puts the cursor in a field and brings the keyboard up (the field then scrolls into view). Android
 * does neither for a field that kept the cursor after the keyboard went down, so that one lets go first.
 */
export function focusField(input: InputRef | null | undefined) {
  if (!input) return;
  if (!input.isFocused()) return input.focus();
  if (Keyboard.isVisible()) return;
  input.blur();
  setTimeout(() => input.focus(), 50);
}

/** Nothing on these screens signs out with one tap: it asks first. */
export function confirmSignOut(signOut: () => void, message = 'Sign in later with this email and password to finish getting your number.') {
  Alert.alert('Sign out?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: signOut },
  ]);
}

const styles = StyleSheet.create({
  row: { height: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: space.sm, paddingRight: space.xl, gap: space.sm },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  count: { marginLeft: space.xs, fontVariant: ['tabular-nums'] },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.6 },
});
