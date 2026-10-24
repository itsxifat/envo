import { forwardRef, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CircleAlert, Eye, EyeOff } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, radius, space } from '@/theme/tokens';
import { useScreenScroll } from './Screen';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Fixed text before what the person types, e.g. the number prefix. */
  prefix?: string;
  right?: ReactNode;
}

/** What a ref to an Input points at (for .focus()). */
export type InputRef = ComponentRef<typeof TextInput>;

/**
 * A labelled field with a hint or error under it; password fields get a show/hide eye. When focused
 * it scrolls itself into view above the keyboard.
 */
export const Input = forwardRef<InputRef, InputProps>(function Input({ label, hint, error, prefix, right, secureTextEntry, style, accessibilityLabel, accessibilityHint, ...rest }, ref) {
  const { colors } = useTheme();
  const { reveal } = useScreenScroll();
  const wrap = useRef<ComponentRef<typeof View>>(null);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const border = error ? colors.danger : focused ? colors.brand : colors.borderStrong;
  return (
    <View ref={wrap} collapsable={false}>
      {label && (
        // The field itself carries the label for screen readers.
        <Text variant="label" importantForAccessibility="no" style={styles.label}>
          {label}
        </Text>
      )}
      <View style={[styles.box, { backgroundColor: colors.field, borderColor: border }]}>
        {prefix && (
          <View style={[styles.prefix, { borderRightColor: colors.border }]}>
            <Text style={[styles.prefixText, { color: colors.textSecondary }]}>{prefix}</Text>
          </View>
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
          accessibilityHint={accessibilityHint ?? (error || hint)}
          secureTextEntry={secureTextEntry && hidden}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            reveal(wrap.current);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text }, style]}
        />
        {secureTextEntry && (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} hitSlop={10} onPress={() => setHidden(!hidden)} style={styles.eye}>
            {hidden ? <Eye size={20} color={colors.textSecondary} strokeWidth={iconStroke} /> : <EyeOff size={20} color={colors.textSecondary} strokeWidth={iconStroke} />}
          </Pressable>
        )}
        {right}
      </View>
      {/* Always there, so a new error is read out as it appears. */}
      <View accessibilityLiveRegion="polite">
        {error ? (
          <View style={styles.error}>
            <CircleAlert size={14} color={colors.danger} strokeWidth={2} style={styles.errorIcon} />
            <Text variant="caption" tone="danger" style={styles.flex}>
              {error}
            </Text>
          </View>
        ) : null}
      </View>
      {!error && hint ? (
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { marginBottom: space.sm },
  box: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  prefix: { paddingLeft: space.lg, paddingRight: space.md, borderRightWidth: 1, height: 28, justifyContent: 'center' },
  prefixText: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: 0.5 },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 16, paddingHorizontal: space.lg, paddingVertical: space.md },
  eye: { paddingHorizontal: space.lg, alignSelf: 'stretch', justifyContent: 'center' },
  hint: { marginTop: 6 },
  error: { flexDirection: 'row', gap: 6, marginTop: 6 },
  errorIcon: { marginTop: 2 },
});
