import { config } from '../config.js';
import { exec, many, one } from '../db.js';
import { CrmError, crmCall, crmEnabled, crmHost, forgetPolicy, refreshPolicy } from './crm.js';

/**
 * Keeps the CRM in step with Envo's invoices. Triggers (migration 009) mark every changed invoice; this
 * worker pushes the whole state of what is marked, in batches, so a peak never holds a customer up: they
 * get their invoice and pay in Envo while the CRM catches up behind them. Pushing state instead of events
 * means a retry, a timeout or a CRM restart cannot lose or double anything: the CRM just makes itself match
 * (and its unique indexes hold even if that goes wrong).
 */

const BATCH = 50;
const PASS_EVERY_MS = 3_000;
const POLICY_EVERY_MS = 60_000;
const RECONCILE_EVERY_MS = 6 * 60 * 60_000;
const RECONCILE_PAGE = 500;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 15 * 60_000;
const REVIEW_RETRY_MS = 15 * 60_000;
const REJECTED_RETRY_MS = 60 * 60_000;
const TARGET_KEY = 'crm_target';
const RECONCILE_KEY = 'crm_reconcile';

/** Envo's own account is never billed; free invoices move no money; go-live counts whichever came last. */
const ELIGIBLE = `NOT a.internal AND i.amount > 0 AND ($1::timestamptz IS NULL OR i.created_at >= $1::timestamptz OR COALESCE(i.paid_at >= $1::timestamptz, false))`;
const syncFrom = () => config.crm.syncFrom;

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);
const EXPECTED_STATUS: Record<string, string> = { unpaid: 'DRAFT', paid: 'PAID', void: 'CANCELLED' };

function retryDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(attempts, 12));
}

interface QueueRow {
  id: number;
  number: string;
  account_id: number;
  description: string;
  amount: string;
  subtotal: string;
  vat_treatment: string;
  vat_rate: string;
  sd_rate: string;
  vat_amount: string;
  sd_amount: string;
  service_code: string | null;
  tax_policy_version: string | null;
  status: string;
  due_at: Date;
  paid_at: Date | null;
  created_at: Date;
  crm_version: number;
  crm_attempts: number;
  account_name: string;
  account_email: string;
  account_phone: string;
  account_address: string;
  verified_email: string | null;
}

interface PaymentRow {
  id: number;
  invoice_id: number;
  method: string;
  status: string;
  amount: string;
  channel: string;
  reference: string;
  tran_id: string | null;
  bank_tran_id: string | null;
  card_type: string | null;
  store_amount: string | null;
  livemode: string | null;
  paid_at: string | null;
  updated_at: Date;
}

interface CrmView {
  invoiceId: string;
  number: string;
  status: string;
  total: number;
  vatAmount: number;
  sdAmount: number;
  paidAmount: number;
  /** What the books hold after refunds and credit notes: must equal what Envo received. */
  received: number;
  issuedAt: string | null;
  clientCode: string | null;
  seller: unknown;
  buyer: unknown;
}

interface SyncResult {
  id: number;
  version: number;
  status: 'ok' | 'review' | 'rejected' | 'retry';
  code?: string;
  message?: string;
  crm?: CrmView | null;
}

async function loadQueue(limit: number): Promise<QueueRow[]> {
  return many<QueueRow>(
    `SELECT i.id, i.number, i.account_id, i.description, i.amount, i.subtotal, i.vat_treatment, i.vat_rate, i.sd_rate, i.vat_amount, i.sd_amount,
            i.service_code, i.tax_policy_version, i.status, i.due_at, i.paid_at, i.created_at, i.crm_version, i.crm_attempts,
            a.name AS account_name, a.email AS account_email, a.phone AS account_phone, a.address AS account_address,
            (SELECT u.email FROM users u WHERE u.account_id = a.id AND u.is_owner AND u.email_verified_at IS NOT NULL ORDER BY u.id LIMIT 1) AS verified_email
       FROM invoices i JOIN accounts a ON a.id = i.account_id
      WHERE i.crm_version > i.crm_synced_version AND i.crm_next_attempt_at <= now() AND ${ELIGIBLE}
      ORDER BY i.crm_next_attempt_at, i.id LIMIT $2`,
    [syncFrom(), limit],
  );
}

