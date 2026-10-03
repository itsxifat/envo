import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, exec } from '../db.js';
import { canAccessTenant, requireRole, hashPassword, type Role } from '../auth.js';
import { badRequest, forbidden, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';

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

const COLUMNS =
  'u.id, u.email, u.name, u.role, u.account_id, u.is_owner, u.tenant_id, u.extension_id, u.enabled, u.last_login_at, u.created_at';

interface UserRow {
  id: number;
  role: Role;
  account_id: number | null;
  tenant_id: number | null;
  is_owner: boolean;
  email: string;
}

async function normalize(req: Request, data: z.infer<typeof userSchema>, existing?: UserRow) {
  const actor = req.user!;
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
  } else {
    if (data.account_id === null && data.tenant_id !== null) {
      data.account_id = (await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [data.tenant_id]))?.account_id ?? null;
    }
    if (data.account_id === null) throw badRequest('Choose the customer account this user belongs to');
    if (data.role === 'agent' && !data.tenant_id) throw badRequest('Select the SIP server this agent works in');
    if (data.tenant_id) {
      const t = await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [data.tenant_id]);
      if (!t || t.account_id !== data.account_id) throw badRequest('That SIP server belongs to another account');
    }
    if (data.role === 'agent') data.is_owner = false;
  }
  if (data.extension_id) {
    const ext = await one<{ tenant_id: number; account_id: number }>(
      'SELECT e.tenant_id, t.account_id FROM extensions e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = $1',
      [data.extension_id],
    );
    if (!ext) throw badRequest('Extension not found');
    if (data.role === 'agent' && ext.tenant_id !== data.tenant_id) throw badRequest('The extension belongs to another SIP server');
    if (data.role === 'admin' && ext.account_id !== data.account_id) throw badRequest('The extension belongs to another account');
    if (data.role === 'admin' && !data.tenant_id) data.tenant_id = ext.tenant_id;
  }
  return data;
}

async function load(req: Request): Promise<UserRow> {
  const row = await one<UserRow>('SELECT id, role, account_id, tenant_id, is_owner, email FROM users WHERE id = $1', [intParam(req.params.id)]);
  if (!row) throw notFound('User');
  const actor = req.user!;
  if (actor.role !== 'superadmin') {
    if (row.role === 'superadmin' || row.account_id !== actor.accountId) throw forbidden();
    if (row.is_owner && !actor.isOwner) throw forbidden('Only the account owner can change the owner');
  }
  return row;
}

export const userRouter = Router();
userRouter.use(requireRole('superadmin', 'admin'));

userRouter.get('/', async (req, res) => {
  const actor = req.user!;
  const rows =
    actor.role === 'superadmin'
      ? await many(
          `SELECT ${COLUMNS}, e.number AS extension_number, t.name AS tenant_name, a.name AS account_name
             FROM users u LEFT JOIN extensions e ON e.id = u.extension_id LEFT JOIN tenants t ON t.id = u.tenant_id
             LEFT JOIN accounts a ON a.id = u.account_id
            ${req.query.account_id ? 'WHERE u.account_id = $1' : ''}
            ORDER BY u.id`,
          req.query.account_id ? [Number(req.query.account_id)] : [],
        )
      : await many(
          `SELECT ${COLUMNS}, e.number AS extension_number, t.name AS tenant_name
             FROM users u LEFT JOIN extensions e ON e.id = u.extension_id LEFT JOIN tenants t ON t.id = u.tenant_id
            WHERE u.account_id = $1 ORDER BY u.is_owner DESC, u.id`,
          [actor.accountId],
        );
  res.json(rows);
});

userRouter.post('/', async (req, res) => {
  const data = await normalize(req, userSchema.parse(req.body));
  if (!data.password) throw badRequest('password: is required');
  const row = await one<{ id: number }>(
    `INSERT INTO users (email, name, role, account_id, is_owner, tenant_id, extension_id, enabled, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [data.email, data.name, data.role, data.account_id, data.is_owner, data.tenant_id, data.extension_id, data.enabled, await hashPassword(data.password)],
  );
  await audit(req, 'create', 'user', row!.id, data.email, data.tenant_id);
  res.status(201).json({ id: row!.id });
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
