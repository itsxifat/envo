import type pg from 'pg';
import { exec, many, one } from '../db.js';
import { scheduleApply } from '../asterisk/apply.js';
import { getSupplySettings } from '../supply/settings.js';
import { getPhoneSettings } from './settings.js';

/*
 * The calling balance of personal accounts (Envo Phone), kept by Envo: paid recharges in, answered
 * calls to other networks out at the rate set in the admin, and support's corrections. The operator
 * keeps its own balance per number; support adds every paid recharge there too.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SQL: is the number in `col` (dialled as 0…, 880… or +880…) an Envo number, i.e. an IP number on
 * Envo from one of the providers Enfinito gets numbers from? `prefixes` names the parameter holding
 * their prefixes as LIKE patterns (envoPrefixes()).
 */
export const envoNumberSql = (col: string, prefixes: string) =>
  `EXISTS (SELECT 1 FROM numbers n WHERE n.number = regexp_replace(${col}, '^\\+?880', '0') AND n.number LIKE ANY(${prefixes}::text[]))`;

export async function envoPrefixes(): Promise<string[]> {
  return (await getSupplySettings()).providers.map((p) => `${p.prefix}%`);
}

export async function balanceOf(accountId: number): Promise<number> {
  const r = await one<{ total: string }>('SELECT COALESCE(sum(amount), 0) AS total FROM balance_ledger WHERE account_id = $1', [accountId]);
  return Number(r?.total ?? 0);
}

/**
 * A recharge was paid (inside the transaction that marks its invoice paid). For a personal account the
 * amount goes on the balance, and the first one activates the account: it goes on the Envo Phone
 * package, its SIP server starts working and support can register the number.
 */
export async function onTopupPaid(db: pg.PoolClient, invoiceId: number): Promise<void> {
  const t = (
    await db.query<{ id: number; account_id: number; amount: string; kind: string; status: string }>(
      'SELECT t.id, t.account_id, t.amount, a.kind, a.status FROM topups t JOIN accounts a ON a.id = t.account_id WHERE t.invoice_id = $1 FOR UPDATE OF a',
      [invoiceId],
    )
  ).rows[0];
  if (!t || t.kind !== 'personal') return;
  await db.query("INSERT INTO balance_ledger (account_id, kind, amount, topup_id, note) VALUES ($1, 'topup', $2, $3, 'Recharge') ON CONFLICT (topup_id) DO NOTHING", [
    t.account_id,
    t.amount,
    t.id,
  ]);
  if (t.status !== 'pending') return;
  const pkg = (await db.query<{ id: number }>("SELECT id FROM packages WHERE slug = 'phone'")).rows[0];
  if (!pkg) throw new Error('The Envo Phone package is missing');
  if (!(await db.query("SELECT 1 FROM subscriptions WHERE account_id = $1 AND status <> 'cancelled'", [t.account_id])).rowCount) {
    // No monthly fee: the billing clock renews free packages by itself.
    await db.query("INSERT INTO subscriptions (account_id, package_id, price, current_period_start, current_period_end) VALUES ($1, $2, 0, now(), now() + interval '1 month')", [
      t.account_id,
      pkg.id,
    ]);
  }
  await db.query("UPDATE accounts SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'pending'", [t.account_id]);
}

/**
 * Charges finished calls of personal accounts: each answered call out to another network, per started
 * minute at today's rate (calls to Envo numbers are free while that is on). The call's CDR id is
 * unique in the ledger, so a call is never charged twice. Returns how many calls were looked at.
 */
export async function chargeCalls(): Promise<number> {
  const s = await getPhoneSettings();
  const calls = await many<{ id: string; account_id: number; billsec: number; dst: string; onnet: boolean }>(
    `SELECT c.id, t.account_id, c.billsec, c.dst, ${envoNumberSql('c.dst', '$1')} AS onnet
       FROM cdr c
       JOIN tenants t ON c.accountcode = 't' || t.id
       JOIN accounts a ON a.id = t.account_id AND a.kind = 'personal'
      WHERE c.direction = 'outbound' AND c.disposition = 'ANSWERED' AND c.billsec > 0
        AND c.calldate > now() - interval '3 days'
        AND NOT EXISTS (SELECT 1 FROM balance_ledger l WHERE l.cdr_id = c.id)
      ORDER BY c.id LIMIT 500`,
    [await envoPrefixes()],
  );
  const charged = new Set<number>();
  for (const c of calls) {
    const free = s.free_onnet && c.onnet;
    if (!free) charged.add(c.account_id);
    const minutes = Math.ceil(c.billsec / 60);
    await exec("INSERT INTO balance_ledger (account_id, kind, amount, cdr_id, note) VALUES ($1, 'call', $2, $3, $4) ON CONFLICT (cdr_id) DO NOTHING", [
      c.account_id,
      free ? 0 : -round2(minutes * s.rate_per_min),
      c.id,
      `${free ? 'Free call' : 'Call'} to ${c.dst}, ${minutes} min`,
    ]);
  }
  // Someone's balance ran out: their calls out stop (asterisk/model.ts leaves out their routes).
  if (charged.size && (await one('SELECT 1 FROM balance_ledger WHERE account_id = ANY($1::int[]) GROUP BY account_id HAVING sum(amount) <= 0 LIMIT 1', [[...charged]]))) scheduleApply();
  return calls.length;
}

/** Support corrects a balance (a refund, a goodwill credit, a missed charge). */
export async function adjustBalance(accountId: number, amount: number, note: string, by: number): Promise<void> {
  await exec("INSERT INTO balance_ledger (account_id, kind, amount, note, created_by) VALUES ($1, 'adjustment', $2, $3, $4)", [accountId, round2(amount), note, by]);
  // Calls out may stop or start again.
  scheduleApply();
}
