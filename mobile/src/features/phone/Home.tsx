import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { BellRing, CircleHelp, Clock3, Grid3x3, PhoneCall, Plus, ReceiptText, Share2, UsersRound, WifiOff, type LucideIcon } from 'lucide-react-native';

import { useCallGate } from '@/components/CallGate';
import { CallRow } from '@/components/CallRow';
import { useCallSheet } from '@/components/CallSheet';
import { useSupportSheet } from '@/components/SupportSheet';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconTile } from '@/components/ui/IconTile';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Notice } from '@/components/ui/Notice';
import { CardBalance, CardButton, CardText, NIGHT, NumberCard, type CardStatus } from '@/components/ui/NumberCard';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Steps, type Step } from '@/components/ui/Steps';
import { Text } from '@/components/ui/Text';
import { firstName, formatBdt, formatDate, formatPhone, greeting } from '@/lib/format';
import { holdLine, LOW_MINUTES, minutesFor } from '@/lib/stage';
import { KEYS } from '@/lib/storageKeys';
import { useCalls } from '@/state/calls';
import { useContacts } from '@/state/contacts';
import { outOfBalance, useSession, type Account } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, radius, space } from '@/theme/tokens';

/** One block of the page and the space above it. */
type Section = { key: string; gap: number; node: ReactNode };

const shareNumber = (number: string) => void Share.share({ message: `My Envo number: ${formatPhone(number)}` }).catch(() => undefined);

/**
 * The first screen of the phone: the person's number and balance, and the one thing to do next. While
 * the number isn't working yet it shows how far along it is instead.
 */
