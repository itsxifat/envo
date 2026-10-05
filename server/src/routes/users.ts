import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { many, one, exec } from '../db.js';
import { canAccessTenant, requireRole, hashPassword, tenantOf, type Role } from '../auth.js';
import { badRequest, conflict, forbidden, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { issueToken } from '../lib/tokens.js';
import { sendMail } from '../lib/mailer.js';
import { emails } from '../lib/emails.js';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { createExtension } from './extensions.js';

const userSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  name: z.string().trim().min(1).max(60),
  role: z.enum(['superadmin', 'admin', 'agent']),
  /** Platform admins choose the customer account; everyone else works in their own. */
  account_id: z.number().int().positive().nullable().default(null),
  tenant_id: z.number().int().positive().nullable().default(null),
  extension_id: z.number().int().positive().nullable().default(null),
  is_owner: z.boolean().default(false),
  enabled: z.boolean().default(true),
  password: z.string().min(8, 'must be at least 8 characters').max(128).optional(),
});

const createSchema = userSchema.extend({
  /** Email a link to choose a password instead of setting one now. */
  invite: z.boolean().default(false),
  /** Make a new extension for this person (next free number) instead of linking an existing one. */
  create_extension: z.boolean().default(false),
  /** SIP server for that new extension (default: the user's server, else the one being worked in). */
  extension_tenant_id: z.number().int().positive().nullable().default(null),
});

const COLUMNS =
  'u.id, u.email, u.name, u.role, u.account_id, u.is_owner, u.tenant_id, u.extension_id, u.enabled, u.last_login_at, u.created_at';

const INVITE_TTL = 7 * 24 * 3600_000;

interface UserRow {
  id: number;
  name: string;
  role: Role;
  account_id: number | null;
  tenant_id: number | null;
  is_owner: boolean;
  email: string;
}

interface ExtRef {
  id: number;
  number: string;
  tenant_id: number;
  account_id: number;
}

async function extensionRef(id: number): Promise<ExtRef> {
  const ext = await one<ExtRef>(
    'SELECT e.id, e.number, e.tenant_id, t.account_id FROM extensions e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = $1',
    [id],
  );
  if (!ext) throw badRequest('Extension not found');
  return ext;
}

async function normalize(req: Request, data: z.infer<typeof userSchema>, existing?: UserRow) {
  const actor = req.user!;
  const ext = data.extension_id ? await extensionRef(data.extension_id) : null;
  if (ext && !canAccessTenant(actor, ext.tenant_id)) throw forbidden();
  if (actor.role !== 'superadmin') {
    if (data.role === 'superadmin') throw forbidden('Only platform administrators can create platform administrators');
    data.account_id = actor.accountId;
    // Only the owner hands out (or takes away) ownership.
    if (!actor.isOwner) data.is_owner = existing?.is_owner ?? false;
    if (data.tenant_id !== null && !canAccessTenant(actor, data.tenant_id)) throw forbidden();
  }
  if (data.role === 'superadmin') {
    // Platform admins are not bound to an account; their extension may live in any SIP server.
    data.account_id = null;
    data.tenant_id = null;
    data.is_owner = false;
    return data;
  }
  // Agents work in the SIP server their phone is in; admins without a home server get that one.
  if (ext && (data.role === 'agent' || data.tenant_id === null)) data.tenant_id = ext.tenant_id;
  if (data.account_id === null && data.tenant_id !== null) {
    data.account_id = (await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [data.tenant_id]))?.account_id ?? null;
  }
  if (data.account_id === null && existing?.account_id) data.account_id = existing.account_id;
  if (data.account_id === null) throw badRequest('Choose the customer account this user belongs to');
  if (data.role === 'agent' && !data.tenant_id) throw badRequest('Select the SIP server this agent works in');
  if (data.tenant_id) {
    const t = await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [data.tenant_id]);
    if (!t || t.account_id !== data.account_id) throw badRequest('That SIP server belongs to another account');
  }
  if (ext && ext.account_id !== data.account_id) throw badRequest('The extension belongs to another account');
  if (data.role === 'agent') data.is_owner = false;
  return data;
}

async function load(req: Request): Promise<UserRow> {
  const row = await one<UserRow>('SELECT id, name, role, account_id, tenant_id, is_owner, email FROM users WHERE id = $1', [intParam(req.params.id)]);
  if (!row) throw notFound('User');
  const actor = req.user!;
  if (actor.role !== 'superadmin') {
    if (row.role === 'superadmin' || row.account_id !== actor.accountId) throw forbidden();
    if (row.is_owner && !actor.isOwner) throw forbidden('Only the account owner can change the owner');
  }
  return row;
}

