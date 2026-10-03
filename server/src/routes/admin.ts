import { Router } from 'express';
import { z } from 'zod';
import { exec, many, one, tx } from '../db.js';
import { hashPassword } from '../auth.js';
import { badRequest, conflict, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { randomPassword } from '../lib/secrets.js';
import { scheduleApply } from '../asterisk/apply.js';
import { getAccountPlan, getUsage, invalidatePlans, IVR_TIERS } from '../billing/plan.js';

/** Platform administration (Enfinito): packages, customers and their subscriptions. */
export const adminRouter = Router();

/** Something that changes what a customer may use: refresh limits and the Asterisk config. */
function planChanged(accountId?: number): void {
  invalidatePlans(accountId);
  scheduleApply();
}

// ------------------------------------------------------------------------------------- packages
const limit = z.number().int().min(0).max(1_000_000).nullable();

const packageSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'lowercase letters, digits and dashes'),
  tagline: z.string().trim().max(80).default(''),
  price_monthly: z.number().min(0).max(10_000_000).nullable(),
  public: z.boolean().default(true),
  highlight: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
  max_servers: limit,
  max_dids: limit,
  max_extensions: limit,
  max_channels: limit,
  max_ivrs: limit,
  recording_days: z.number().int().min(0).max(3650).default(0),
  recording_mb: limit,
  ivr_tier: z.enum(IVR_TIERS).default('basic'),
  call_monitoring: z.boolean().default(false),
  api_access: z.boolean().default(false),
  display_rows: z.array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(60) })).max(12).default([]),
});

adminRouter.get('/packages', async (_req, res) => {
  res.json(
    await many(
      `SELECT p.*, (SELECT count(*) FROM subscriptions s WHERE s.package_id = p.id AND s.status <> 'cancelled') AS subscribers
         FROM packages p ORDER BY p.sort_order, p.id`,
    ),
  );
});

adminRouter.post('/packages', async (req, res) => {
  const d = packageSchema.parse(req.body);
  if (await one('SELECT 1 FROM packages WHERE slug = $1', [d.slug])) throw conflict(`The short name "${d.slug}" is taken`);
  const row = await one(
    `INSERT INTO packages (name, slug, tagline, price_monthly, public, highlight, sort_order, active, max_servers, max_dids,
       max_extensions, max_channels, max_ivrs, recording_days, recording_mb, ivr_tier, call_monitoring, api_access, display_rows)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [d.name, d.slug, d.tagline, d.price_monthly, d.public, d.highlight, d.sort_order, d.active, d.max_servers, d.max_dids, d.max_extensions,
      d.max_channels, d.max_ivrs, d.recording_days, d.recording_mb, d.ivr_tier, d.call_monitoring, d.api_access, JSON.stringify(d.display_rows)],
  );
  await audit(req, 'create', 'package', row.id, d.name, null);
  res.status(201).json(row);
});

adminRouter.put('/packages/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const d = packageSchema.parse(req.body);
  if (await one('SELECT 1 FROM packages WHERE slug = $1 AND id <> $2', [d.slug, id])) throw conflict(`The short name "${d.slug}" is taken`);
  const row = await one(
    `UPDATE packages SET name=$1, slug=$2, tagline=$3, price_monthly=$4, public=$5, highlight=$6, sort_order=$7, active=$8, max_servers=$9,
       max_dids=$10, max_extensions=$11, max_channels=$12, max_ivrs=$13, recording_days=$14, recording_mb=$15, ivr_tier=$16,
       call_monitoring=$17, api_access=$18, display_rows=$19, updated_at=now()
     WHERE id = $20 RETURNING *`,
    [d.name, d.slug, d.tagline, d.price_monthly, d.public, d.highlight, d.sort_order, d.active, d.max_servers, d.max_dids, d.max_extensions,
      d.max_channels, d.max_ivrs, d.recording_days, d.recording_mb, d.ivr_tier, d.call_monitoring, d.api_access, JSON.stringify(d.display_rows), id],
  );
  if (!row) throw notFound('Package');
  await audit(req, 'update', 'package', id, d.name, null);
  // Every subscriber's limits just changed.
  planChanged();
  res.json(row);
});

adminRouter.delete('/packages/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const used = await one<{ count: number }>('SELECT count(*) AS count FROM subscriptions WHERE package_id = $1 OR next_package_id = $1', [id]);
  if ((used?.count ?? 0) > 0) throw badRequest('Customers use this package. Hide it (turn off "Active") instead of deleting it.');
  const row = await one<{ name: string }>('DELETE FROM packages WHERE id = $1 RETURNING name', [id]);
  if (!row) throw notFound('Package');
  await audit(req, 'delete', 'package', id, row.name, null);
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------- accounts
adminRouter.get('/accounts', async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '');
  const where: string[] = [];
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(lower(a.name) LIKE $${params.length} OR lower(a.email) LIKE $${params.length} OR a.phone LIKE $${params.length})`);
  }
  if (['pending', 'active', 'suspended', 'closed'].includes(status)) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  res.json(
    await many(
      `SELECT a.id, a.name, a.email, a.phone, a.status, a.internal, a.created_at,
              p.id AS package_id, p.name AS package_name, s.status AS subscription_status, s.price, s.current_period_end,
              (SELECT count(*) FROM tenants t WHERE t.account_id = a.id) AS servers,
              (SELECT count(*) FROM extensions e JOIN tenants t ON t.id = e.tenant_id WHERE t.account_id = a.id) AS extensions,
              (SELECT count(*) FROM numbers n JOIN tenants t ON t.id = n.tenant_id WHERE t.account_id = a.id) AS dids,
              (SELECT u.email FROM users u WHERE u.account_id = a.id AND u.is_owner ORDER BY u.id LIMIT 1) AS owner_email
         FROM accounts a
         LEFT JOIN subscriptions s ON s.account_id = a.id AND s.status <> 'cancelled'
         LEFT JOIN packages p ON p.id = s.package_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.internal DESC, a.created_at DESC`,
      params,
    ),
  );
});

