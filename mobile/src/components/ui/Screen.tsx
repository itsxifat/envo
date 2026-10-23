import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from 'lucide-react-native';

import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { Text } from './Text';

export interface ScreenProps {
  children: ReactNode;
  /** A large title at the top (tab screens) or a small centred one with a back button (pushed screens). */
  title?: string;
  subtitle?: string;
  back?: boolean;
  /** Replaces going back a screen, e.g. to step back inside a form with several parts. */
  onBack?: () => void;
  /** Content of the right side of the header. */
  right?: ReactNode;
  scroll?: boolean;
  /** Pinned at the bottom above the safe area (the main action of a form). */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Room for the floating tab bar. */
  tabBar?: boolean;
}

/** A screen: safe areas, background, header, optional scrolling and a pinned footer. */
export function Screen({ children, title, subtitle, back, onBack, right, scroll, footer, contentStyle, tabBar }: ScreenProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = (tabBar ? 96 : 0) + (footer ? 0 : insets.bottom + space.lg);
  // The big title keeps its own side padding, so lists can run edge to edge under it.
  const body = (
    <>
      {!!title && !back && (
        <View style={styles.bigHeader}>
          <View style={{ flex: 1 }}>
            <Text variant="title">{title}</Text>
            {subtitle && (
              <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                {subtitle}
              </Text>
            )}
          </View>
          {right}
        </View>
      )}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </>
  );
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Each screen sets its own, so leaving the always-dark welcome screen brings dark icons back. */}
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={{ height: insets.top, backgroundColor: colors.background }} />
      {back && (
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [styles.backButton, { backgroundColor: pressed ? colors.element : 'transparent' }]}
          >
            <ChevronLeft size={26} color={colors.text} />
          </Pressable>
          <Text variant="heading" numberOfLines={1} style={styles.barTitle}>
            {title}
          </Text>
          <View style={styles.barRight}>{right}</View>
        </View>
      )}
      {scroll ? (
        <ScrollView style={styles.flex} contentContainerStyle={{ flexGrow: 1, paddingBottom: bottom }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.flex, { paddingBottom: bottom }]}>{body}</View>
      )}
      {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + space.md, backgroundColor: colors.background }]}>{footer}</View>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.xl },
  bigHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.lg, gap: space.md },
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center' },
  barRight: { width: 44, alignItems: 'center' },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
});