/** A one-time "choose your password" link, emailed to the person and handed back to the admin. */
async function sendInvite(req: Request, user: { id: number; name: string; email: string; account_id: number | null; extension_id: number | null }) {
  const token = await issueToken(null, user.id, 'reset', INVITE_TTL);
  const url = `${config.publicUrl}/reset?invite=1&token=${token}`;
  const account = user.account_id ? await one<{ name: string }>('SELECT name FROM accounts WHERE id = $1', [user.account_id]) : null;
  const company = account?.name ?? (await getSettings()).company_name;
  const ext = user.extension_id ? await one<{ number: string }>('SELECT number FROM extensions WHERE id = $1', [user.extension_id]) : null;
  const status = await sendMail(emails.invite(user.email, user.name, req.user!.name, company, url, ext?.number ?? null));
  return { invite_url: url, invite_status: status };
}

export const userRouter = Router();
userRouter.use(requireRole('superadmin', 'admin'));

userRouter.get('/', async (req, res) => {
  const actor = req.user!;
  const rows =
    actor.role === 'superadmin'
      ? await many(
          `SELECT ${COLUMNS}, e.number AS extension_number, et.name AS extension_tenant_name, t.name AS tenant_name, a.name AS account_name
             FROM users u LEFT JOIN extensions e ON e.id = u.extension_id LEFT JOIN tenants et ON et.id = e.tenant_id
             LEFT JOIN tenants t ON t.id = u.tenant_id LEFT JOIN accounts a ON a.id = u.account_id
            ${req.query.account_id ? 'WHERE u.account_id = $1' : ''}
            ORDER BY u.id`,
          req.query.account_id ? [Number(req.query.account_id)] : [],
        )
      : await many(
          `SELECT ${COLUMNS}, e.number AS extension_number, et.name AS extension_tenant_name, t.name AS tenant_name
             FROM users u LEFT JOIN extensions e ON e.id = u.extension_id LEFT JOIN tenants et ON et.id = e.tenant_id
             LEFT JOIN tenants t ON t.id = u.tenant_id
            WHERE u.account_id = $1 ORDER BY u.is_owner DESC, u.id`,
          [actor.accountId],
        );
  res.json(rows);
});

/** Every extension the signed-in admin can hand out, across all SIP servers of the account. */
userRouter.get('/extensions', async (req, res) => {
  const actor = req.user!;
  const accountId = actor.role === 'superadmin' ? (req.query.account_id ? Number(req.query.account_id) : null) : actor.accountId;
  const rows = await many(
    `SELECT e.id, e.number, e.name, e.tenant_id, t.name AS tenant_name, t.account_id, a.name AS account_name,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.id) FROM users u WHERE u.extension_id = e.id), '[]') AS users
       FROM extensions e JOIN tenants t ON t.id = e.tenant_id JOIN accounts a ON a.id = t.account_id
      ${accountId ? 'WHERE t.account_id = $1' : ''}
      ORDER BY a.internal DESC, t.id, length(e.number), e.number`,
    accountId ? [accountId] : [],
  );
  res.json(rows);
});

userRouter.post('/', async (req, res) => {
  const parsed = createSchema.parse(req.body);
  const { invite, create_extension, extension_tenant_id, ...fields } = parsed;
  if (create_extension) fields.extension_id = null;
  const data = await normalize(req, fields);
  if (!invite && !data.password) throw badRequest('password: is required (or send an invite instead)');
  if (await one('SELECT 1 FROM users WHERE email = $1', [data.email])) throw conflict('This email is already used by another login');

  let created: { id: number; number: string } | null = null;
  if (create_extension) {
    const actor = req.user!;
    const tid = extension_tenant_id ?? data.tenant_id ?? tenantOf(req);
    if (!tid || !canAccessTenant(actor, tid)) throw forbidden();
    if (data.account_id !== null) {
      const t = await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [tid]);
      if (t?.account_id !== data.account_id) throw badRequest('That SIP server belongs to another account');
    }
    const ext = await createExtension(tid, { name: data.name, email: data.email });
    created = { id: ext.id, number: ext.number };
    data.extension_id = ext.id;
    if (data.role === 'agent' || (data.role === 'admin' && !data.tenant_id)) data.tenant_id = tid;
  }

  // Invited people choose their own password; until then nobody knows the random one.
  const password = data.password ?? crypto.randomBytes(24).toString('base64url');
  let row: { id: number } | null;
  try {
    row = await one<{ id: number }>(
      `INSERT INTO users (email, name, role, account_id, is_owner, tenant_id, extension_id, enabled, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now()) RETURNING id`,
      [data.email, data.name, data.role, data.account_id, data.is_owner, data.tenant_id, data.extension_id, data.enabled, await hashPassword(password)],
    );
  } catch (err) {
    if (created) await exec('DELETE FROM extensions WHERE id = $1', [created.id]).catch(() => undefined);
    throw err;
  }
  await audit(req, 'create', 'user', row!.id, data.email, data.tenant_id);
  const inviteResult = invite ? await sendInvite(req, { ...data, id: row!.id }) : null;
  res.status(201).json({ id: row!.id, extension: created, ...inviteResult });
});