adminRouter.get('/accounts/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const account = await one('SELECT * FROM accounts WHERE id = $1', [id]);
  if (!account) throw notFound('Account');
  const [plan, usage, servers, users, subscriptions] = await Promise.all([
    getAccountPlan(id),
    getUsage(id, { recordings: true }),
    many(
      `SELECT t.id, t.name, t.slug, t.enabled,
              (SELECT count(*) FROM extensions e WHERE e.tenant_id = t.id) AS extensions,
              (SELECT count(*) FROM numbers n WHERE n.tenant_id = t.id) AS numbers
         FROM tenants t WHERE t.account_id = $1 ORDER BY t.id`,
      [id],
    ),
    many('SELECT id, email, name, role, is_owner, enabled, last_login_at FROM users WHERE account_id = $1 ORDER BY is_owner DESC, id', [id]),
    many(
      `SELECT s.*, p.name AS package_name FROM subscriptions s JOIN packages p ON p.id = s.package_id
        WHERE s.account_id = $1 ORDER BY s.id DESC`,
      [id],
    ),
  ]);
  res.json({ account, plan, usage, servers, users, subscriptions });
});

const accountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(300).default(''),
  notes: z.string().trim().max(2000).default(''),
});

const newAccountSchema = accountSchema.extend({
  owner_name: z.string().trim().min(1).max(60),
  owner_password: z.string().min(8, 'must be at least 8 characters').max(128).optional(),
  package_id: z.number().int().positive().nullable().default(null),
  months: z.number().int().min(1).max(36).default(1),
  server_name: z.string().trim().min(2).max(60).optional(),
});

