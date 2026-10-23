import { Router, type Request, type RequestHandler } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { exec, many, one, tx } from '../db.js';
import { canAccessTenant, requireOwner, requireRole } from '../auth.js';
import { badRequest, conflict, forbidden, intParam, notFound } from '../lib/http.js';
import { audit, bdMobile, phoneNumber } from '../lib/validate.js';
import { isHost } from '../asterisk/sanitize.js';
import { assertLimit, getAccountPlan, getUsage } from '../billing/plan.js';
import { createInvoice } from '../billing/invoices.js';
import { activeProviders, getSupplySettings, providerOfNumber, updateSupplySettings, type SupplyProvider, type SupplySettings } from '../supply/settings.js';
import { deleteDocuments, documentPath, saveDocument } from '../supply/files.js';
import { supplyCounts } from '../supply/counts.js';
import { connectLine, defaultDestination, lineInput } from './setup.js';

/*
 * Numbers Enfinito provides from its operator allocation (e.g. ICC). A customer picks a free number
 * and sends the subscriber details the operator requires; support registers it with the operator,
 * connects it to the customer's SIP server here, and adds paid top-ups to its balance there. Every
 * support step is one action below, so it can be automated later without changing the customer side.
 */

const OPEN = ['submitted', 'in_review'];
const bdt = (n: number) => `BDT ${n.toLocaleString('en-US')}`;

const address = z.object({
  street: z.string().trim().min(3, 'enter the street address').max(200),
  city: z.string().trim().min(2, 'enter the city').max(60),
  postcode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/, 'enter the postcode'),
  country: z.string().trim().min(2).max(60).default('Bangladesh'),
});

/** Born on a real date, at least 18 years ago. */
function isAdult(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return false;
  return new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate())) <= new Date();
}

/** What the operator's subscriber registration form asks for (BTRC). */
const detailsSchema = z
  .object({
    subscriber_type: z.enum(['individual', 'organization']),
    name: z.string().trim().min(2, 'enter the full name').max(100),
    authorized_person: z.string().trim().max(100).default(''),
    nid: z.string().trim().regex(/^(\d{10}|\d{13}|\d{17})$/, 'enter the NID number: 10, 13 or 17 digits'),
    passport: z.string().trim().regex(/^[A-Za-z0-9]{0,20}$/, 'letters and digits only').default(''),
    phone: z
      .string()
      .transform((v) => bdMobile(v) ?? '')
      .refine((v) => v !== '', 'enter a mobile number like 01712345678'),
    email: z.email('enter a valid email'),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'enter the date of birth').refine(isAdult, 'must be 18 or older'),
    gender: z.enum(['male', 'female']),
    occupation: z.enum(['government_service', 'private_service', 'business', 'student', 'other']),
    present_address: address,
    permanent_address: address,
    billing_address: z.enum(['present', 'permanent']).default('present'),
    father_name: z.string().trim().min(2, "enter the father's name").max(100),
    mother_name: z.string().trim().min(2, "enter the mother's name").max(100),
    spouse_name: z.string().trim().max(100).default(''),
  })
  .superRefine((d, ctx) => {
    if (d.subscriber_type === 'organization' && d.authorized_person.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['authorized_person'], message: 'enter the person who signs for the organization' });
    }
  });

const documents = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 12, fieldSize: 64 * 1024 } }).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'id_document', maxCount: 1 },
]);
const uploadDocuments: RequestHandler = (req, res, next) =>
  documents(req, res, (err: unknown) => next((err as { code?: string } | undefined)?.code === 'LIMIT_FILE_SIZE' ? badRequest('Each file can be at most 5 MB') : err));

function accountOf(req: Request): number {
  const id = req.user!.accountId;
  if (id === null) throw badRequest('Platform administrators have no customer account');
  return id;
}

// ------------------------------------------------------------------------------------ customer
/** The customer's side: ask for a number, follow the request, top up the balance. */
export const numberRequestsRouter = Router();
numberRequestsRouter.use(requireRole('admin'));

numberRequestsRouter.get('/options', async (req, res) => {
  const s = await getSupplySettings();
  const providers = activeProviders(s).map(({ id, name, prefix, length }) => ({ id, name, prefix, length }));
  res.json({ enabled: s.enabled && providers.length > 0, providers, topup: s.topup, room: await numberRoom(accountOf(req)) });
});