userRouter.put('/:id', async (req, res) => {
  const existing = await load(req);
  const data = await normalize(req, userSchema.parse(req.body), existing);
  if (existing.id === req.user!.id && (data.role !== existing.role || !data.enabled || data.is_owner !== existing.is_owner)) {
    throw badRequest('You cannot change your own role, ownership or disable yourself');
  }
  await exec(
    `UPDATE users SET email = $1, name = $2, role = $3, account_id = $4, is_owner = $5, tenant_id = $6, extension_id = $7,
            enabled = $8, updated_at = now()
      WHERE id = $9`,
    [data.email, data.name, data.role, data.account_id, data.is_owner, data.tenant_id, data.extension_id, data.enabled, existing.id],
  );
  if (data.password) await exec('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(data.password), existing.id]);
  await audit(req, 'update', 'user', existing.id, data.email, data.tenant_id);
  res.json({ ok: true });
});

const linkSchema = z.union([
  z.object({ create: z.literal(true), tenant_id: z.number().int().positive().optional() }),
  z.object({ extension_id: z.number().int().positive().nullable() }),
]);

/**
 * Links a login to the extension it calls from (the web phone, voicemail and "my calls"), or makes a
 * new extension for it. Works for the signed-in admin's own login too.
 */
userRouter.put('/:id/extension', async (req, res) => {
  const target = await load(req);
  const actor = req.user!;
  const body = linkSchema.parse(req.body);
  let ext: ExtRef | null = null;
  if ('create' in body) {
    const tid = body.tenant_id ?? (target.role === 'agent' ? target.tenant_id : null) ?? tenantOf(req);
    if (!tid || !canAccessTenant(actor, tid)) throw forbidden();
    const t = await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [tid]);
    if (!t) throw notFound('SIP server');
    if (target.role !== 'superadmin' && t.account_id !== target.account_id) throw badRequest('That SIP server belongs to another account');
    const created = await createExtension(tid, { name: target.name, email: target.email });
    ext = { id: created.id, number: created.number, tenant_id: tid, account_id: t.account_id };
    await audit(req, 'create', 'extension', created.id, `${created.number} ${created.name}`, tid);
  } else if (body.extension_id) {
    ext = await extensionRef(body.extension_id);
    if (!canAccessTenant(actor, ext.tenant_id)) throw forbidden();
    if (target.role !== 'superadmin' && ext.account_id !== target.account_id) throw badRequest('The extension belongs to another account');
  }
  const tenantId = target.role === 'superadmin' ? null : ext && (target.role === 'agent' || !target.tenant_id) ? ext.tenant_id : target.tenant_id;
  await exec('UPDATE users SET extension_id = $1, tenant_id = $2, updated_at = now() WHERE id = $3', [ext?.id ?? null, tenantId, target.id]);
  await audit(req, 'link_extension', 'user', target.id, ext ? `${target.email} → ${ext.number}` : `${target.email} unlinked`, ext?.tenant_id ?? tenantId);
  res.json({ ok: true, extension: ext ? { id: ext.id, number: ext.number, tenant_id: ext.tenant_id } : null });
});

/** Sends (again) the "choose your password" link. */
userRouter.post('/:id/invite', async (req, res) => {
  const target = await load(req);
  if (target.id === req.user!.id) throw badRequest('Use "Change password" for your own login');
  const row = await one<{ extension_id: number | null }>('SELECT extension_id FROM users WHERE id = $1', [target.id]);
  const result = await sendInvite(req, { ...target, extension_id: row?.extension_id ?? null });
  await audit(req, 'invite', 'user', target.id, target.email, target.tenant_id);
  res.json(result);
});

userRouter.delete('/:id', async (req, res) => {
  const existing = await load(req);
  if (existing.id === req.user!.id) throw badRequest('You cannot delete yourself');
  if (existing.is_owner) {
    const owners = await one<{ count: number }>('SELECT count(*) AS count FROM users WHERE account_id = $1 AND is_owner', [existing.account_id]);
    if ((owners?.count ?? 0) <= 1) throw badRequest('An account needs an owner: make someone else the owner first');
  }
  await exec('DELETE FROM users WHERE id = $1', [existing.id]);
  await audit(req, 'delete', 'user', existing.id, existing.email, existing.tenant_id);
  res.json({ ok: true });
});
