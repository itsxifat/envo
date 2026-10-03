import crypto from 'node:crypto';
import type pg from 'pg';
import { many, one, tx } from '../db.js';
import { config } from '../config.js';
import { HttpError, badRequest, notFound } from '../lib/http.js';
import { scheduleApply } from '../asterisk/apply.js';
import { getUsage, invalidatePlans } from './plan.js';
import { createSession, queryTransaction, validate, type Validation } from './sslcommerz.js';

export type InvoiceKind = 'subscription' | 'renewal' | 'upgrade' | 'manual';

export interface Invoice {
  id: number;
  number: string;
  account_id: number;
  kind: InvoiceKind;
  package_id: number | null;
  months: number;
  description: string;
  amount: string;
  currency: string;
  status: 'unpaid' | 'paid' | 'void';
  due_at: string;
  paid_at: string | null;
  period_start: string | null;
  created_at: string;
}

export interface Payment {
  id: number;
  invoice_id: number;
  account_id: number;
  method: 'sslcommerz' | 'manual';
  status: 'initiated' | 'pending_review' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
  amount: string;
  tran_id: string | null;
}

interface PackageRow {
  id: number;
  name: string;
  price_monthly: string | null;
  active: boolean;
  public: boolean;
  max_servers: number | null;
  max_dids: number | null;
  max_extensions: number | null;
  max_ivrs: number | null;
}

interface SubRow {
  id: number;
  package_id: number;
  price: string;
  current_period_start: Date;
  current_period_end: Date;
  next_package_id: number | null;
}

type Db = pg.PoolClient;

export const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(db: Db): Promise<string> {
  const { rows } = await db.query<{ n: string }>("SELECT nextval('invoice_number_seq') AS n");
  return `INV-${new Date().getFullYear()}-${String(rows[0]!.n).padStart(6, '0')}`;
}

