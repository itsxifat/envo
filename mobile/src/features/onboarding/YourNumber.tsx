import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Check, Copy, PartyPopper } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatBdt, formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import { StepDots } from './StepDots';

/** The moment they get their number: shown big, ready to copy, with the one step left. */
export function YourNumberScreen() {
  const { colors } = useTheme();
  const { account, minActivation } = useSession();
  const [copied, setCopied] = useState(false);
  const number = account?.number ?? '';
  const groups = formatPhone(number).split(' ');

  return (
    <Screen
      scroll
      footer={
        <>
          <Button title={`Activate with ${formatBdt(minActivation)}`} onPress={() => router.push('/activate')} block />
          <Button title="I'll do it later" variant="ghost" onPress={() => router.replace('/')} block />
        </>
      }
    >
      <View style={{ marginTop: space.xl }}>
        <StepDots step={3} />
      </View>
      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.badge, { backgroundColor: colors.brandSoft }]}>
          <PartyPopper size={30} color={colors.brand} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(150)}>
          <Text variant="title" align="center">
            This is your number
          </Text>
        </Animated.View>
        <View style={styles.digits}>
          {groups.map((g, i) => (
            <Animated.View key={i} entering={FadeInDown.delay(300 + i * 160).springify().damping(14)}>
              <Text style={[styles.group, { color: i === 0 ? colors.textSecondary : colors.text }]}>{g}</Text>
            </Animated.View>
          ))}
        </View>
        <Animated.View entering={FadeInDown.delay(800)}>
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              await Clipboard.setStringAsync(number);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            style={({ pressed }) => [styles.copy, { backgroundColor: pressed ? colors.elementPressed : colors.element }]}
          >
            {copied ? <Check size={16} color={colors.call} /> : <Copy size={16} color={colors.text} />}
            <Text variant="label" tone={copied ? 'call' : 'default'}>
              {copied ? 'Copied' : 'Copy number'}
            </Text>
          </Pressable>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(950)} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="heading">One step left</Text>
          <Text tone="secondary" style={{ marginTop: 4 }}>
            Activate it with a first recharge of {formatBdt(minActivation)} or more. All of it becomes your calling balance. We then register the number in your
            name with ICC, usually within a few hours.
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.xl },
  badge: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  digits: { flexDirection: 'row', gap: 10, marginTop: space.sm },
  group: { fontFamily: fonts.bold, fontSize: 38, letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 40, borderRadius: radius.pill },
  card: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.lg, marginTop: space.md },
});
