import { many, tx } from '../db.js';
import { scheduleApply } from '../asterisk/apply.js';
import { getBillingSettings } from './settings.js';
import { invalidatePlans } from './plan.js';
import { createInvoice, reconcileOnlinePayments } from './invoices.js';
import { notifyInvoiceIssued, notifySuspended } from './notify.js';

const EVERY_MS = 60 * 60_000;

/**
 * The billing clock, run hourly:
 *  1. renewal invoices `renewal_notice_days` before a period ends (next package's price if a
 *     downgrade is scheduled);
 *  2. unpaid at period end: subscription past due, account keeps working for `grace_days`;
 *  3. still unpaid after the grace: account suspended (its SIP servers stop);
 *  4. cancelled at period end: subscription ends, account suspended;
 *  5. card payments whose browser never came back are settled from SSLCommerz.
 */
export async function runBillingClock(now = new Date()): Promise<{ invoiced: number; pastDue: number; suspended: number; ended: number; reconciled: number }> {
  const s = await getBillingSettings();
  const touched = new Set<number>();
  let invoiced = 0;

  const due = await many<{ id: number; account_id: number; current_period_end: Date; price: string; next_package_id: number | null; pkg_name: string; next_name: string | null; next_price: string | null }>(
    `SELECT s.id, s.account_id, s.current_period_end, s.price, s.next_package_id, p.name AS pkg_name, n.name AS next_name, n.price_monthly AS next_price
       FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id AND NOT a.internal AND a.status <> 'closed'
       JOIN packages p ON p.id = s.package_id
       LEFT JOIN packages n ON n.id = s.next_package_id
      WHERE s.status <> 'cancelled' AND NOT s.cancel_at_period_end
        AND s.current_period_end <= $1::timestamptz + make_interval(days => $2)
        -- Timestamps pass through JavaScript (millisecond precision), so compare within a second.
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.account_id = s.account_id AND i.kind = 'renewal' AND i.status <> 'void'
                          AND i.period_start BETWEEN s.current_period_end - interval '1 second' AND s.current_period_end + interval '1 second')`,
    [now, s.renewal_notice_days],
  );
  for (const sub of due) {
    // One customer's problem must not stop everyone else's billing.
    try {
      const created = await tx(async (db) => {
      const name = sub.next_name ?? sub.pkg_name;
      const amount = sub.next_package_id ? Number(sub.next_price ?? sub.price) : Number(sub.price);
      return createInvoice(db, {
        accountId: sub.account_id,
        kind: 'renewal',
        packageId: sub.next_package_id ?? null,
        amount,
        description: `${name} · renewal · 1 month`,
        periodStart: sub.current_period_end,
        dueAt: sub.current_period_end,
      });
      });
      notifyInvoiceIssued(created.id);
      invoiced++;
    } catch (err) {
      console.warn(`[billing] renewal invoice for account ${sub.account_id} failed:`, (err as Error).message);
    }
  }

  const pastDue = await many<{ account_id: number }>(
    `UPDATE subscriptions SET status = 'past_due', updated_at = now()
      WHERE status = 'active' AND NOT cancel_at_period_end AND current_period_end < $1
        AND account_id IN (SELECT id FROM accounts WHERE NOT internal)
      RETURNING account_id`,
    [now],
  );
  pastDue.forEach((r) => touched.add(r.account_id));

  const suspended = await many<{ id: number }>(
    `UPDATE accounts SET status = 'suspended', updated_at = now()
      WHERE status = 'active' AND NOT internal
        AND id IN (SELECT account_id FROM subscriptions WHERE status = 'past_due'
                    AND current_period_end < $1::timestamptz - make_interval(days => $2))
      RETURNING id`,
    [now, s.grace_days],
  );
  suspended.forEach((r) => {
    touched.add(r.id);
    notifySuspended(r.id);
  });

  const ended = await many<{ account_id: number }>(
    `UPDATE subscriptions SET status = 'cancelled', updated_at = now()
      WHERE status <> 'cancelled' AND cancel_at_period_end AND current_period_end < $1
      RETURNING account_id`,
    [now],
  );
  for (const r of ended) touched.add(r.account_id);
  if (ended.length) {
    await many("UPDATE accounts SET status = 'suspended', updated_at = now() WHERE id = ANY($1::int[]) AND status = 'active' AND NOT internal", [
      ended.map((r) => r.account_id),
    ]);
  }

  const reconciled = await reconcileOnlinePayments().catch(() => 0);

  if (touched.size || reconciled) {
    for (const id of touched) invalidatePlans(id);
    scheduleApply();
  }
  return { invoiced, pastDue: pastDue.length, suspended: suspended.length, ended: ended.length, reconciled };
}

export function startBillingClock(): void {
  const run = () =>
    void runBillingClock()
      .then((r) => {
        if (r.invoiced || r.pastDue || r.suspended || r.ended || r.reconciled) console.log('[billing]', JSON.stringify(r));
      })
      .catch((err) => console.warn('[billing] clock failed:', err));
  setTimeout(run, 30_000).unref();
  setInterval(run, EVERY_MS).unref();
}
