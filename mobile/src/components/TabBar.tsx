import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CircleUserRound, Clock3, Grid3x3, UsersRound, type LucideIcon } from 'lucide-react-native';

import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius } from '@/theme/tokens';
import { Text } from './ui/Text';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ITEMS: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: 'Keypad', icon: Grid3x3 },
  recents: { label: 'Recents', icon: Clock3 },
  contacts: { label: 'Contacts', icon: UsersRound },
  account: { label: 'Account', icon: CircleUserRound },
};

/** A floating bar with the four places of the phone; a red dot on Recents for missed calls not yet seen. */
export function TabBar({ state, navigateToTab }: TabBarProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { recents, recentsSeenAt } = useSession();
  const since = Math.max(recentsSeenAt, Date.now() - 86_400_000);
  const missed = recents.some((r) => r.direction === 'missed' && new Date(r.at).getTime() > since);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={[styles.bar, { backgroundColor: colors.tabBar, borderColor: colors.border, shadowOpacity: dark ? 0 : 0.08 }]}>
        {state.routes.map((route, index) => {
          const item = ITEMS[route.name];
          if (!item) return null;
          const focused = state.index === index;
          const Icon = item.icon;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={item.label}
              onPress={() => {
                if (focused) return;
                void Haptics.selectionAsync();
                navigateToTab(route.key);
              }}
              style={styles.item}
            >
              <View style={[styles.iconWrap, focused && { backgroundColor: colors.brandSoft }]}>
                <Icon size={22} color={focused ? colors.brand : colors.textSecondary} strokeWidth={focused ? 2.4 : 2} />
                {route.name === 'recents' && missed && !focused && <View style={[styles.dot, { backgroundColor: colors.danger, borderColor: colors.tabBar }]} />}
              </View>
              <Text style={[styles.label, { color: focused ? colors.brand : colors.textSecondary, fontFamily: focused ? fonts.semibold : fonts.medium }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
  bar: {
    flexDirection: 'row',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  iconWrap: { width: 52, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 3, right: 12, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  label: { fontSize: 11.5 },
});
