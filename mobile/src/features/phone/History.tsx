import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Plus, PhoneOutgoing, ReceiptText, Wallet, WifiOff, type LucideIcon } from 'lucide-react-native';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';
import { ListGroup } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { api, errorText } from '@/lib/api';
import { formatBdt, formatClock, formatDay, formatPhone, formatSigned } from '@/lib/format';
import { normalizeNumber, useContacts } from '@/state/contacts';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';

/** A line of the calling balance (GET /phone/balance): money in or out. Amounts come as text ("200.00"). */
interface Entry {
  id: number | string;
  kind: 'topup' | 'call' | 'adjustment';
  amount: number | string;
  note: string;
  created_at: string;
}

/** A recharge (GET /phone/recharges); in_review while support checks its payment. */
interface Recharge {
  id: number;
  amount: number | string;
  created_at: string;
  in_review: boolean;
}

/** Envo writes a call's charge as "Call to 01712345678, 2 min" (or "Free call to …"). */
function callNote(note: string): { free: boolean; number: string; minutes: number } | null {
  const m = /^(Free call|Call) to (\S+), (\d+) min$/.exec(note.trim());
  return m ? { free: m[1] === 'Free call', number: normalizeNumber(m[2]!), minutes: Number(m[3]) } : null;
}

/** What went on and came off the calling balance, by day; recharges still being checked come first. */
export function HistoryScreen() {
  const { colors } = useTheme();
  const { account } = useSession();
  const { nameOf } = useContacts();
  const [data, setData] = useState<{ entries: Entry[]; checking: Recharge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An answer that arrives after leaving the screen (or signing out) is dropped.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [balance, recharges] = await Promise.all([api.get<{ entries: Entry[] }>('/phone/balance'), api.get<Recharge[]>('/phone/recharges')]);
      if (!alive.current) return;
      setData({ entries: balance.entries, checking: recharges.filter((r) => r.in_review) });
      setError(null);
    } catch (err) {
      if (alive.current) setError(errorText(err));
      throw err;
    }
  }, []);

  // Again whenever the balance moves (a recharge confirmed, a call charged).
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load, account?.balance, account?.paymentInReview]);

  const days = useMemo(() => {
    const byDay = new Map<string, Entry[]>();
    for (const e of data?.entries ?? []) {
      const day = formatDay(e.created_at);
      const list = byDay.get(day);
      if (list) list.push(e);
      else byDay.set(day, [e]);
    }
    return [...byDay];
  }, [data]);

  let body: ReactNode;
  if (!data) {
    body = error ? (
      <EmptyState icon={WifiOff} tone="warning" title="Couldn't load your history" body={error} action={{ title: 'Try again', onPress: () => void load().catch(() => undefined) }} />
    ) : (
      <ActivityIndicator color={colors.brand} style={styles.loading} />
    );
  } else if (!data.entries.length && !data.checking.length) {
    body = <EmptyState icon={ReceiptText} title="Nothing here yet" body="Recharges and call charges show up here." />;
  } else {
    body = (
      <View style={styles.groups}>
        {data.checking.length > 0 && (
          <ListGroup title="Being checked">
            {data.checking.map((r) => (
              <Line
                key={`r${r.id}`}
                icon={Plus}
                title="Recharge"
                subtitle={`${formatDay(r.created_at)}, ${formatClock(r.created_at)}`}
                right={
                  <View style={styles.checking}>
                    <Text tone="secondary" style={styles.amount}>
                      {formatBdt(Number(r.amount))}
                    </Text>
                    <Badge label="Checking" tone="warning" />
                  </View>
                }
              />
            ))}
          </ListGroup>
        )}
        {days.map(([day, entries]) => (
          <ListGroup key={day} title={day}>
            {entries.map((e) => (
              <EntryLine key={e.id} entry={e} nameOf={nameOf} />
            ))}
          </ListGroup>
        ))}
      </View>
    );
  }

  return (
    <Screen back title="Balance history" scroll onRefresh={load}>
      {body}
    </Screen>
  );
}

function EntryLine({ entry, nameOf }: { entry: Entry; nameOf: (number: string) => string | null }) {
  const amount = Number(entry.amount);
  const when = formatClock(entry.created_at);
  const signed = <Amount value={amount} />;
  if (entry.kind === 'topup') return <Line icon={Plus} tone="call" title="Recharge" subtitle={when} right={signed} />;
  if (entry.kind === 'call') {
    const call = callNote(entry.note);
    if (!call) return <Line icon={PhoneOutgoing} title={entry.note || 'Call'} subtitle={when} right={signed} />;
    const who = nameOf(call.number) ?? formatPhone(call.number);
    return <Line icon={PhoneOutgoing} title={`${call.free ? 'Free call' : 'Call'} to ${who}`} subtitle={`${when} · ${call.minutes} min`} right={signed} />;
  }
  return <Line icon={Wallet} title={entry.note || 'Balance change by Enfinito'} subtitle={when} right={signed} />;
}

/** "+BDT 200" in green, "−BDT 0.80" in ink; a free call says so. */
function Amount({ value }: { value: number }) {
  return (
    <Text variant="bodyMedium" tone={value >= 0 ? 'call' : 'default'} style={styles.amount}>
      {value === 0 ? 'Free' : formatSigned(value)}
    </Text>
  );
}

/** One row; read out as a whole ("Recharge, 8:45 AM, +BDT 200"). */
function Line({ icon, tone = 'neutral', title, subtitle, right }: { icon: LucideIcon; tone?: IconTileTone; title: string; subtitle: string; right: ReactNode }) {
  return (
    <View accessible style={styles.row}>
      <IconTile icon={icon} size="sm" tone={tone} on="surface" />
      <View style={styles.text}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" tone="secondary" style={styles.tabular}>
          {subtitle}
        </Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 72 },
  groups: { gap: space.xl, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  text: { flex: 1, gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  amount: { fontVariant: ['tabular-nums'] },
  checking: { alignItems: 'flex-end', gap: 4 },
});