/** A provider customers can get a number from now: the one named, or the first on offer. */
async function offeredProvider(id: string): Promise<SupplyProvider> {
  const s = await getSupplySettings();
  const list = activeProviders(s);
  if (!s.enabled || !list.length) throw badRequest('New numbers are not available right now');
  const p = id ? list.find((x) => x.id === id) : list[0];
  if (!p) throw badRequest('Choose one of the providers on offer');
  return p;
}

/** Lower-cased SIP servers of all providers: a line to one of them carries a number from Enfinito. */
const providerHosts = (s: SupplySettings) => s.providers.map((p) => p.line.host.toLowerCase()).filter(Boolean);

/**
 * How many more numbers the package allows, counting requests still on their way (null = no limit),
 * so the customer hears it before filling in a registration that would be refused.
 */
async function numberRoom(accountId: number): Promise<number | null> {
  const [plan, usage, open] = await Promise.all([
    getAccountPlan(accountId),
    getUsage(accountId),
    one<{ count: number }>("SELECT count(*)::int AS count FROM number_requests WHERE account_id = $1 AND status IN ('submitted', 'in_review')", [accountId]),
  ]);
  const limit = plan.limits.max_dids;
  return limit === null ? null : Math.max(0, limit - usage.dids - (open?.count ?? 0));
}

/** Free numbers of one provider to choose from, optionally with some digits after its prefix. */
numberRequestsRouter.get('/pool', async (req, res) => {
  const p = await offeredProvider(String(req.query.provider ?? ''));
  const q = String(req.query.q ?? '').replace(/\D/g, '').slice(0, 15);
  res.json(
    await many(
      `SELECT id, number FROM number_pool
        WHERE status = 'available' AND number LIKE $1 || '%' AND ($2 = '' OR substr(number, $3) LIKE '%' || $2 || '%')
        ORDER BY number LIMIT 60`,
      [p.prefix, q, p.prefix.length + 1],
    ),
  );
});

numberRequestsRouter.get('/', async (req, res) => {
  res.json(
    await many(
      `SELECT r.id, r.status, r.requested_number, r.special, r.reason, r.tenant_id, t.name AS tenant_name, r.number_id, n.number AS connected_number,
              r.details->>'name' AS subscriber_name, r.created_at, r.updated_at
         FROM number_requests r LEFT JOIN tenants t ON t.id = r.tenant_id LEFT JOIN numbers n ON n.id = r.number_id
        WHERE r.account_id = $1 ORDER BY r.id DESC LIMIT 100`,
      [accountOf(req)],
    ),
  );
});

/**
 * A new request: the details as JSON, the photo and ID document as files, and the consent. Either a
 * number from the provider's pool, any free one, or a special number (the provider's prefix and the
 * digits the customer wants after it).
 */