/** Creates a customer by hand (sales-led onboarding): account, owner login, optional package and server. */
adminRouter.post('/accounts', async (req, res) => {
  const d = newAccountSchema.parse(req.body);
  if (await one('SELECT 1 FROM users WHERE email = $1', [d.email])) throw conflict('A login with this email already exists');
  const pkg = d.package_id ? await one<{ id: number; price_monthly: string | null }>('SELECT id, price_monthly FROM packages WHERE id = $1', [d.package_id]) : null;
  if (d.package_id && !pkg) throw badRequest('Package not found');
  const password = d.owner_password ?? randomPassword(14);
  const result = await tx(async (db) => {
    const account = (
      await db.query(
        `INSERT INTO accounts (name, email, phone, address, notes, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [d.name, d.email, d.phone, d.address, d.notes, pkg ? 'active' : 'pending'],
      )
    ).rows[0] as { id: number };
    let tenantId: number | null = null;
    if (d.server_name) {
      const base = d.server_name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 14) || 'server';
      let slug = base;
      for (let i = 2; (await db.query('SELECT 1 FROM tenants WHERE slug = $1', [slug])).rowCount; i++) slug = `${base.slice(0, 14)}${i}`;
      tenantId = (await db.query('INSERT INTO tenants (name, slug, account_id) VALUES ($1, $2, $3) RETURNING id', [d.server_name, slug, account.id]))
        .rows[0].id as number;
    }
    await db.query(
      `INSERT INTO users (email, name, password_hash, role, account_id, is_owner, tenant_id) VALUES ($1, $2, $3, 'admin', $4, true, $5)`,
      [d.email, d.owner_name, await hashPassword(password), account.id, tenantId],
    );
    if (pkg) {
      await db.query(
        `INSERT INTO subscriptions (account_id, package_id, price, current_period_start, current_period_end)
         VALUES ($1, $2, $3, now(), now() + make_interval(months => $4))`,
        [account.id, pkg.id, Number(pkg.price_monthly ?? 0) * d.months, d.months],
      );
    }
    return { id: account.id };
  });
  await audit(req, 'create', 'account', result.id, d.name, null);
  planChanged(result.id);
  res.status(201).json({ id: result.id, owner_email: d.email, owner_password: d.owner_password ? undefined : password });
});

adminRouter.put('/accounts/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const d = accountSchema.extend({ status: z.enum(['pending', 'active', 'suspended', 'closed']) }).parse(req.body);
  const existing = await one<{ internal: boolean }>('SELECT internal FROM accounts WHERE id = $1', [id]);
  if (!existing) throw notFound('Account');
  if (existing.internal && d.status !== 'active') throw badRequest("Enfinito's own account cannot be suspended or closed");
  await exec('UPDATE accounts SET name=$1, email=$2, phone=$3, address=$4, notes=$5, status=$6, updated_at=now() WHERE id=$7', [
    d.name, d.email, d.phone, d.address, d.notes, d.status, id,
  ]);
  await audit(req, 'update', 'account', id, `${d.name} (${d.status})`, null);
  planChanged(id);
  res.json({ ok: true });
});

const subscriptionSchema = z.object({
  package_id: z.number().int().positive(),
  /** Price charged per period; defaults to the package price. */
  price: z.number().min(0).max(10_000_000).nullable().default(null),
  current_period_end: z.iso.datetime({ offset: true }).or(z.iso.date()),
  overrides: z
    .object({
      max_servers: limit.optional(),
      max_dids: limit.optional(),
      max_extensions: limit.optional(),
      max_channels: limit.optional(),
      max_ivrs: limit.optional(),
      recording_days: z.number().int().min(0).max(3650).optional(),
      recording_mb: limit.optional(),
      ivr_tier: z.enum(IVR_TIERS).optional(),
      call_monitoring: z.boolean().optional(),
      api_access: z.boolean().optional(),
    })
    .default({}),
});

/** Puts a customer on a package (or changes it, its price, period or custom limits). */
adminRouter.put('/accounts/:id/subscription', async (req, res) => {
  const id = intParam(req.params.id);
  const d = subscriptionSchema.parse(req.body);
  const account = await one<{ internal: boolean; status: string }>('SELECT internal, status FROM accounts WHERE id = $1', [id]);
  if (!account) throw notFound('Account');
  if (account.internal) throw badRequest("Enfinito's own account has no package; it is never limited");
  const pkg = await one<{ name: string; price_monthly: string | null }>('SELECT name, price_monthly FROM packages WHERE id = $1', [d.package_id]);
  if (!pkg) throw badRequest('Package not found');
  const price = d.price ?? Number(pkg.price_monthly ?? 0);
  await tx(async (db) => {
    const live = (await db.query("SELECT id FROM subscriptions WHERE account_id = $1 AND status <> 'cancelled'", [id])).rows[0] as
      | { id: number }
      | undefined;
    if (live) {
      await db.query(
        `UPDATE subscriptions SET package_id=$1, price=$2, current_period_end=$3, overrides=$4, status='active', next_package_id=NULL,
           updated_at=now() WHERE id=$5`,
        [d.package_id, price, d.current_period_end, JSON.stringify(d.overrides), live.id],
      );
    } else {
      await db.query(
        `INSERT INTO subscriptions (account_id, package_id, price, current_period_end, overrides) VALUES ($1, $2, $3, $4, $5)`,
        [id, d.package_id, price, d.current_period_end, JSON.stringify(d.overrides)],
      );
    }
    if (account.status === 'pending') await db.query("UPDATE accounts SET status = 'active', updated_at = now() WHERE id = $1", [id]);
  });
  await audit(req, 'update', 'subscription', id, pkg.name, null);
  planChanged(id);
  res.json({ ok: true });
});

adminRouter.delete('/accounts/:id/subscription', async (req, res) => {
  const id = intParam(req.params.id);
  const n = await exec("UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE account_id = $1 AND status <> 'cancelled'", [id]);
  if (!n) throw notFound('Subscription');
  await audit(req, 'delete', 'subscription', id, 'cancelled', null);
  planChanged(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------- public
/** Packages for the public pricing page (no sign-in). */
export const publicRouter = Router();

publicRouter.get('/packages', async (_req, res) => {
  res.json(
    await many(
      `SELECT id, name, slug, tagline, price_monthly, highlight, max_servers, max_dids, max_extensions, max_channels, max_ivrs,
              recording_days, recording_mb, ivr_tier, call_monitoring, api_access, display_rows
         FROM packages WHERE active AND public ORDER BY sort_order, id`,
    ),
  );
});
