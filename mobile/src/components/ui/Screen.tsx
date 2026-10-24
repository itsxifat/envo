import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from 'lucide-react-native';

import { ReturnToCallContext } from '@/components/ReturnToCallBar';
import { useTheme } from '@/theme/theme';
import { iconStroke, space } from '@/theme/tokens';
import { Text } from './Text';

type HostView = ComponentRef<typeof View>;

export interface ScreenScroll {
  /** Scrolls the page so this view sits near the top, once the keyboard is up (inputs call it when focused). */
  reveal: (node: HostView | null) => void;
}

export const ScreenScrollContext = createContext<ScreenScroll>({ reveal: () => undefined });
export const useScreenScroll = () => useContext(ScreenScrollContext);

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
  /** The docked tab bar sits below (it keeps clear of the phone's buttons itself). */
  tabBar?: boolean;
  /** Replaces the back bar, e.g. the onboarding steps. */
  header?: ReactNode;
  /** Pull to refresh (scrolling screens). */
  onRefresh?: () => Promise<void>;
  /**
   * While the keyboard is up the footer rides on it ('ride'), or moves to the end of the page ('hide')
   * so long forms keep the room it takes.
   */
  keyboardFooter?: 'ride' | 'hide';
}

/** A screen: safe areas, background, header, optional scrolling and a pinned footer. */
export function Screen({ children, title, subtitle, back, onBack, right, scroll, footer, contentStyle, tabBar, header, onRefresh, keyboardFooter = 'ride' }: ScreenProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  // The green return-to-call bar sits above the screen while a call goes on.
  const callBar = useContext(ReturnToCallContext);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentRef = useRef<HostView>(null);
  const keyboardUp = useRef(false);
  const waiting = useRef<{ node: HostView; at: number } | null>(null);
  const [keyboard, setKeyboard] = useState(() => Keyboard.isVisible());
  const [refreshing, setRefreshing] = useState(false);

  const scrollTo = useCallback((node: HostView) => {
    const content = contentRef.current;
    if (!content) return;
    node.measureLayout(content, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true }), () => undefined);
  }, []);

  // Android only tells when the keyboard has shown or hidden.
  useEffect(() => {
    keyboardUp.current = Keyboard.isVisible();
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardUp.current = true;
      setKeyboard(true);
      const w = waiting.current;
      waiting.current = null;
      // A moment for the page to shrink above the keyboard first.
      if (w && Date.now() - w.at < 1500) setTimeout(() => scrollTo(w.node), 50);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
      setKeyboard(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollTo]);

  const reveal = useCallback(
    (node: HostView | null) => {
      if (!node || !scroll) return;
      if (keyboardUp.current) setTimeout(() => scrollTo(node), 150);
      else waiting.current = { node, at: Date.now() };
    },
    [scroll, scrollTo],
  );
  const scrollValue = useMemo(() => ({ reveal }), [reveal]);

  const pull = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The screen keeps what it shows; the offline notices say why.
    } finally {
      setRefreshing(false);
    }
  };

  const footerInside = !!footer && keyboardFooter === 'hide' && keyboard;
  const footerPinned = !!footer && !footerInside;
  // With the keyboard up, the phone's own buttons are under it; a pinned footer keeps clear of them itself.
  const bottom = (tabBar ? space.xl : footerPinned || keyboard ? 0 : insets.bottom + space.lg) + (keyboard ? space.xl : 0);

  // The big title keeps its own side padding, so lists can run edge to edge under it.
  const body = (
    <>
      {!!title && !back && (
        <View style={styles.bigHeader}>
          <View style={styles.flex}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
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
      {footerInside && <View style={styles.footerInside}>{footer}</View>}
    </>
  );
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={callBar} style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Each screen sets its own, so leaving the always-dark welcome screen brings dark icons back. */}
      <StatusBar style={dark || callBar ? 'light' : 'dark'} />
      <View style={{ height: insets.top, backgroundColor: colors.background }} />
      {header ??
        (back && (
          <View style={styles.bar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))}
              style={({ pressed }) => [styles.backButton, { backgroundColor: pressed ? colors.element : 'transparent' }]}
            >
              <ChevronLeft size={26} color={colors.text} strokeWidth={iconStroke} />
            </Pressable>
            <Text variant="heading" numberOfLines={1} accessibilityRole="header" style={styles.barTitle}>
              {title}
            </Text>
            <View style={styles.barRight}>{right}</View>
          </View>
        ))}
      <ScreenScrollContext.Provider value={scrollValue}>
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: bottom }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} colors={[colors.brand]} tintColor={colors.brand} progressBackgroundColor={colors.surface} /> : undefined
            }
          >
            <View ref={contentRef} collapsable={false} style={styles.grow}>
              {body}
            </View>
          </ScrollView>
        ) : (
          <View style={[styles.flex, { paddingBottom: bottom }]}>{body}</View>
        )}
      </ScreenScrollContext.Provider>
      {footerPinned && <View style={[styles.footer, { paddingBottom: (keyboard ? 0 : insets.bottom) + space.md, backgroundColor: colors.background }]}>{footer}</View>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.xl },
  bigHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, gap: space.md },
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center' },
  barRight: { width: 44, alignItems: 'center' },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
  footerInside: { marginTop: space.xl, paddingHorizontal: space.xl, gap: space.sm },
});
