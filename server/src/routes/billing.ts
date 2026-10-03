import express, { Router } from 'express';
import { z } from 'zod';
import { exec, many, one, tx } from '../db.js';
import { requireOwner } from '../auth.js';
import { badRequest, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { scheduleApply } from '../asterisk/apply.js';
import { invalidatePlans } from '../billing/plan.js';
import { getBillingSettings, publicPaymentOptions, updateBillingSettings, type BillingSettings } from '../billing/settings.js';
import {
  checkout,
  createInvoice,
  handleGatewayCallback,
  markInvoicePaid,
  reviewPayment,
  startOnlinePayment,
  submitManualPayment,
} from '../billing/invoices.js';
import { runBillingClock } from '../billing/jobs.js';

const invoiceColumns = 'id, number, account_id, kind, package_id, months, description, amount, currency, status, due_at, paid_at, period_start, created_at';

// ------------------------------------------------------------------------------------ customer
/** The account owner's billing: invoices, paying them, changing package. Works while suspended. */
export const billingRouter = Router();
billingRouter.use(requireOwner);

function accountOf(req: express.Request): number {
  const id = req.user!.accountId;
  if (id === null) throw badRequest('Platform administrators have no customer account');
  return id;
}

billingRouter.get('/options', async (_req, res) => {
  res.json(await publicPaymentOptions());
});

billingRouter.get('/invoices', async (req, res) => {
  res.json(await many(`SELECT ${invoiceColumns} FROM invoices WHERE account_id = $1 AND status <> 'void' ORDER BY id DESC LIMIT 100`, [accountOf(req)]));
});

billingRouter.get('/invoices/:id', async (req, res) => {
  const accountId = accountOf(req);
  const invoice = await one(`SELECT ${invoiceColumns} FROM invoices WHERE id = $1 AND account_id = $2`, [intParam(req.params.id), accountId]);
  if (!invoice) throw notFound('Invoice');
  const [payments, account, settings] = await Promise.all([
    many(
      `SELECT id, method, status, amount, card_type, channel, reference, created_at, updated_at FROM payments WHERE invoice_id = $1 ORDER BY id DESC`,
      [invoice.id],
    ),
    one('SELECT name, email, phone, address FROM accounts WHERE id = $1', [accountId]),
    getBillingSettings(),
  ]);
  res.json({ invoice, payments, account, seller: settings.business });
});

billingRouter.post('/checkout', async (req, res) => {
  const { package_id, months } = z.object({ package_id: z.number().int().positive(), months: z.number().int().min(1).max(12).default(1) }).parse(req.body);
  const result = await checkout(accountOf(req), package_id, months, req.user!.id);
  await audit(req, 'checkout', 'billing', package_id, result.action, null);
  res.json(result);
});

billingRouter.post('/invoices/:id/pay-online', async (req, res) => {
  res.json(await startOnlinePayment(intParam(req.params.id), accountOf(req)));
});

billingRouter.post('/invoices/:id/pay-manual', async (req, res) => {
  if (!(await publicPaymentOptions()).manual) throw badRequest('Manual payments are not accepted');
  const data = z
    .object({
      channel: z.enum(['bkash', 'nagad', 'rocket', 'bank', 'cash', 'other']),
      reference: z.string().trim().min(3, 'enter the transaction ID').max(80),
      note: z.string().trim().max(300).default(''),
    })
    .parse(req.body);
  const payment = await submitManualPayment(intParam(req.params.id), accountOf(req), data);
  await audit(req, 'manual_payment', 'billing', payment.id, `${data.channel} ${data.reference}`, null);
  res.status(201).json({ ok: true });
});

/** Cancel (or keep) the package at the end of the paid period. */
billingRouter.post('/cancel', async (req, res) => {
  const { cancel } = z.object({ cancel: z.boolean() }).parse(req.body);
  const accountId = accountOf(req);
  const n = await exec("UPDATE subscriptions SET cancel_at_period_end = $1, updated_at = now() WHERE account_id = $2 AND status <> 'cancelled'", [cancel, accountId]);
  if (!n) throw notFound('Package');
  invalidatePlans(accountId);
  await audit(req, cancel ? 'cancel' : 'resume', 'subscription', accountId, '', null);
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------- gateway
/** SSLCommerz posts here: the customer's browser (success/fail/cancel) and its server (IPN). */
export const gatewayRouter = Router();
gatewayRouter.use(express.urlencoded({ extended: false, limit: '64kb' }));

/**
 * The browser arrives by a cross-site POST, which carries no session cookie (SameSite=Strict); a
 * page of ours then continues to the app, and that same-site navigation does.
 */
function backToApp(res: express.Response, query: string): void {
  const target = `/billing?${query}`;
  res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to Envo</title><meta http-equiv="refresh" content="0;url=${target}"></head><body style="font-family:system-ui,sans-serif;padding:3rem;text-align:center;color:#334155"><p>Returning to Envo…</p><script>location.replace(${JSON.stringify(target)})</script></body></html>`,
    );
}

for (const kind of ['success', 'fail', 'cancel'] as const) {
  gatewayRouter.post(`/${kind}`, async (req, res) => {
    const r = await handleGatewayCallback(kind, req.body as Record<string, string>).catch(() => ({ invoiceId: null, status: 'unknown' as const }));
    backToApp(res, `payment=${r.status}${r.invoiceId ? `&invoice=${r.invoiceId}` : ''}`);
  });
}

gatewayRouter.post('/ipn', async (req, res) => {
  await handleGatewayCallback('ipn', req.body as Record<string, string>);
  res.type('text').send('OK');
});

// --------------------------------------------------------------------------------------- admin
/** Platform admins: revenue, invoices, payments to confirm, gateway settings. */
export const adminBillingRouter = Router();

adminBillingRouter.get('/overview', async (_req, res) => {
  const [totals, byMonth, pending] = await Promise.all([
    one<Record<string, string | number>>(
      `SELECT
         (SELECT COALESCE(sum(s.price), 0) FROM subscriptions s JOIN accounts a ON a.id = s.account_id
           WHERE s.status <> 'cancelled' AND a.status = 'active' AND NOT a.internal) AS mrr,
         (SELECT COALESCE(sum(amount), 0) FROM payments WHERE status = 'succeeded' AND updated_at >= date_trunc('month', now())) AS collected_month,
         (SELECT COALESCE(sum(amount), 0) FROM payments WHERE status = 'succeeded' AND updated_at >= date_trunc('month', now()) - interval '1 month'
            AND updated_at < date_trunc('month', now())) AS collected_last_month,
         (SELECT COALESCE(sum(amount), 0) FROM invoices WHERE status = 'unpaid') AS outstanding,
         (SELECT count(*) FROM invoices WHERE status = 'unpaid' AND due_at < now()) AS overdue,
         (SELECT count(*) FROM accounts WHERE status = 'active' AND NOT internal) AS active_customers,
         (SELECT count(*) FROM accounts WHERE status = 'suspended') AS suspended_customers,
         (SELECT count(*) FROM accounts WHERE status = 'pending') AS pending_customers,
         (SELECT count(*) FROM accounts WHERE created_at >= date_trunc('month', now()) AND NOT internal) AS new_this_month`,
    ),
    many(
      `SELECT to_char(date_trunc('month', updated_at), 'YYYY-MM') AS month, sum(amount) AS amount, count(*) AS payments
         FROM payments WHERE status = 'succeeded' AND updated_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY 1 ORDER BY 1`,
    ),
    one<{ count: number }>("SELECT count(*) AS count FROM payments WHERE status = 'pending_review'"),
  ]);
  res.json({ ...totals, pending_reviews: pending?.count ?? 0, by_month: byMonth });
});

adminBillingRouter.get('/invoices', async (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (['unpaid', 'paid', 'void'].includes(String(req.query.status ?? ''))) {
    params.push(req.query.status);
    where.push(`i.status = $${params.length}`);
  }
  if (req.query.account_id) {
    params.push(Number(req.query.account_id));
    where.push(`i.account_id = $${params.length}`);
  }
  res.json(
    await many(
      `SELECT i.id, i.number, i.account_id, i.kind, i.description, i.amount, i.status, i.due_at, i.paid_at, i.created_at, a.name AS account_name
         FROM invoices i JOIN accounts a ON a.id = i.account_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY i.id DESC LIMIT 300`,
      params,
    ),
  );
});

adminBillingRouter.post('/invoices', async (req, res) => {
  const d = z
    .object({ account_id: z.number().int().positive(), description: z.string().trim().min(2).max(200), amount: z.number().min(0).max(10_000_000) })
    .parse(req.body);
  if (!(await one('SELECT 1 FROM accounts WHERE id = $1', [d.account_id]))) throw notFound('Account');
  const invoice = await tx((db) => createInvoice(db, { accountId: d.account_id, kind: 'manual', amount: d.amount, description: d.description, createdBy: req.user!.id }));
  await audit(req, 'create', 'invoice', invoice.id, invoice.number, null);
  res.status(201).json(invoice);
});

adminBillingRouter.post('/invoices/:id/void', async (req, res) => {
  const id = intParam(req.params.id);
  const n = await exec("UPDATE invoices SET status = 'void', updated_at = now() WHERE id = $1 AND status = 'unpaid'", [id]);
  if (!n) throw badRequest('Only unpaid invoices can be cancelled');
  await audit(req, 'void', 'invoice', id, '', null);
  res.json({ ok: true });
});

/** Cash or any payment received outside the system. */
adminBillingRouter.post('/invoices/:id/mark-paid', async (req, res) => {
  const id = intParam(req.params.id);
  const { note, channel } = z.object({ note: z.string().trim().max(300).default(''), channel: z.string().trim().max(20).default('cash') }).parse(req.body ?? {});
  await tx(async (db) => {
    const inv = (await db.query<{ account_id: number; amount: string; status: string }>('SELECT account_id, amount, status FROM invoices WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'unpaid') throw badRequest('This invoice is not open');
    await db.query(
      `INSERT INTO payments (invoice_id, account_id, method, status, amount, channel, note, reviewed_by) VALUES ($1, $2, 'manual', 'succeeded', $3, $4, $5, $6)`,
      [id, inv.account_id, inv.amount, channel, note, req.user!.id],
    );
    await markInvoicePaid(id, db);
  });
  scheduleApply();
  invalidatePlans();
  await audit(req, 'mark_paid', 'invoice', id, note, null);
  res.json({ ok: true });
});

adminBillingRouter.get('/payments', async (req, res) => {
  const status = String(req.query.status ?? '');
  const valid = ['initiated', 'pending_review', 'succeeded', 'failed', 'cancelled', 'refunded'].includes(status);
  res.json(
    await many(
      `SELECT p.id, p.invoice_id, p.method, p.status, p.amount, p.tran_id, p.bank_tran_id, p.card_type, p.channel, p.reference, p.note,
              p.created_at, p.updated_at, i.number AS invoice_number, i.description, a.id AS account_id, a.name AS account_name
         FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN accounts a ON a.id = p.account_id
        ${valid ? 'WHERE p.status = $1' : ''}
        ORDER BY p.id DESC LIMIT 300`,
      valid ? [status] : [],
    ),
  );
});

for (const decision of ['approve', 'reject'] as const) {
  adminBillingRouter.post(`/payments/:id/${decision}`, async (req, res) => {
    const id = intParam(req.params.id);
    const { note } = z.object({ note: z.string().trim().max(300).default('') }).parse(req.body ?? {});
    await reviewPayment(id, decision === 'approve', req.user!.id, note);
    await audit(req, decision, 'payment', id, note, null);
    res.json({ ok: true });
  });
}

const settingsSchema = z.object({
  sslcommerz: z.object({
    enabled: z.boolean(),
    sandbox: z.boolean(),
    store_id: z.string().trim().max(80),
    /** Empty keeps the stored password. */
    store_passwd: z.string().max(200).default(''),
  }),
  manual: z.object({ enabled: z.boolean(), instructions: z.string().trim().max(2000) }),
  grace_days: z.number().int().min(0).max(60),
  renewal_notice_days: z.number().int().min(1).max(60),
  business: z.object({ name: z.string().trim().min(1).max(80), address: z.string().trim().max(300), email: z.string().trim().max(120), phone: z.string().trim().max(40) }),
});

function maskSecrets(s: BillingSettings) {
  return { ...s, sslcommerz: { ...s.sslcommerz, store_passwd: '', has_passwd: !!s.sslcommerz.store_passwd } };
}

adminBillingRouter.get('/settings', async (_req, res) => {
  res.json(maskSecrets(await getBillingSettings()));
});

adminBillingRouter.put('/settings', async (req, res) => {
  const d = settingsSchema.parse(req.body);
  const current = await getBillingSettings();
  const next: BillingSettings = { ...d, sslcommerz: { ...d.sslcommerz, store_passwd: d.sslcommerz.store_passwd || current.sslcommerz.store_passwd } };
  const saved = await updateBillingSettings(next);
  await audit(req, 'update', 'billing_settings', '', next.sslcommerz.sandbox ? 'sandbox' : 'live', null);
  res.json(maskSecrets(saved));
});

/** Runs the billing clock now (renewals, suspensions, reconciliation) instead of waiting an hour. */
adminBillingRouter.post('/run-clock', async (req, res) => {
  const r = await runBillingClock();
  await audit(req, 'run', 'billing_clock', '', JSON.stringify(r), null);
  res.json(r);
});
