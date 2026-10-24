import { useEffect } from 'react';
import { Text as Span, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { CircleCheck, Phone } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, space } from '@/theme/tokens';

/** Once, when the number starts working: it's ready, and the first call is one tap away. */
export function ReadyScreen() {
  const { colors } = useTheme();
  const { account, config } = useSession();
  const groups = account?.number ? formatPhone(account.number).split(' ') : [];
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <Screen
      footer={
        <>
          <Button
            title="Make your first call"
            variant="call"
            icon={Phone}
            block
            onPress={() => {
              router.back();
              router.navigate('/keypad');
            }}
          />
          <Button title="Later" variant="ghost" onPress={() => router.back()} block />
        </>
      }
    >
      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(11)}>
          <CircleCheck size={84} color={colors.call} strokeWidth={1.6} />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(200)} style={styles.text}>
          <Text variant="title" align="center" accessibilityRole="header">
            Your number is ready
          </Text>
          {groups.length > 0 && (
            <Text style={[styles.number, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={groups.join(' ')}>
              <Span style={{ color: colors.textSecondary }}>{groups[0]}</Span>
              {groups.length > 1 ? ` ${groups.slice(1).join(' ')}` : ''}
            </Text>
          )}
          <Text tone="secondary" align="center">
            {config?.free_onnet ? 'Call any phone in Bangladesh. Calls to Envo numbers are free.' : 'Call any phone in Bangladesh.'}
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingBottom: space.xxxl },
  text: { alignItems: 'center', gap: space.lg, alignSelf: 'stretch' },
  number: { fontFamily: fonts.semibold, fontSize: 36, lineHeight: 44, letterSpacing: 0.5, fontVariant: ['tabular-nums'], textAlign: 'center' },
});