/** The whole state of each invoice, read after the change committed. */
async function buildDocs(rows: QueueRow[]): Promise<Record<string, unknown>[]> {
  const payments = await many<PaymentRow>(
    `SELECT id, invoice_id, method, status, amount, channel, reference, tran_id, bank_tran_id, card_type,
            raw -> 'validation' ->> 'store_amount' AS store_amount,
            COALESCE(raw -> 'checkout' ->> 'livemode', raw ->> 'livemode') AS livemode,
            raw -> 'checkout' -> 'payment' ->> 'paid_at' AS paid_at, updated_at
       FROM payments WHERE invoice_id = ANY($1::int[]) AND status IN ('succeeded', 'refunded') ORDER BY id`,
    [rows.map((r) => r.id)],
  );
  const byInvoice = new Map<number, PaymentRow[]>();
  for (const p of payments) byInvoice.set(p.invoice_id, [...(byInvoice.get(p.invoice_id) ?? []), p]);

  return rows.map((r) => {
    const subtotal = Number(r.subtotal);
    return {
      id: r.id,
      version: r.crm_version,
      number: r.number,
      status: r.status,
      createdAt: r.created_at,
      dueAt: r.due_at,
      paidAt: r.paid_at,
      currency: 'BDT',
      vatTreatment: r.vat_treatment,
      serviceCode: r.service_code,
      policyVersion: r.tax_policy_version,
      items: [{ description: r.description.slice(0, 300), quantity: 1, rate: subtotal, vatRate: Number(r.vat_rate), sdRate: Number(r.sd_rate) }],
      totals: { subtotal, taxableValue: subtotal, sdAmount: Number(r.sd_amount), vatAmount: Number(r.vat_amount), total: Number(r.amount) },
      customer: { id: r.account_id, name: (r.account_name.trim() || r.account_email).slice(0, 200), email: r.account_email, verifiedEmail: r.verified_email, phone: r.account_phone, address: r.account_address.slice(0, 500) },
      payments: (byInvoice.get(r.id) ?? []).map((p) => {
        const store = p.store_amount === null ? NaN : Number(p.store_amount);
        const fee = Number.isFinite(store) && store > 0 && store <= Number(p.amount) ? (cents(p.amount) - cents(store)) / 100 : null;
        return {
          id: p.id,
          method: p.method,
          status: p.status,
          livemode: p.livemode === null ? null : p.livemode === 'true',
          amount: Number(p.amount),
          paidAt: p.paid_at ?? p.updated_at,
          channel: p.channel,
          reference: p.reference,
          tranId: p.tran_id,
          bankTranId: p.bank_tran_id,
          cardType: p.card_type,
          gatewayFee: fee,
        };
      }),
    };
  });
}

/** What the CRM answered must be what Envo has, down to the paisa. */
function crmDiffers(row: QueueRow, paid: number, crm: CrmView | null | undefined): string | null {
  // Refunded before it was ever issued: nothing was billed, so it stays a draft.
  const neverIssued = row.status === 'paid' && crm?.status === 'DRAFT' && !(paid > 0);
  if (!crm) return row.status === 'void' ? null : 'The CRM did not report the invoice back';
  if (crm.number !== row.number) return `The CRM has it as ${crm.number}`;
  if (cents(crm.total) !== cents(row.amount)) return `Total is ${crm.total} in the CRM, ${row.amount} here`;
  if (cents(crm.vatAmount) !== cents(row.vat_amount)) return `VAT is ${crm.vatAmount} in the CRM, ${row.vat_amount} here`;
  if (cents(crm.sdAmount) !== cents(row.sd_amount)) return `SD is ${crm.sdAmount} in the CRM, ${row.sd_amount} here`;
  if (!neverIssued && crm.status !== EXPECTED_STATUS[row.status]) return `${crm.status} in the CRM, ${row.status} here`;
  if (row.status === 'paid' && cents(crm.received) !== cents(paid)) return `${crm.received} received in the CRM, ${paid} here`;
  return null;
}

