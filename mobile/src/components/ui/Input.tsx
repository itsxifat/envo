import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
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

/** A labelled field with a hint or error under it; password fields get a show/hide eye. */
export const Input = forwardRef<InputRef, InputProps>(function Input({ label, hint, error, prefix, right, secureTextEntry, style, ...rest }, ref) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const border = error ? colors.danger : focused ? colors.brand : 'transparent';
  return (
    <View style={styles.wrap}>
      {label && (
        <Text variant="label" tone="secondary" style={styles.label}>
          {label}
        </Text>
      )}
      <View style={[styles.box, { backgroundColor: colors.element, borderColor: border }]}>
        {prefix && (
          <View style={[styles.prefix, { borderRightColor: colors.border }]}>
            <Text style={[styles.prefixText, { color: colors.textSecondary }]}>{prefix}</Text>
          </View>
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secureTextEntry && hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text }, style]}
          {...rest}
        />
        {secureTextEntry && (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} hitSlop={10} onPress={() => setHidden(!hidden)} style={styles.eye}>
            {hidden ? <Eye size={20} color={colors.textSecondary} /> : <EyeOff size={20} color={colors.textSecondary} />}
          </Pressable>
        )}
        {right}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" style={styles.below}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary" style={styles.below}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { marginLeft: 4 },
  box: { minHeight: 54, borderRadius: radius.md, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  prefix: { paddingLeft: space.lg, paddingRight: space.md, borderRightWidth: 1, height: 28, justifyContent: 'center' },
  prefixText: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: 0.5 },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 16, paddingHorizontal: space.lg, paddingVertical: 14 },
  eye: { paddingHorizontal: space.lg, alignSelf: 'stretch', justifyContent: 'center' },
  below: { marginLeft: 4 },
});
