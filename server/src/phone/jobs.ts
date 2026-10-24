import { many } from '../db.js';
import { closeRequest } from '../routes/numberRequests.js';
import { deleteCheckFrames } from '../supply/files.js';
import { chargeCalls } from './balance.js';

/** A reserved number waits this long for the first recharge, then goes back to the pool. */
const RESERVE_DAYS = 7;

/**
 * Envo Phone's clocks: calls are charged every minute. Hourly, selfies nobody sent on are deleted (a
 * registration takes them up to an hour old), and numbers reserved for people who never made the
 * first recharge go back to the pool; the person can send the registration again.
 */
export function startPhoneJobs(): void {
  const charge = () => void chargeCalls().catch((err) => console.warn('[phone] charging calls failed:', (err as Error).message));
  setTimeout(charge, 20_000).unref();
  setInterval(charge, 60_000).unref();

  const tidy = async () => {
    const old = await many<{ id: string }>("DELETE FROM selfie_checks WHERE used_at IS NOT NULL OR created_at < now() - interval '1 hour' RETURNING id");
    for (const c of old) await deleteCheckFrames(c.id);
    const unpaid = await many<{ id: number }>(
      `SELECT r.id FROM number_requests r JOIN accounts a ON a.id = r.account_id AND a.kind = 'personal'
        WHERE r.status IN ('submitted', 'in_review') AND r.created_at < now() - make_interval(days => $1)
          AND NOT EXISTS (SELECT 1 FROM topups t WHERE t.account_id = a.id AND t.status IN ('paid', 'applied'))
          -- Not while a payment is being checked, or one started lately may still come in.
          AND NOT EXISTS (SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.account_id = a.id
                           AND (p.status = 'pending_review' OR (p.status = 'initiated' AND p.created_at > now() - interval '3 days')))`,
      [RESERVE_DAYS],
    );
    for (const r of unpaid) {
      await closeRequest(r.id, '', [], {
        status: 'cancelled',
        reason: `Your number was released because the first recharge wasn't made within ${RESERVE_DAYS} days. Send your registration again to get a number.`,
      });
    }
    if (unpaid.length) console.log(`[phone] released ${unpaid.length} number(s) reserved without a first recharge`);
  };
  const runTidy = () => void tidy().catch((err) => console.warn('[phone] tidying up failed:', (err as Error).message));
  setTimeout(runTidy, 60_000).unref();
  setInterval(runTidy, 3600_000).unref();
}