async function recordResult(row: QueueRow, r: SyncResult, paid: number): Promise<void> {
  if (r.status === 'ok' || r.status === 'review') {
    const differs = r.status === 'ok' ? crmDiffers(row, paid, r.crm) : null;
    const snapshot = r.crm ? JSON.stringify({ clientCode: r.crm.clientCode, seller: r.crm.seller, buyer: r.crm.buyer, issuedAt: r.crm.issuedAt, status: r.crm.status }) : null;
    if (r.status === 'review') {
      // Not done: stays queued, so it completes by itself once finance has fixed the cause.
      await exec(
        `UPDATE invoices SET crm_state = CASE WHEN crm_version = $2 THEN 'review' ELSE crm_state END, crm_code = $3, crm_error = $4,
           crm_next_attempt_at = CASE WHEN crm_version = $2 THEN now() + make_interval(secs => $5) ELSE crm_next_attempt_at END,
           crm_invoice_id = COALESCE($6, crm_invoice_id), crm_snapshot = COALESCE($7::jsonb, crm_snapshot)
         WHERE id = $1`,
        [row.id, row.crm_version, r.code ?? null, r.message ?? null, REVIEW_RETRY_MS / 1000, r.crm?.invoiceId ?? null, snapshot],
      );
      return;
    }
    await exec(
      `UPDATE invoices SET crm_synced_version = GREATEST(crm_synced_version, $2),
         crm_state = CASE WHEN crm_version > $2 THEN 'pending' WHEN $3::text IS NULL THEN 'synced' ELSE 'mismatch' END,
         crm_code = CASE WHEN $3::text IS NULL THEN NULL ELSE 'MISMATCH' END, crm_error = $3::text, crm_attempts = 0, crm_synced_at = now(),
         crm_invoice_id = COALESCE($4, crm_invoice_id), crm_snapshot = COALESCE($5::jsonb, crm_snapshot)
       WHERE id = $1`,
      [row.id, row.crm_version, differs, r.crm?.invoiceId ?? null, snapshot],
    );
    if (differs) console.warn(`[crm] invoice ${row.number} differs: ${differs}`);
    return;
  }
  if (r.status === 'rejected') {
    // Fixable on the CRM's side (settings, a corrected value), so it is tried again now and then.
    await exec(
      `UPDATE invoices SET crm_state = 'rejected', crm_code = $3, crm_error = $4, crm_next_attempt_at = now() + make_interval(secs => $5)
        WHERE id = $1 AND crm_version = $2`,
      [row.id, row.crm_version, r.code ?? null, r.message ?? null, REJECTED_RETRY_MS / 1000],
    );
    console.warn(`[crm] invoice ${row.number} refused: ${r.code} ${r.message}`);
    return;
  }
  await backOff([row], r.message ?? 'Try again');
}

async function backOff(rows: QueueRow[], message: string): Promise<void> {
  for (const row of rows) {
    await exec(
      `UPDATE invoices SET crm_attempts = crm_attempts + 1, crm_error = $3, crm_next_attempt_at = now() + make_interval(secs => $4)
        WHERE id = $1 AND crm_version = $2`,
      [row.id, row.crm_version, message.slice(0, 500), retryDelay(row.crm_attempts) / 1000],
    );
  }
}

let lastTransportError: string | null = null;
let policyVersionSeen: string | null = null;

/** Invoices backing off (not the ones finance has to deal with) go on the next pass. */
export function wakeWaiting(): Promise<number> {
  return exec(`UPDATE invoices SET crm_next_attempt_at = now() WHERE crm_version > crm_synced_version AND crm_state = 'pending' AND crm_next_attempt_at > now()`);
}

/** Invoices that aren't for the CRM leave the queue; a change to one (it gets paid) brings it back. */
async function skipIneligible(): Promise<number> {
  return exec(
    `UPDATE invoices i SET crm_synced_version = i.crm_version, crm_state = 'skipped' FROM accounts a
      WHERE a.id = i.account_id AND i.crm_version > i.crm_synced_version AND NOT (${ELIGIBLE})`,
    [syncFrom()],
  );
}

/** Sends what is queued, batch after batch, until nothing is due. */
export async function runCrmPass(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (;;) {
    const rows = await loadQueue(BATCH);
    if (!rows.length) break;
    const docs = await buildDocs(rows);
    let answer: { results: SyncResult[]; policyVersion?: string };
    try {
      answer = await crmCall<{ results: SyncResult[]; policyVersion?: string }>({ type: 'invoices.sync', items: docs });
      if (lastTransportError) {
        const n = await wakeWaiting();
        console.log(`[crm] connection back, ${n} waiting invoices go now`);
      }
      lastTransportError = null;
    } catch (err) {
      const e = err as CrmError;
      if (e.message !== lastTransportError) console.warn(`[crm] ${e.message}; invoices wait and go later`);
      lastTransportError = e.message;
      await backOff(rows, e.message);
      failed += rows.length;
      break;
    }
    const paidById = new Map(docs.map((d) => [d.id as number, (d.payments as { amount: number; status: string }[]).filter((p) => p.status === 'succeeded').reduce((s, p) => s + cents(p.amount), 0) / 100]));
    const rowById = new Map(rows.map((r) => [r.id, r]));
    await Promise.all(
      answer.results.map((r) => {
        const row = rowById.get(r.id);
        if (!row) return undefined;
        if (r.status === 'ok') sent++;
        else failed++;
        return recordResult(row, r, paidById.get(r.id) ?? 0);
      }),
    );
    if (answer.policyVersion && answer.policyVersion !== policyVersionSeen) {
      policyVersionSeen = answer.policyVersion;
      await refreshPolicy().catch(() => undefined);
    }
    if (rows.length < BATCH) break;
  }
  return { sent, failed };
}