numberRequestsRouter.post('/', uploadDocuments, async (req, res) => {
  const accountId = accountOf(req);
  const body = z
    .object({
      tenant_id: z.coerce.number().int().positive(),
      provider: z.string().trim().max(40).default(''),
      pool_id: z.union([z.literal(''), z.coerce.number().int().positive()]).default(''),
      special: z.string().trim().max(20).default(''),
      details: z.string().max(20_000),
      consent: z.string().refine((v) => v === 'true', 'agree to share these details with the operator'),
    })
    .parse(req.body);
  const provider = await offeredProvider(body.provider);
  if (body.special && body.pool_id !== '') throw badRequest('Choose a number from the list, or ask for a special one, not both');
  if (body.special) {
    if (!/^\d+$/.test(body.special) || !body.special.startsWith(provider.prefix) || body.special.length !== provider.length) {
      throw badRequest(`Enter the ${provider.length - provider.prefix.length} digits after ${provider.prefix}`);
    }
    if (await one('SELECT 1 FROM numbers WHERE number = $1', [body.special])) throw conflict(`${body.special} is already taken. Please try another number.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body.details);
  } catch {
    throw badRequest('The details could not be read');
  }
  const details = detailsSchema.parse(raw);
  const tenant = await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [body.tenant_id]);
  if (!tenant || tenant.account_id !== accountId || !canAccessTenant(req.user!, body.tenant_id)) throw forbidden();
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const photo = files?.photo?.[0];
  const idDoc = files?.id_document?.[0];
  if (!photo) throw badRequest('Add a photo of the subscriber');
  if (!idDoc) throw badRequest('Add a scan or photo of the NID or passport');
  // Open requests count too: each one becomes a number on the package.
  const open = await one<{ count: number }>("SELECT count(*) AS count FROM number_requests WHERE account_id = $1 AND status IN ('submitted', 'in_review')", [accountId]);
  await assertLimit(accountId, 'max_dids', 1 + (open?.count ?? 0));

  let requestId = 0;
  try {
    const created = await tx(async (db) => {
      let number = '';
      if (body.pool_id !== '') {
        const p = (await db.query<{ number: string }>("UPDATE number_pool SET status = 'reserved', updated_at = now() WHERE id = $1 AND status = 'available' RETURNING number", [body.pool_id])).rows[0];
        if (!p) throw conflict('Someone else just took that number. Please choose another one.');
        if (!p.number.startsWith(provider.prefix)) throw badRequest(`Choose a number that starts with ${provider.prefix}`);
        number = p.number;
      }
      const row = (
        await db.query<{ id: number }>(
          `INSERT INTO number_requests (account_id, tenant_id, provider, pool_id, requested_number, special, details, consent_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8) RETURNING id`,
          [accountId, body.tenant_id, provider.id, body.pool_id === '' ? null : body.pool_id, number, body.special, JSON.stringify(details), req.user!.id],
        )
      ).rows[0]!;
      requestId = row.id;
      const photoFile = await saveDocument(row.id, 'photo', photo.buffer, false);
      const idFile = await saveDocument(row.id, 'id', idDoc.buffer, true);
      await db.query('UPDATE number_requests SET photo_file = $1, id_file = $2 WHERE id = $3', [photoFile, idFile, row.id]);
      return { id: row.id, number };
    });
    await audit(req, 'create', 'number_request', created.id, body.special ? `special number: ${body.special}` : created.number || 'any free number', body.tenant_id);
    res.status(201).json(created);
  } catch (err) {
    if (requestId) await deleteDocuments(requestId).catch(() => undefined);
    throw err;
  }
});

/**
 * Closes a request without a number (the customer withdrew, or support rejected it): the reserved
 * number goes back to the pool, and only the subscriber's name is kept, not their ID data.
 */
async function closeRequest(id: number, where: string, params: unknown[], set: { status: 'cancelled' | 'rejected'; reason?: string; by?: number }): Promise<boolean> {
  const closed = await tx(async (db) => {
    const r = (
      await db.query<{ pool_id: number | null }>(
        `UPDATE number_requests SET status = $1, reason = $2, decided_by = COALESCE($3, decided_by), photo_file = '', id_file = '',
                details = jsonb_build_object('name', details->>'name'), updated_at = now()
          WHERE id = $4 AND status IN ('submitted', 'in_review') ${where} RETURNING pool_id`,
        [set.status, set.reason ?? '', set.by ?? null, id, ...params],
      )
    ).rows[0];
    if (!r) return false;
    if (r.pool_id) await db.query("UPDATE number_pool SET status = 'available', updated_at = now() WHERE id = $1 AND status = 'reserved'", [r.pool_id]);
    return true;
  });
  if (closed) await deleteDocuments(id).catch(() => undefined);
  return closed;
}

numberRequestsRouter.post('/:id/cancel', async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await closeRequest(id, 'AND account_id = $5', [accountOf(req)], { status: 'cancelled' }))) {
    throw badRequest('Only a request that is still being processed can be cancelled');
  }
  await audit(req, 'cancel', 'number_request', id, '', null);
  res.json({ ok: true });
});

/**
 * The account's numbers that Enfinito provides, so their calling balance can be topped up here: ones
 * connected through a request, and ones on a line to a provider's SIP server (connected another way).
 */
async function topupNumbers(accountId: number, hosts: string[]): Promise<{ id: number; number: string; tenant_name: string }[]> {
  return many(
    `SELECT n.id, n.number, t.name AS tenant_name
       FROM numbers n JOIN tenants t ON t.id = n.tenant_id LEFT JOIN trunks k ON k.id = n.trunk_id
      WHERE t.account_id = $1
        AND (EXISTS (SELECT 1 FROM number_requests r WHERE r.number_id = n.id AND r.account_id = $1 AND r.status = 'connected')
             OR lower(k.host) = ANY($2::text[]))
      ORDER BY n.number`,
    [accountId, hosts],
  );
}

numberRequestsRouter.get('/topup-numbers', requireOwner, async (req, res) => {
  const s = await getSupplySettings();
  res.json(s.topup.enabled ? await topupNumbers(accountOf(req), providerHosts(s)) : []);
});

// Top-ups: the account owner pays (like any invoice), support adds the balance at the operator.
numberRequestsRouter.get('/topups', requireOwner, async (req, res) => {
  res.json(
    await many(
      `SELECT t.id, t.number_id, t.number, t.amount, t.status, t.created_at, t.applied_at, i.id AS invoice_id, i.number AS invoice_number, i.status AS invoice_status
         FROM topups t JOIN invoices i ON i.id = t.invoice_id WHERE t.account_id = $1 ORDER BY t.id DESC LIMIT 100`,
      [accountOf(req)],
    ),
  );
});

numberRequestsRouter.post('/topups', requireOwner, async (req, res) => {
  const s = await getSupplySettings();
  if (!s.topup.enabled) throw badRequest('Top-ups are not available right now');
  const accountId = accountOf(req);
  const d = z.object({ number_id: z.number().int().positive(), amount: z.number().positive().max(10_000_000) }).parse(req.body);
  const amount = Math.round(d.amount * 100) / 100;
  if (amount < s.topup.min || amount > s.topup.max) throw badRequest(`Top up between ${bdt(s.topup.min)} and ${bdt(s.topup.max)}`);
  const num = (await topupNumbers(accountId, providerHosts(s))).find((n) => n.id === d.number_id);
  if (!num) throw badRequest('Only numbers you got from Enfinito can be topped up here');
  const invoice = await tx(async (db) => {
    const inv = await createInvoice(db, { accountId, kind: 'topup', amount, description: `Balance top-up for ${num.number}`, createdBy: req.user!.id });
    await db.query('INSERT INTO topups (account_id, number_id, number, amount, invoice_id) VALUES ($1, $2, $3, $4, $5)', [accountId, num.id, num.number, inv.amount, inv.id]);
    return inv;
  });
  await audit(req, 'create', 'topup', invoice.id, `${num.number} ${bdt(amount)}`, null);
  res.status(201).json(invoice);
});

/** An unpaid top-up can be dropped; its invoice is cancelled with it. */
numberRequestsRouter.post('/topups/:id/cancel', requireOwner, async (req, res) => {
  const id = intParam(req.params.id);
  const accountId = accountOf(req);
  const done = await tx(async (db) => {
    // Lock the invoice first, in the same order as a payment arriving for it.
    const inv = (
      await db.query<{ id: number; status: string }>(
        'SELECT i.id, i.status FROM invoices i JOIN topups t ON t.invoice_id = i.id WHERE t.id = $1 AND t.account_id = $2 FOR UPDATE OF i',
        [id, accountId],
      )
    ).rows[0];
    if (!inv || inv.status !== 'unpaid') return false;
    const t = await db.query("UPDATE topups SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'", [id]);
    if (!t.rowCount) return false;
    await db.query("UPDATE invoices SET status = 'void', updated_at = now() WHERE id = $1", [inv.id]);
    return true;
  });
  if (!done) throw badRequest('Only an unpaid top-up can be cancelled');
  await audit(req, 'cancel', 'topup', id, '', null);
  res.json({ ok: true });
});

// --------------------------------------------------------------------------------------- admin
/** Support's side at /admin: the request queue, connecting numbers, the pool, top-ups to add. */
export const adminSupplyRouter = Router();

const supplySchema = z.object({
  enabled: z.boolean(),
  topup: z
    .object({
      enabled: z.boolean(),
      min: z.number().min(1).max(100_000),
      max: z.number().min(1).max(1_000_000),
      presets: z.array(z.number().positive().max(1_000_000)).max(6),
    })
    .refine((t) => t.max >= t.min, 'the largest top-up must be at least the smallest'),
});

adminSupplyRouter.get('/settings', async (_req, res) => {
  res.json(await getSupplySettings());
});

adminSupplyRouter.put('/settings', async (req, res) => {
  const saved = await updateSupplySettings({ ...(await getSupplySettings()), ...supplySchema.parse(req.body) });
  await audit(req, 'update', 'number_supply', '', saved.enabled ? 'offered to customers' : 'not offered', null);
  res.json(saved);
});

const providerSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'use lowercase letters, digits and dashes'),
    name: z.string().trim().min(2, 'enter the provider name').max(80),
    prefix: z.string().trim().regex(/^\d{2,10}$/, 'digits only, like 09639'),
    length: z.number().int().min(4).max(15),
    enabled: z.boolean(),
    line: z.object({
      host: z.union([z.literal(''), z.string().trim().refine(isHost, 'must be a hostname or IPv4 address')]),
      port: z.number().int().min(1).max(65535),
      transport: z.enum(['udp', 'tcp', 'tls']),
    }),
  })
  .refine((p) => p.length > p.prefix.length, { message: 'a whole number must be longer than its prefix', path: ['length'] });

/**
 * The providers numbers come from (today ICC): name, number prefix, digits and SIP server of each. A
 * provider with requests in progress cannot be removed, only turned off.
 */
adminSupplyRouter.put('/providers', async (req, res) => {
  const { providers } = z.object({ providers: z.array(providerSchema).max(20) }).parse(req.body);
  const ids = providers.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Two providers cannot have the same id');
  if (new Set(providers.map((p) => p.prefix)).size !== providers.length) throw badRequest('Two providers cannot have the same prefix');
  const current = await getSupplySettings();
  for (const gone of current.providers.filter((p) => !ids.includes(p.id))) {
    if (await one("SELECT 1 FROM number_requests WHERE provider = $1 AND status IN ('submitted', 'in_review')", [gone.id])) {
      throw badRequest(`${gone.name} has requests in progress. Turn it off instead of removing it.`);
    }
  }
  const saved = await updateSupplySettings({ ...current, providers });
  await audit(req, 'update', 'number_providers', '', providers.map((p) => `${p.name} ${p.prefix}`).join(', ') || 'none', null);
  res.json(saved);
});

adminSupplyRouter.get('/summary', async (_req, res) => {
  res.json(await supplyCounts());
});

adminSupplyRouter.get('/requests', async (req, res) => {
  const filter = String(req.query.status ?? 'open');
  const where = filter === 'open' ? "WHERE r.status IN ('submitted', 'in_review')" : filter === 'all' ? '' : 'WHERE r.status = $1';
  res.json(
    await many(
      `SELECT r.id, r.status, r.provider, r.requested_number, r.special, r.reason, r.created_at, r.updated_at, r.details->>'name' AS subscriber_name,
              r.account_id, a.name AS account_name, r.tenant_id, t.name AS tenant_name, n.number AS connected_number
         FROM number_requests r JOIN accounts a ON a.id = r.account_id LEFT JOIN tenants t ON t.id = r.tenant_id
         LEFT JOIN numbers n ON n.id = r.number_id
        ${where} ORDER BY r.id DESC LIMIT 300`,
      where.includes('$1') ? [filter] : [],
    ),
  );
});

adminSupplyRouter.get('/requests/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const r = await one<Record<string, unknown> & { tenant_id: number | null; photo_file: string; id_file: string }>(
    `SELECT r.*, a.name AS account_name, a.email AS account_email, a.phone AS account_phone, t.name AS tenant_name,
            u.name AS created_by_name, d.name AS decided_by_name, n.number AS connected_number
       FROM number_requests r JOIN accounts a ON a.id = r.account_id LEFT JOIN tenants t ON t.id = r.tenant_id
       LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users d ON d.id = r.decided_by LEFT JOIN numbers n ON n.id = r.number_id
      WHERE r.id = $1`,
    [id],
  );
  if (!r) throw notFound('Request');
  const lines = r.tenant_id ? await many('SELECT id, name, host, username FROM trunks WHERE tenant_id = $1 ORDER BY id', [r.tenant_id]) : [];
  const { photo_file, id_file, ...rest } = r;
  res.json({ ...rest, has_photo: !!photo_file, id_type: id_file ? (id_file.endsWith('.pdf') ? 'pdf' : 'image') : null, lines });
});

/** The subscriber's photo or ID document, for support only. */
adminSupplyRouter.get('/requests/:id/files/:which', async (req, res) => {
  const column = req.params.which === 'photo' ? 'photo_file' : req.params.which === 'id' ? 'id_file' : null;
  if (!column) throw notFound('File');
  const r = await one<{ f: string }>(`SELECT ${column} AS f FROM number_requests WHERE id = $1`, [intParam(req.params.id)]);
  const doc = r?.f ? documentPath(r.f) : null;
  if (!doc) throw notFound('File');
  const data = await fs.readFile(doc.file).catch(() => null);
  if (!data) throw notFound('File');
  res.setHeader('Content-Type', doc.type);
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(doc.file)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
});

/** Support took the request: registering it with the operator. */
adminSupplyRouter.post('/requests/:id/review', async (req, res) => {
  const id = intParam(req.params.id);
  const n = await exec("UPDATE number_requests SET status = 'in_review', decided_by = $1, updated_at = now() WHERE id = $2 AND status = 'submitted'", [req.user!.id, id]);
  if (!n) throw badRequest('Only a new request can be marked as in progress');
  await audit(req, 'review', 'number_request', id, '', null);
  res.json({ ok: true });
});

adminSupplyRouter.post('/requests/:id/reject', async (req, res) => {
  const id = intParam(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'tell the customer why').max(300) }).parse(req.body ?? {});
  if (!(await closeRequest(id, '', [], { status: 'rejected', reason, by: req.user!.id }))) throw badRequest('This request is already closed');
  await audit(req, 'reject', 'number_request', id, reason, null);
  res.json({ ok: true });
});

const connectSchema = z.object({
  number: phoneNumber,
  label: z.string().trim().max(60).default(''),
  /** One of the SIP server's existing lines, or null for the number's own registration at the operator. */
  trunk_id: z.number().int().positive().nullable().default(null),
  username: z.string().trim().max(64).default(''),
  password: z.string().max(128).default(''),
});

/**
 * The operator registered the number: connect it to the customer's SIP server (its line, where it
 * rings, outgoing calls), and close the request.
 */
adminSupplyRouter.post('/requests/:id/connect', async (req, res) => {
  const id = intParam(req.params.id);
  const d = connectSchema.parse(req.body);
  const r = await one<{ status: string; tenant_id: number | null; pool_id: number | null; provider: string }>(
    'SELECT status, tenant_id, pool_id, provider FROM number_requests WHERE id = $1',
    [id],
  );
  if (!r) throw notFound('Request');
  if (!OPEN.includes(r.status)) throw badRequest('This request is already closed');
  if (!r.tenant_id) throw badRequest('The SIP server this request was for no longer exists');
  const s = await getSupplySettings();
  const p = s.providers.find((x) => x.id === r.provider) ?? providerOfNumber(s, d.number);
  const line = p?.line;
  if (!d.trunk_id && !line?.host) throw badRequest(`Add ${p?.name ?? 'the provider'}'s SIP server under Settings first`);
  if (!d.trunk_id && !d.password) throw badRequest(`Enter the number's password from ${p?.name ?? 'the provider'}`);
  const created = await connectLine(
    req,
    r.tenant_id,
    lineInput({
      number: d.number,
      label: d.label,
      trunk_id: d.trunk_id,
      provider: d.trunk_id || !line ? undefined : { host: line.host, port: line.port, transport: line.transport, auth_mode: 'register', username: d.username, password: d.password },
      ...(await defaultDestination(r.tenant_id)),
      outbound: true,
    }),
    `number request ${id}`,
  );
  await tx(async (db) => {
    await db.query("UPDATE number_requests SET status = 'connected', number_id = $1, decided_by = $2, reason = '', updated_at = now() WHERE id = $3", [created.number_id, req.user!.id, id]);
    // The reserved number is now taken; if a different one was given instead, the reserved one is free again.
    if (r.pool_id) await db.query("UPDATE number_pool SET status = 'available', updated_at = now() WHERE id = $1 AND number <> $2", [r.pool_id, d.number]);
    await db.query("UPDATE number_pool SET status = 'assigned', updated_at = now() WHERE number = $1", [d.number]);
  });
  await audit(req, 'connect', 'number_request', id, d.number, r.tenant_id);
  res.json({ ok: true, ...created });
});

adminSupplyRouter.get('/pool', async (req, res) => {
  const status = String(req.query.status ?? '');
  const valid = ['available', 'reserved', 'assigned'].includes(status);
  res.json(
    await many(
      `SELECT p.id, p.number, p.status, p.note, p.updated_at, r.id AS request_id, a.id AS account_id, a.name AS account_name
         FROM number_pool p
         LEFT JOIN number_requests r ON r.pool_id = p.id AND r.status IN ('submitted', 'in_review', 'connected')
         LEFT JOIN accounts a ON a.id = r.account_id
        ${valid ? 'WHERE p.status = $1' : ''} ORDER BY p.number LIMIT 3000`,
      valid ? [status] : [],
    ),
  );
});

/** Adds numbers to the pool: a range (as allocated by the operator) or a pasted list. Known ones are skipped. */
adminSupplyRouter.post('/pool', async (req, res) => {
  const d = z
    .union([
      z.object({ from: z.string().trim().regex(/^\d{6,15}$/, 'digits only'), to: z.string().trim().regex(/^\d{6,15}$/, 'digits only') }),
      z.object({ numbers: z.array(phoneNumber).min(1).max(5000) }),
    ])
    .parse(req.body);
  let numbers: string[];
  if ('from' in d) {
    if (d.from.length !== d.to.length) throw badRequest('Both ends of the range need the same number of digits');
    const a = Number(d.from);
    const b = Number(d.to);
    if (b < a) throw badRequest('The range ends before it starts');
    if (b - a >= 5000) throw badRequest('Add at most 5,000 numbers at a time');
    numbers = Array.from({ length: b - a + 1 }, (_, i) => String(a + i).padStart(d.from.length, '0'));
  } else {
    numbers = [...new Set(d.numbers)];
  }
  const s = await getSupplySettings();
  const stray = numbers.find((n) => providerOfNumber(s, n)?.length !== n.length);
  if (stray) {
    const known = s.providers.map((p) => `${p.prefix}… (${p.length} digits)`).join(', ') || 'none yet';
    throw badRequest(`${stray} is not a number of any provider (${known}). Add its provider under Settings first.`);
  }
  const added = await exec('INSERT INTO number_pool (number) SELECT unnest($1::text[]) ON CONFLICT (number) DO NOTHING', [numbers]);
  await audit(req, 'import', 'number_pool', '', `${added} of ${numbers.length}`, null);
  res.status(201).json({ added, skipped: numbers.length - added });
});

adminSupplyRouter.delete('/pool/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const n = await exec("DELETE FROM number_pool WHERE id = $1 AND status = 'available'", [id]);
  if (!n) throw badRequest('Only a free number can be removed from the pool');
  await audit(req, 'delete', 'number_pool', id, '', null);
  res.json({ ok: true });
});

adminSupplyRouter.get('/topups', async (req, res) => {
  const status = String(req.query.status ?? 'paid');
  const valid = ['awaiting_payment', 'paid', 'applied', 'cancelled'].includes(status);
  res.json(
    await many(
      `SELECT t.id, t.number, t.amount, t.status, t.note, t.created_at, t.applied_at, i.number AS invoice_number, i.paid_at,
              a.id AS account_id, a.name AS account_name, u.name AS applied_by_name
         FROM topups t JOIN invoices i ON i.id = t.invoice_id JOIN accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.applied_by
        ${valid ? 'WHERE t.status = $1' : ''} ORDER BY t.id DESC LIMIT 300`,
      valid ? [status] : [],
    ),
  );
});

/** Support added the paid amount to the number's balance at the operator. */
adminSupplyRouter.post('/topups/:id/applied', async (req, res) => {
  const id = intParam(req.params.id);
  const { note } = z.object({ note: z.string().trim().max(300).default('') }).parse(req.body ?? {});
  const n = await exec(
    "UPDATE topups SET status = 'applied', note = $1, applied_by = $2, applied_at = now(), updated_at = now() WHERE id = $3 AND status = 'paid'",
    [note, req.user!.id, id],
  );
  if (!n) throw badRequest('Only a paid top-up can be marked as added');
  await audit(req, 'apply', 'topup', id, note, null);
  res.json({ ok: true });
});
