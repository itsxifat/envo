import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CircleUserRound, Clock3, Grid3x3, House, UsersRound, type LucideIcon } from 'lucide-react-native';

import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, iconStroke } from '@/theme/tokens';
import { Text } from './ui/Text';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ITEMS: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: 'Home', icon: House },
  recents: { label: 'Calls', icon: Clock3 },
  keypad: { label: 'Keypad', icon: Grid3x3 },
  contacts: { label: 'Contacts', icon: UsersRound },
  account: { label: 'Account', icon: CircleUserRound },
};

/** How tall the docked tab bar is, the phone's own buttons included. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return 60 + Math.max(insets.bottom, 8);
}

/** The five places of the phone, docked at the bottom; a red dot on Calls for missed calls not yet seen. */
export function TabBar({ state, navigateToTab }: TabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { recents, recentsSeenAt } = useSession();
  const since = Math.max(recentsSeenAt, Date.now() - 86_400_000);
  const missed = recents.some((r) => r.direction === 'missed' && new Date(r.at).getTime() > since);

  return (
    <View style={[styles.bar, { backgroundColor: colors.tabBar, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const item = ITEMS[route.name];
        if (!item) return null;
        const focused = state.index === index;
        const dot = route.name === 'recents' && missed && !focused;
        const Icon = item.icon;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={dot ? `${item.label}, new missed calls` : item.label}
            onPress={() => {
              if (focused) return;
              void Haptics.selectionAsync();
              navigateToTab(route.key);
            }}
            style={styles.item}
          >
            <View style={[styles.indicator, focused && { backgroundColor: colors.brandSoft }]}>
              <Icon size={22} color={focused ? colors.brand : colors.textSecondary} strokeWidth={focused ? 2.25 : iconStroke} />
              {dot && <View style={[styles.dot, { backgroundColor: colors.danger, borderColor: colors.tabBar }]} />}
            </View>
            <Text maxFontSizeMultiplier={1.3} style={[styles.label, { color: focused ? colors.brand : colors.textSecondary, fontFamily: focused ? fonts.semibold : fonts.medium }]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, alignItems: 'center', gap: 4, minHeight: 52 },
  indicator: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  // An 8 dot at top 2 / right 12, inside a 2 ring of the bar's colour.
  dot: { position: 'absolute', top: 0, right: 10, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  label: { fontSize: 12, lineHeight: 16 },
});