// ------------------------------------------------------------------------------------- comparison
export interface ReconcileReport {
  at: string;
  target: string | null;
  envo: { count: number; total: number; vat: number; paid: number };
  crm: { count: number; total: number; vat: number; paid: number };
  pending: number;
  diffCount: number;
  diffs: { id: number; number: string; code: string; detail: string }[];
  resent: number;
}

const MAX_DIFFS_KEPT = 100;
/** A fresh push can settle these; anything else needs a person. */
const RESEND = new Set(['MISSING_IN_CRM', 'STATUS_DIFFERS', 'PAID_DIFFERS']);

/** Compares every invoice with the CRM, both ways, page by page. Pushes again what a push can fix. */
export async function reconcileWithCrm(): Promise<ReconcileReport> {
  const totals = { envo: { count: 0, total: 0, vat: 0, paid: 0 }, crm: { count: 0, total: 0, vat: 0, paid: 0 } };
  const diffs: ReconcileReport['diffs'] = [];
  let diffCount = 0;
  let pending = 0;
  let resent = 0;
  let cursor = 0;
  for (;;) {
    const rows = await many<{ id: number; number: string; status: string; amount: string; vat_amount: string; sd_amount: string; paid: string; in_flight: boolean }>(
      `SELECT i.id, i.number, i.status, i.amount, i.vat_amount, i.sd_amount, i.crm_version > i.crm_synced_version AS in_flight,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'succeeded'), 0) AS paid
         FROM invoices i JOIN accounts a ON a.id = i.account_id
        WHERE ${ELIGIBLE} AND i.id > $2 ORDER BY i.id LIMIT $3`,
      [syncFrom(), cursor, RECONCILE_PAGE],
    );
    const last = rows.length < RECONCILE_PAGE;
    const toId = last ? 2_147_483_647 : rows[rows.length - 1]!.id;
    const page = await crmCall<{ diffs: ReconcileReport['diffs']; crm: ReconcileReport['crm'] }>({
      type: 'reconcile.page',
      fromId: cursor,
      toId,
      items: rows.map((r) => ({ id: r.id, number: r.number, status: r.status, total: Number(r.amount), vat: Number(r.vat_amount), sd: Number(r.sd_amount), paid: Number(r.paid) })),
    });
    const inFlight = new Set(rows.filter((r) => r.in_flight).map((r) => r.id));
    pending += inFlight.size;
    for (const r of rows) {
      if (r.status === 'void') continue;
      totals.envo.count++;
      totals.envo.total += cents(r.amount);
      totals.envo.vat += cents(r.vat_amount);
      totals.envo.paid += cents(r.paid);
    }
    totals.crm.count += page.crm.count;
    totals.crm.total += cents(page.crm.total);
    totals.crm.vat += cents(page.crm.vat);
    totals.crm.paid += cents(page.crm.paid);
    for (const d of page.diffs) {
      // Still on its way: not a difference yet.
      if (inFlight.has(d.id)) continue;
      diffCount++;
      if (diffs.length < MAX_DIFFS_KEPT) diffs.push(d);
      if (RESEND.has(d.code)) {
        resent += await exec(
          `UPDATE invoices SET crm_version = crm_version + 1, crm_state = 'pending', crm_attempts = 0, crm_next_attempt_at = now() WHERE id = $1`,
          [d.id],
        );
      }
    }
    if (last) break;
    cursor = toId;
  }
  const toMoney = (t: { count: number; total: number; vat: number; paid: number }) => ({ count: t.count, total: t.total / 100, vat: t.vat / 100, paid: t.paid / 100 });
  const report: ReconcileReport = { at: new Date().toISOString(), target: crmHost(), envo: toMoney(totals.envo), crm: toMoney(totals.crm), pending, diffCount, diffs, resent };
  await exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [RECONCILE_KEY, JSON.stringify(report)],
  );
  await crmCall({ type: 'reconcile.report', report }).catch(() => undefined);
  if (diffCount) console.warn(`[crm] comparison found ${diffCount} difference(s), pushed ${resent} again`);
  else console.log(`[crm] comparison: ${report.envo.count} invoices agree (${pending} on their way)`);
  return report;
}

