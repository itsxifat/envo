import type { Account } from '@/state/session';
import { formatDate } from './format';

/** How long a reserved number waits for the first recharge (RESERVE_DAYS in server/src/phone/jobs.ts). */
export const HOLD_DAYS = 7;

/** Below this many minutes of calling, the balance shows as running low. */
export const LOW_MINUTES = 10;

/**
 * How long the reserved number is kept for the first recharge: "We keep this number for you until
 * Fri 31 Oct.", "urgent" in its last two days. Null when nothing is held, or a payment is being checked.
 */
export function holdLine(account: Account | null | undefined, now = Date.now()): { text: string; urgent: boolean } | null {
  if (!account || account.stage !== 'activate' || !account.number || account.paymentInReview || !account.request?.createdAt) return null;
  const created = new Date(account.request.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const deadline = created + HOLD_DAYS * 86_400_000;
  const daysLeft = Math.ceil((deadline - now) / 86_400_000);
  const text =
    daysLeft > 2
      ? `We keep this number for you until ${formatDate(deadline, { weekday: true })}.`
      : daysLeft > 0
        ? `Only ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left to keep this number.`
        : 'Last day to keep this number.';
  return { text, urgent: daysLeft <= 2 };
}

/** About how many minutes of calling a balance buys; null when the rate isn't known. */
export function minutesFor(balance: number, rate: number): number | null {
  return rate > 0 ? Math.floor(balance / rate) : null;
}