export function HomeScreen() {
  const { colors } = useTheme();
  const { account, config, offline, refresh, recents, recentsLoaded, lastRefreshedAt, minActivation } = useSession();
  const { allowed, people, ask, nameOf } = useContacts();
  const { dial } = useCalls();
  const gate = useCallGate();
  const support = useSupportSheet();
  const callSheet = useCallSheet();
  const reduce = useReducedMotion();
  // The sections slide in when the app opens, not each time one appears later.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 600);
    return () => clearTimeout(t);
  }, []);
  const now = useNow(30_000);
  useReadyMoment(account, recents.length, recentsLoaded);
  if (!account) return null;

  const free = !!config?.free_onnet;
  const min = formatBdt(minActivation);
  const sentOn = account.request?.createdAt ? formatDate(account.request.createdAt) : undefined;
  const checked = checkedText(lastRefreshedAt, now);
  const recharge = () => router.push('/recharge');
  const sections: Section[] = [];

  sections.push({
    key: 'header',
    gap: space.sm,
    node: (
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="caption" tone="secondary">
            {greeting(new Date(now))}
          </Text>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">
            {firstName(account.name) || 'Welcome'}
          </Text>
        </View>
        {support.available && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Help and support"
            hitSlop={2}
            onPress={support.open}
            style={({ pressed }) => [styles.help, { backgroundColor: pressed ? colors.elementPressed : colors.surface, borderColor: colors.border }]}
          >
            <CircleHelp size={20} color={colors.text} strokeWidth={iconStroke} />
          </Pressable>
        )}
      </View>
    ),
  });
  if (offline) {
    sections.push({
      key: 'offline',
      gap: space.sm,
      node: <Notice tone="warning" compact icon={WifiOff} title="No internet. Calls need a connection." action={{ label: 'Try again', onPress: () => void refresh().catch(() => undefined) }} />,
    });
  }
  if (account.closeRequested) {
    sections.push({
      key: 'closing',
      gap: space.sm,
      node: (
        <Notice
          tone="neutral"
          compact
          icon={Clock3}
          title="You asked to close your account. We'll be in touch."
          action={support.available ? { label: 'Changed your mind?', onPress: support.open } : undefined}
        />
      ),
    });
  }
  // Without a connection the pill says so, whatever the stage.
  const pill = (s: CardStatus | undefined): CardStatus | undefined => (offline ? { label: 'No internet', tone: 'alert' } : s);
  const checkedLine = checked ? (
    <Text variant="caption" tone="secondary">
      {checked}
    </Text>
  ) : null;

  if (account.stage === 'active') {
    const rate = config?.rate_per_min ?? 0;
    const empty = outOfBalance(account);
    const minutes = minutesFor(account.balance, rate);
    const low = !empty && minutes !== null && minutes < LOW_MINUTES;
    const note = empty
      ? account.balance < 0
        ? `${formatBdt(-account.balance)} used past zero comes off your next recharge.`
        : free
          ? 'Recharge to call other numbers. Calls to Envo numbers are still free.'
          : 'Recharge to call. You can still get calls.'
      : low
        ? minutes === 0
          ? 'Running low: less than a minute left'
          : `Running low: about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`
        : minutes !== null
          ? `About ${minutes.toLocaleString('en-US')} minutes to any phone${free ? ' · Envo numbers free' : ''}`
          : free
            ? 'Calls to Envo numbers are free'
            : undefined;
    sections.push({
      key: 'card',
      gap: space.lg,
      node: (
        <NumberCard number={account.number} status={pill(empty ? { label: free ? 'Envo calls only' : "Can't call out", tone: 'waiting' } : { label: 'Ready to call', tone: 'ready' })} share>
          <CardBalance
            amount={empty ? Math.max(0, account.balance) : account.balance}
            amountTone={empty ? 'warning' : 'default'}
            note={note}
            noteTone={low ? 'warning' : 'default'}
            action={empty ? <CardButton block title="Recharge to call" icon={Plus} onPress={recharge} /> : <CardButton title="Recharge" icon={Plus} onPress={recharge} />}
          />
        </NumberCard>
      ),
    });
    sections.push({
      key: 'actions',
      gap: space.lg,
      node: (
        <View style={styles.actions}>
          <QuickAction icon={Grid3x3} label="Keypad" onPress={() => router.navigate('/keypad')} />
          <QuickAction icon={Plus} label="Recharge" onPress={recharge} />
          <QuickAction icon={Share2} label="Share" onPress={() => account.number && shareNumber(account.number)} />
          <QuickAction icon={ReceiptText} label="History" onPress={() => router.push('/history')} />
        </View>
      ),
    });
    // Calls carry no names: the phone's contacts give them.
    const latest = recents.slice(0, 3).map((c) => (c.name ? c : { ...c, name: nameOf(c.number) }));
    // Until the list has come once, "no calls yet" may not be true.
    if (latest.length || recentsLoaded) sections.push({
      key: 'calls',
      gap: space.xxl,
      node: (
        <>
          <SectionHeader title="Recent calls" action={latest.length ? { label: 'See all', onPress: () => router.navigate('/recents') } : undefined} />
          {latest.length ? (
            <View style={styles.rows}>
              {latest.map((c) => (
                <CallRow key={c.id} item={c} time="when" onPress={() => callSheet.open(c)} onCall={() => gate.guard(() => dial(c.number, c.name), c.number)} />
              ))}
            </View>
          ) : (
            <Card style={styles.inline}>
              <IconTile icon={PhoneCall} tone="call" on="surface" />
              <View style={styles.flex}>
                <Text variant="bodyMedium">Make your first call</Text>
                <Text variant="caption" tone="secondary">
                  {free ? 'Calls to Envo numbers are free.' : 'Call any phone in Bangladesh.'}
                </Text>
              </View>
              <Button title="Open keypad" variant="secondary" size="sm" on="surface" onPress={() => router.navigate('/keypad')} />
            </Card>
          )}
        </>
      ),
    });
    const onEnvo = people.filter((p) => p.envo).slice(0, 10);
    if (free && allowed === true && onEnvo.length > 0) {
      sections.push({
        key: 'friends',
        gap: space.xxl,
        node: (
          <>
            <SectionHeader title="Free to call on Envo" action={{ label: 'All contacts', onPress: () => router.navigate('/contacts') }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.people}>
              {onEnvo.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${p.name}, free`}
                  onPress={() => gate.guard(() => dial(p.numbers[0]!, p.name), p.numbers[0])}
                  style={({ pressed }) => [styles.person, pressed && styles.personPressed]}
                >
                  <Avatar name={p.name} size={52} />
                  <Text variant="caption" numberOfLines={1} align="center">
                    {firstName(p.name)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ),
      });
    } else if (free && allowed === false) {
      sections.push({
        key: 'friends',
        gap: space.xxl,
        node: (
          <Card style={styles.inline}>
            <IconTile icon={UsersRound} tone="brand" on="surface" />
            <View style={styles.flex}>
              <Text variant="bodyMedium">See which friends are on Envo</Text>
              <Text variant="caption" tone="secondary">
                Calls to them are free. Your contacts stay on your phone.
              </Text>
            </View>
            <Button title="Allow" variant="secondary" size="sm" on="surface" onPress={() => void ask().catch(() => undefined)} />
          </Card>
        ),
      });
    }
  } else if (account.stage === 'activate') {
    const review = account.paymentInReview;
    const paused = !!config && !config.payment.online;
    const hold = holdLine(account, now);
    const holdText = hold ? <Text style={[styles.hold, { color: hold.urgent ? NIGHT.amber : NIGHT.muted }]}>{hold.text}</Text> : null;
    const activateText = <CardText>{`Activate it with a first recharge of ${min} or more. All of it becomes your calling balance.`}</CardText>;
    sections.push({
      key: 'card',
      gap: space.lg,
      node: (
        <NumberCard
          number={account.number}
          label="Your new number"
          placeholder="We're picking your number"
          status={pill(!account.number ? undefined : review ? { label: 'Checking payment', tone: 'waiting', pulse: true } : { label: 'Not active yet', tone: 'waiting' })}
        >
          {!account.number ? (
            <CardText>We'll email you when it's ready to activate.</CardText>
          ) : review ? (
            <View style={styles.reviewRow}>
              <Clock3 size={18} color={NIGHT.text} strokeWidth={iconStroke} style={styles.reviewIcon} />
              <View style={styles.flex}>
                <Text style={styles.reviewTitle}>We're checking your payment</Text>
                <CardText>Usually a few minutes. Nothing more to pay.</CardText>
              </View>
            </View>
          ) : paused ? (
            <>
              {activateText}
              <CardButton block disabled title="Payments are paused for now" />
              <View style={styles.afterButton}>
                <CardText>Please try again in a little while.</CardText>
              </View>
              {holdText}
            </>
          ) : (
            <>
              {activateText}
              <CardButton block title={`Activate with ${min}`} onPress={() => router.push('/activate')} />
              {holdText}
            </>
          )}
        </NumberCard>
      ),
    });
    if (review) {
      sections.push({
        key: 'checked',
        gap: space.md,
        node: (
          <View style={styles.checked}>
            {checkedLine}
            {support.available && (
              <Pressable accessibilityRole="button" onPress={support.open} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
                <Text variant="label" tone="brand">
                  Paid but it's taking long? Contact support
                </Text>
              </Pressable>
            )}
          </View>
        ),
      });
    }
    const steps: Step[] = [
      { title: 'Account created', state: 'done' },
      account.number ? { title: 'Details and photos sent', caption: sentOn, state: 'done' } : { title: "We're picking your number", state: 'working' },
      review
        ? { title: 'Checking your payment', caption: 'Usually a few minutes', state: 'working' }
        : { title: 'First recharge', caption: `${min} or more · bKash, Nagad, Rocket or card`, state: account.number ? 'now' : 'todo' },
      { title: 'We register it in your name', caption: 'Usually a few hours after you pay', state: 'todo' },
      { title: 'Start calling', state: 'todo' },
    ];
    sections.push({ key: 'steps', gap: space.lg, node: <Steps title="Getting your number" steps={steps} /> });
  } else if (account.stage === 'registering') {
    sections.push({
      key: 'card',
      gap: space.lg,
      node: (
        <NumberCard number={account.number} label="Your number" status={pill({ label: 'Being registered', tone: 'waiting', pulse: true })} share>
          <CardBalance amount={account.balance} note="Ready for your first call" />
        </NumberCard>
      ),
    });
    const steps: Step[] = [
      { title: 'Details sent', caption: sentOn, state: 'done' },
      { title: 'First recharge', caption: `${formatBdt(account.balance)} on your balance`, state: 'done' },
      { title: 'Registering in your name', caption: 'Usually a few hours. This page updates by itself.', state: 'working' },
      { title: 'Ready to call', caption: `We'll email ${account.email} too`, state: 'todo' },
    ];
    sections.push({ key: 'steps', gap: space.lg, node: <Steps steps={steps} /> });
    if (checkedLine) sections.push({ key: 'checked', gap: space.md, node: checkedLine });
    sections.push({
      key: 'wait',
      gap: space.xxl,
      node: (
        <ListGroup title="While you wait">
          {account.number ? <ListRow title="Share your number" left={<IconTile icon={Share2} size="sm" on="surface" />} onPress={() => shareNumber(account.number!)} /> : null}
          {free && allowed === false ? <ListRow title="See friends on Envo" left={<IconTile icon={UsersRound} size="sm" on="surface" />} onPress={() => void ask().catch(() => undefined)} /> : null}
          <ListRow title="Choose a ringtone" left={<IconTile icon={BellRing} size="sm" on="surface" />} chevron onPress={() => router.push('/ringtone')} />
        </ListGroup>
      ),
    });
  }

  const animate = intro && !reduce;
  return (
    <Screen scroll tabBar onRefresh={refresh}>
      {sections.map((s, i) => (
        <Animated.View key={s.key} entering={animate ? FadeInDown.duration(250).delay(i * 40) : undefined} style={{ marginTop: s.gap }}>
          {s.node}
        </Animated.View>
      ))}
      {support.sheet}
      {gate.sheet}
      {callSheet.sheet}
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? colors.elementPressed : colors.surface, borderColor: colors.border }, pressed && styles.tilePressed]}
    >
      <IconTile icon={icon} on="surface" />
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.tileLabel, { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Now, again every `ms`, for words like "Checked 2 min ago". */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function checkedText(at: number | null, now: number): string | null {
  if (!at) return null;
  const min = Math.floor((now - at) / 60_000);
  return min < 1 ? 'Checked just now' : min < 60 ? `Checked ${min} min ago` : 'Checked over an hour ago';
}

/**
 * The first time the number works, the "your number is ready" screen shows once. People who already
 * made calls (before this screen existed) never see it.
 */
function useReadyMoment(account: Account | null, calls: number, callsLoaded: boolean) {
  const checkedFor = useRef<string | null>(null);
  const number = account?.number ?? null;
  const active = account?.stage === 'active';
  useEffect(() => {
    if (!active || !number || !callsLoaded || calls > 0 || checkedFor.current === number) return;
    checkedFor.current = number;
    void (async () => {
      const key = KEYS.readySeen(number);
      if (await SecureStore.getItemAsync(key).catch(() => null)) return;
      await SecureStore.setItemAsync(key, '1').catch(() => undefined);
      router.push('/ready');
    })();
  }, [active, number, callsLoaded, calls]);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  help: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, minHeight: 84, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingVertical: space.md, paddingHorizontal: space.xs, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  tilePressed: { transform: [{ scale: 0.97 }] },
  tileLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 16 },
  // Rows keep their pressed shape but line up with the page edge.
  rows: { marginHorizontal: -space.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  bleed: { marginHorizontal: -space.xl, marginTop: space.xs },
  people: { paddingHorizontal: space.xl, gap: space.md },
  person: { width: 64, alignItems: 'center', gap: 6 },
  personPressed: { transform: [{ scale: 0.96 }] },
  hold: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: space.md },
  afterButton: { marginTop: space.md },
  reviewRow: { flexDirection: 'row', gap: space.md },
  reviewIcon: { marginTop: 1 },
  reviewTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: NIGHT.text, marginBottom: 2 },
  checked: { gap: 2 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