// ---------------------------------------------------------------------------------- admin screen
export async function crmStatus() {
  if (!crmEnabled()) return { enabled: false, target: null };
  const [states, problems, reconcile, policy] = await Promise.all([
    many<{ crm_state: string; count: number; oldest: Date | null }>(
      `SELECT i.crm_state, count(*) AS count, min(i.crm_next_attempt_at) AS oldest
         FROM invoices i JOIN accounts a ON a.id = i.account_id WHERE ${ELIGIBLE} GROUP BY i.crm_state`,
      [syncFrom()],
    ),
    many(
      `SELECT i.id, i.number, i.status, i.amount, i.crm_state, i.crm_code, i.crm_error, i.crm_next_attempt_at, a.name AS account_name
         FROM invoices i JOIN accounts a ON a.id = i.account_id
        WHERE ${ELIGIBLE} AND (i.crm_state IN ('review', 'rejected', 'mismatch') OR (i.crm_state = 'pending' AND i.crm_attempts > 0))
        ORDER BY i.id DESC LIMIT 30`,
      [syncFrom()],
    ),
    one<{ value: ReconcileReport }>('SELECT value FROM settings WHERE key = $1', [RECONCILE_KEY]),
    one<{ value: unknown }>("SELECT value FROM settings WHERE key = 'crm_policy'"),
  ]);
  return {
    enabled: true,
    target: crmHost(),
    connection_error: lastTransportError,
    sync_from: syncFrom(),
    counts: Object.fromEntries(states.map((s) => [s.crm_state, s.count])),
    problems,
    reconcile: reconcile?.value ?? null,
    policy: policy?.value ?? null,
  };
}

export async function resendInvoice(id: number): Promise<number> {
  return exec(`UPDATE invoices SET crm_version = crm_version + 1, crm_state = 'pending', crm_attempts = 0, crm_next_attempt_at = now() WHERE id = $1`, [id]);
}

// ----------------------------------------------------------------------------------------- clock
/**
 * Moving to another CRM (demo to live): that CRM has none of this, so everything is queued for it. Numbers
 * and amounts stay what they are; CRM_SYNC_FROM keeps invoices from before go-live out of the new books.
 */
async function followTarget(): Promise<void> {
  const target = crmHost();
  const from = syncFrom();
  const row = await one<{ value: { host: string; from?: string | null } }>('SELECT value FROM settings WHERE key = $1', [TARGET_KEY]);
  const moved = !!row?.value?.host && row.value.host !== target;
  if (row?.value?.host === target && (row.value.from ?? null) === from) return;
  if (moved || row?.value?.host) {
    const n = await exec(`UPDATE invoices SET crm_synced_version = 0, crm_state = 'pending', crm_attempts = 0, crm_next_attempt_at = now(), crm_invoice_id = NULL, crm_snapshot = NULL, crm_code = NULL, crm_error = NULL`);
    console.log(moved ? `[crm] now connected to ${target} instead of ${row!.value.host}: ${n} invoices queued for it` : `[crm] go-live date changed: ${n} invoices looked at again`);
  }
  // Its rules, not the last CRM's: nothing is billed under them until it has answered.
  if (moved) await forgetPolicy();
  await exec(`DELETE FROM settings WHERE key = $1`, [RECONCILE_KEY]);
  await exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TARGET_KEY, JSON.stringify({ host: target, from })],
  );
}

/** Awaited before the server listens: no invoice may be priced before a move to another CRM is seen. */
export async function startCrmSync(): Promise<void> {
  if (!crmEnabled()) {
    console.log('[crm] not connected (CRM_BASE_URL / CRM_API_SECRET not set)');
    return;
  }
  await followTarget().catch((err) => console.warn('[crm] could not check the connection settings:', (err as Error).message));
  let busy = false;
  const pass = () => {
    if (busy) return;
    busy = true;
    void runCrmPass()
      .catch((err) => console.warn('[crm] pass failed:', (err as Error).message))
      .finally(() => {
        busy = false;
      });
  };
  const policy = () => void refreshPolicy().catch((err) => console.warn('[crm] tax settings not refreshed:', (err as Error).message));
  const compare = () => void skipIneligible().then(() => reconcileWithCrm()).catch((err) => console.warn('[crm] comparison failed:', (err as Error).message));

  void skipIneligible()
    .then(() => refreshPolicy())
    .then((p) => console.log(`[crm] connected to ${crmHost()}: ${p?.vatTreatment} ${p?.vatRate}% VAT, ${p?.pricesIncludeVat ? 'inside' : 'on top of'} prices`))
    .catch((err) => console.warn('[crm] not reachable yet:', (err as Error).message))
    .finally(() => {
      setInterval(pass, PASS_EVERY_MS).unref();
      setInterval(policy, POLICY_EVERY_MS).unref();
      setInterval(compare, RECONCILE_EVERY_MS).unref();
      setTimeout(compare, 2 * 60_000).unref();
      pass();
    });
}