export async function createInvoice(
  db: Db,
  args: { accountId: number; kind: InvoiceKind; packageId?: number | null; months?: number; amount: number; description: string; dueAt?: Date; periodStart?: Date | null; createdBy?: number | null },
): Promise<Invoice> {
  const { rows } = await db.query<Invoice>(
    `INSERT INTO invoices (number, account_id, kind, package_id, months, description, amount, due_at, period_start, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [await nextNumber(db), args.accountId, args.kind, args.packageId ?? null, args.months ?? 1, args.description, round2(args.amount), args.dueAt ?? new Date(), args.periodStart ?? null, args.createdBy ?? null],
  );
  return rows[0]!;
}

const monthsLabel = (m: number) => `${m} month${m === 1 ? '' : 's'}`;

/** What a downgrade would leave over the new package's limits (empty = it fits). */
async function overLimits(accountId: number, pkg: PackageRow): Promise<string[]> {
  const u = await getUsage(accountId);
  const out: string[] = [];
  const check = (used: number, limit: number | null, what: string) => {
    if (limit !== null && used > limit) out.push(`${used - limit} ${what}`);
  };
  check(u.servers, pkg.max_servers, 'SIP server(s)');
  check(u.dids, pkg.max_dids, 'phone number(s)');
  check(u.extensions, pkg.max_extensions, 'extension(s)');
  check(u.ivrs, pkg.max_ivrs, 'IVR menu(s)');
  return out;
}

export type CheckoutResult =
  | { action: 'invoice'; invoice: Invoice }
  | { action: 'scheduled'; message: string }
  | { action: 'applied'; message: string };

/**
 * A customer asks for a package. No package yet: invoice for it. Same package: renewal invoice.
 * Bigger: invoice for the prorated difference, switched on payment. Smaller: switched at renewal.
 */
export async function checkout(accountId: number, packageId: number, months: number, userId: number): Promise<CheckoutResult> {
  const pkg = await one<PackageRow>('SELECT * FROM packages WHERE id = $1', [packageId]);
  if (!pkg || !pkg.active) throw badRequest('This package is not available');
  if (pkg.price_monthly === null) throw badRequest('This package has custom pricing: contact us and we set it up for you');
  const price = Number(pkg.price_monthly);
  const result = await tx(async (db): Promise<CheckoutResult> => {
    const sub = (
      await db.query<SubRow>("SELECT * FROM subscriptions WHERE account_id = $1 AND status <> 'cancelled' FOR UPDATE", [accountId])
    ).rows[0];
    if (!sub && !pkg.public) throw badRequest('This package is not available');
    // A new order replaces older unpaid orders (not renewals).
    const voidOpen = () =>
      db.query("UPDATE invoices SET status = 'void', updated_at = now() WHERE account_id = $1 AND status = 'unpaid' AND kind IN ('subscription', 'upgrade')", [accountId]);

    if (!sub) {
      await voidOpen();
      const invoice = await createInvoice(db, { accountId, kind: 'subscription', packageId, months, amount: price * months, description: `${pkg.name} · ${monthsLabel(months)}`, createdBy: userId });
      return { action: 'invoice', invoice };
    }

    if (sub.package_id === packageId) {
      const open = (
        await db.query<Invoice>(
          `SELECT * FROM invoices WHERE account_id = $1 AND kind = 'renewal' AND status <> 'void'
             AND period_start BETWEEN $2::timestamptz - interval '1 second' AND $2::timestamptz + interval '1 second' ORDER BY id DESC LIMIT 1`,
          [accountId, sub.current_period_end],
        )
      ).rows[0];
      if (open?.status === 'paid') throw badRequest('This period is already paid; you can renew again once the next renewal invoice is issued');
      if (open) return { action: 'invoice', invoice: open };
      const invoice = await createInvoice(db, {
        accountId,
        kind: 'renewal',
        packageId,
        months,
        amount: Number(sub.price) * months,
        description: `${pkg.name} · renewal · ${monthsLabel(months)}`,
        periodStart: sub.current_period_end,
        dueAt: sub.current_period_end,
        createdBy: userId,
      });
      return { action: 'invoice', invoice };
    }

    const current = Number(sub.price);
    if (price > current) {
      const start = sub.current_period_start.getTime();
      const end = sub.current_period_end.getTime();
      const remaining = end > Date.now() && end > start ? (end - Date.now()) / (end - start) : 0;
      const amount = round2((price - current) * remaining);
      await voidOpen();
      if (amount < 1) {
        await db.query('UPDATE subscriptions SET package_id = $1, price = $2, next_package_id = NULL, updated_at = now() WHERE id = $3', [packageId, price, sub.id]);
        return { action: 'applied', message: `You are now on ${pkg.name}` };
      }
      const invoice = await createInvoice(db, {
        accountId,
        kind: 'upgrade',
        packageId,
        amount,
        description: `Upgrade to ${pkg.name} for the rest of the current period`,
        createdBy: userId,
      });
      return { action: 'invoice', invoice };
    }

    const over = await overLimits(accountId, pkg);
    if (over.length) throw badRequest(`${pkg.name} is smaller than what you use: remove ${over.join(', ')} first`);
    await db.query('UPDATE subscriptions SET next_package_id = $1, updated_at = now() WHERE id = $2', [packageId, sub.id]);
    return { action: 'scheduled', message: `You move to ${pkg.name} when the current period ends` };
  });
  if (result.action !== 'invoice') {
    invalidatePlans(accountId);
    scheduleApply();
  }
  return result;
}

/** Applies what a paid invoice bought. Runs inside the transaction that marks it paid. */
async function applyInvoice(db: Db, invoice: Invoice): Promise<void> {
  if (invoice.kind === 'manual') return;
  const sub = (await db.query<SubRow>("SELECT * FROM subscriptions WHERE account_id = $1 AND status <> 'cancelled' FOR UPDATE", [invoice.account_id])).rows[0];
  const pkg = invoice.package_id ? (await db.query<PackageRow>('SELECT * FROM packages WHERE id = $1', [invoice.package_id])).rows[0] : undefined;
  const months = invoice.months;

  if (invoice.kind === 'subscription') {
    if (!pkg) throw new HttpError(500, 'Invoice has no package');
    if (sub) {
      await db.query(
        `UPDATE subscriptions SET package_id = $1, price = $2, status = 'active', next_package_id = NULL, cancel_at_period_end = false,
           current_period_end = greatest(current_period_end, now()) + make_interval(months => $3), updated_at = now() WHERE id = $4`,
        [pkg.id, Number(pkg.price_monthly ?? 0), months, sub.id],
      );
    } else {
      await db.query(
        `INSERT INTO subscriptions (account_id, package_id, price, current_period_start, current_period_end)
         VALUES ($1, $2, $3, now(), now() + make_interval(months => $4))`,
        [invoice.account_id, pkg.id, Number(pkg.price_monthly ?? 0), months],
      );
    }
  } else if (invoice.kind === 'renewal') {
    if (!sub) throw new HttpError(409, 'There is no package to renew; buy one instead');
    const nextPkg = sub.next_package_id ? (await db.query<PackageRow>('SELECT * FROM packages WHERE id = $1', [sub.next_package_id])).rows[0] : undefined;
    await db.query(
      `UPDATE subscriptions SET status = 'active', cancel_at_period_end = false,
         current_period_start = greatest(current_period_end, now()),
         current_period_end = greatest(current_period_end, now()) + make_interval(months => $1),
         package_id = COALESCE($2, package_id), price = COALESCE($3, price), next_package_id = NULL, updated_at = now()
       WHERE id = $4`,
      [months, nextPkg?.id ?? null, nextPkg ? Number(nextPkg.price_monthly ?? 0) : null, sub.id],
    );
  } else if (invoice.kind === 'upgrade') {
    if (!sub || !pkg) throw new HttpError(409, 'There is no package to upgrade');
    await db.query("UPDATE subscriptions SET package_id = $1, price = $2, status = 'active', next_package_id = NULL, updated_at = now() WHERE id = $3", [
      pkg.id,
      Number(pkg.price_monthly ?? 0),
      sub.id,
    ]);
  }
  await db.query("UPDATE accounts SET status = 'active', updated_at = now() WHERE id = $1 AND status IN ('pending', 'suspended')", [invoice.account_id]);
}

/** Marks an invoice paid (once) and applies it. Returns false when it was already paid. */
export async function markInvoicePaid(invoiceId: number, db?: Db): Promise<boolean> {
  const run = async (c: Db) => {
    const invoice = (await c.query<Invoice>('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId])).rows[0];
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'paid') return { changed: false, accountId: invoice.account_id };
    if (invoice.status === 'void') throw badRequest('This invoice was cancelled');
    await c.query("UPDATE invoices SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1", [invoiceId]);
    await applyInvoice(c, invoice);
    return { changed: true, accountId: invoice.account_id };
  };
  const r = db ? await run(db) : await tx(run);
  if (r.changed) {
    invalidatePlans(r.accountId);
    scheduleApply();
  }
  return r.changed;
}

// --------------------------------------------------------------------------------- payments
async function payableInvoice(invoiceId: number, accountId: number | null): Promise<Invoice> {
  const invoice = await one<Invoice>('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invoice || (accountId !== null && invoice.account_id !== accountId)) throw notFound('Invoice');
  if (invoice.status === 'paid') throw badRequest('This invoice is already paid');
  if (invoice.status === 'void') throw badRequest('This invoice was cancelled');
  if (Number(invoice.amount) <= 0) throw badRequest('Nothing to pay on this invoice');
  return invoice;
}

/** Starts a card / mobile-banking payment; returns the SSLCommerz page to send the browser to. */
export async function startOnlinePayment(invoiceId: number, accountId: number): Promise<{ url: string }> {
  const invoice = await payableInvoice(invoiceId, accountId);
  const account = await one<{ name: string; email: string; phone: string; address: string }>('SELECT name, email, phone, address FROM accounts WHERE id = $1', [accountId]);
  const tranId = `ENV${invoice.id}X${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const payment = await one<Payment>(
    `INSERT INTO payments (invoice_id, account_id, method, status, amount, tran_id) VALUES ($1, $2, 'sslcommerz', 'initiated', $3, $4) RETURNING *`,
    [invoice.id, accountId, invoice.amount, tranId],
  );
  const cb = `${config.publicUrl}/api/public/sslcommerz`;
  try {
    const session = await createSession({
      tranId,
      amount: Number(invoice.amount),
      productName: `${invoice.number} · ${invoice.description}`,
      customer: { name: account?.name ?? 'Customer', email: account?.email ?? '', phone: account?.phone ?? '', address: account?.address ?? '' },
      successUrl: `${cb}/success`,
      failUrl: `${cb}/fail`,
      cancelUrl: `${cb}/cancel`,
      ipnUrl: `${cb}/ipn`,
    });
    await one("UPDATE payments SET raw = jsonb_build_object('sessionkey', $1::text), updated_at = now() WHERE id = $2", [session.sessionKey, payment!.id]);
    return { url: session.url };
  } catch (err) {
    await one("UPDATE payments SET status = 'failed', note = $1, updated_at = now() WHERE id = $2", [(err as Error).message.slice(0, 300), payment!.id]);
    throw err;
  }
}

export type GatewayOutcome = { invoiceId: number | null; status: 'paid' | 'review' | 'failed' | 'cancelled' | 'unknown' };

/**
 * Settles a gateway payment from what SSLCommerz says (asked directly, never trusting the browser):
 * right transaction, right amount, BDT. Risky payments wait for an admin.
 */
async function settle(payment: Payment & { status: string }, v: Validation | null): Promise<GatewayOutcome> {
  const ok =
    !!v &&
    (v.status === 'VALID' || v.status === 'VALIDATED') &&
    v.tran_id === payment.tran_id &&
    Math.abs(Number(v.amount) - Number(payment.amount)) < 0.01 &&
    (v.currency_type ?? v.currency ?? 'BDT') === 'BDT';
  if (!ok) return { invoiceId: payment.invoice_id, status: 'unknown' };
  const risky = String(v!.risk_level ?? '0') === '1';
  const outcome = await tx(async (db) => {
    const current = (await db.query<Payment>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [payment.id])).rows[0]!;
    if (current.status === 'succeeded') return 'paid' as const;
    if (current.status === 'pending_review' && risky) return 'review' as const;
    await db.query(
      `UPDATE payments SET status = $1, val_id = $2, bank_tran_id = $3, card_type = $4, raw = raw || $5::jsonb, updated_at = now() WHERE id = $6`,
      [risky ? 'pending_review' : 'succeeded', v!.val_id, v!.bank_tran_id ?? null, v!.card_type ?? null, JSON.stringify({ validation: v }), payment.id],
    );
    if (risky) return 'review' as const;
    await markInvoicePaid(payment.invoice_id, db);
    return 'paid' as const;
  });
  if (outcome === 'paid') {
    const inv = await one<{ account_id: number }>('SELECT account_id FROM invoices WHERE id = $1', [payment.invoice_id]);
    if (inv) {
      invalidatePlans(inv.account_id);
      scheduleApply();
    }
  }
  return { invoiceId: payment.invoice_id, status: outcome };
}

/** The browser came back (success/fail/cancel) or the gateway sent its IPN. */
export async function handleGatewayCallback(kind: 'success' | 'fail' | 'cancel' | 'ipn', body: Record<string, string>): Promise<GatewayOutcome> {
  const tranId = String(body.tran_id ?? '');
  const payment = tranId ? await one<Payment>("SELECT * FROM payments WHERE tran_id = $1 AND method = 'sslcommerz'", [tranId]) : null;
  if (!payment) return { invoiceId: null, status: 'unknown' };
  const valId = String(body.val_id ?? '');
  if ((kind === 'success' || kind === 'ipn') && valId) return settle(payment, await validate(valId));
  if (payment.status === 'initiated') {
    const status = kind === 'cancel' || body.status === 'CANCELLED' ? 'cancelled' : 'failed';
    await one("UPDATE payments SET status = $1, raw = raw || $2::jsonb, updated_at = now() WHERE id = $3 AND status = 'initiated'", [
      status,
      JSON.stringify({ [kind]: body }),
      payment.id,
    ]);
    return { invoiceId: payment.invoice_id, status };
  }
  return { invoiceId: payment.invoice_id, status: payment.status === 'succeeded' ? 'paid' : 'unknown' };
}

/** Payments whose browser never came back: ask SSLCommerz by transaction id. */
export async function reconcileOnlinePayments(): Promise<number> {
  const stuck = await many<Payment>(
    `SELECT * FROM payments WHERE method = 'sslcommerz' AND status = 'initiated'
      AND created_at < now() - interval '10 minutes' AND created_at > now() - interval '3 days' ORDER BY id LIMIT 50`,
  );
  let settled = 0;
  for (const p of stuck) {
    const found = await queryTransaction(p.tran_id!).catch(() => []);
    const valid = found.find((v) => v.status === 'VALID' || v.status === 'VALIDATED');
    if (valid?.val_id) {
      const r = await settle(p, await validate(valid.val_id));
      if (r.status === 'paid' || r.status === 'review') settled++;
    } else if (found.some((v) => ['FAILED', 'CANCELLED', 'EXPIRED'].includes(v.status))) {
      await one("UPDATE payments SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'initiated'", [p.id]);
    }
  }
  return settled;
}

/** A customer reports a bKash / bank transfer; an admin confirms it. */
export async function submitManualPayment(invoiceId: number, accountId: number, data: { channel: string; reference: string; note: string }): Promise<Payment> {
  const invoice = await payableInvoice(invoiceId, accountId);
  const dup = await one('SELECT 1 FROM payments WHERE invoice_id = $1 AND status = $2', [invoice.id, 'pending_review']);
  if (dup) throw badRequest('A payment for this invoice is already waiting for confirmation');
  return (await one<Payment>(
    `INSERT INTO payments (invoice_id, account_id, method, status, amount, channel, reference, note)
     VALUES ($1, $2, 'manual', 'pending_review', $3, $4, $5, $6) RETURNING *`,
    [invoice.id, accountId, invoice.amount, data.channel, data.reference, data.note],
  ))!;
}

/** Admin decision on a payment waiting for review (manual transfers, risky card payments). */
export async function reviewPayment(paymentId: number, approve: boolean, reviewerId: number, note: string): Promise<void> {
  await tx(async (db) => {
    const p = (await db.query<Payment>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId])).rows[0];
    if (!p) throw notFound('Payment');
    if (p.status !== 'pending_review') throw badRequest('This payment is not waiting for review');
    await db.query(`UPDATE payments SET status = $1, reviewed_by = $2, note = CASE WHEN $3 = '' THEN note ELSE $3 END, updated_at = now() WHERE id = $4`, [
      approve ? 'succeeded' : 'failed',
      reviewerId,
      note,
      p.id,
    ]);
    if (approve) await markInvoicePaid(p.invoice_id, db);
  });
  const inv = await one<{ account_id: number }>('SELECT p.account_id FROM payments p WHERE p.id = $1', [paymentId]);
  if (inv) {
    invalidatePlans(inv.account_id);
    scheduleApply();
  }
}
