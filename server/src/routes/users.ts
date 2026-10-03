import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, exec } from '../db.js';
import { requireRole, hashPassword, type Role } from '../auth.js';
import { badRequest, forbidden, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';

const userSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  name: z.string().trim().min(1).max(60),
  role: z.enum(['superadmin', 'admin', 'agent']),
  tenant_id: z.number().int().positive().nullable().default(null),
  extension_id: z.number().int().positive().nullable().default(null),
  enabled: z.boolean().default(true),
  password: z.string().min(8, 'must be at least 8 characters').max(128).optional(),
});

const COLUMNS = 'u.id, u.email, u.name, u.role, u.tenant_id, u.extension_id, u.enabled, u.last_login_at, u.created_at';

interface UserRow {
  id: number;
  role: Role;
  tenant_id: number | null;
  email: string;
}

async function normalize(req: Request, data: z.infer<typeof userSchema>) {
  const actor = req.user!;
  if (actor.role !== 'superadmin') {
    if (data.role === 'superadmin') throw forbidden('Only platform administrators can create platform administrators');
    data.tenant_id = actor.tenantId;
  }
  if (data.role !== 'superadmin' && !data.tenant_id) throw badRequest('Select the SIP server this user belongs to');
  if (data.extension_id) {
    const ext = await one<{ tenant_id: number }>('SELECT tenant_id FROM extensions WHERE id = $1', [data.extension_id]);
    if (!ext) throw badRequest('Extension not found');
    if (data.role !== 'superadmin' && ext.tenant_id !== data.tenant_id) throw badRequest('The extension belongs to another SIP server');
  }
  // Platform admins are not bound to a tenant; their extension may live in any SIP server.
  if (data.role === 'superadmin') data.tenant_id = null;
  return data;
}

async function load(req: Request): Promise<UserRow> {
  const row = await one<UserRow>('SELECT id, role, tenant_id, email FROM users WHERE id = $1', [intParam(req.params.id)]);
  if (!row) throw notFound('User');
  const actor = req.user!;
  if (actor.role !== 'superadmin' && (row.tenant_id !== actor.tenantId || row.role === 'superadmin')) throw forbidden();
  return row;
}

export const userRouter = Router();
userRouter.use(requireRole('superadmin', 'admin'));

userRouter.get('/', async (req, res) => {
  const actor = req.user!;
  const rows =
    actor.role === 'superadmin'
      ? await many(
          `SELECT ${COLUMNS}, e.number AS extension_number, t.name AS tenant_name
             FROM users u LEFT JOIN extensions e ON e.id = u.extension_id LEFT JOIN tenants t ON t.id = u.tenant_id
            ORDER BY u.id`,
        )
      : await many(
          `SELECT ${COLUMNS}, e.number AS extension_number
             FROM users u LEFT JOIN extensions e ON e.id = u.extension_id WHERE u.tenant_id = $1 ORDER BY u.id`,
          [actor.tenantId],
        );
  res.json(rows);
});

userRouter.post('/', async (req, res) => {
  const data = await normalize(req, userSchema.parse(req.body));
  if (!data.password) throw badRequest('password: is required');
  const row = await one<{ id: number }>(
    `INSERT INTO users (email, name, role, tenant_id, extension_id, enabled, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [data.email, data.name, data.role, data.tenant_id, data.extension_id, data.enabled, await hashPassword(data.password)],
  );
  await audit(req, 'create', 'user', row!.id, data.email, data.tenant_id);
  res.status(201).json({ id: row!.id });
});

userRouter.put('/:id', async (req, res) => {
  const existing = await load(req);
  const data = await normalize(req, userSchema.parse(req.body));
  if (existing.id === req.user!.id && (data.role !== existing.role || !data.enabled)) {
    throw badRequest('You cannot change your own role or disable yourself');
  }
  await exec(
    `UPDATE users SET email = $1, name = $2, role = $3, tenant_id = $4, extension_id = $5, enabled = $6, updated_at = now()
      WHERE id = $7`,
    [data.email, data.name, data.role, data.tenant_id, data.extension_id, data.enabled, existing.id],
  );
  if (data.password) await exec('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(data.password), existing.id]);
  await audit(req, 'update', 'user', existing.id, data.email, data.tenant_id);
  res.json({ ok: true });
});

userRouter.delete('/:id', async (req, res) => {
  const existing = await load(req);
  if (existing.id === req.user!.id) throw badRequest('You cannot delete yourself');
  await exec('DELETE FROM users WHERE id = $1', [existing.id]);
  await audit(req, 'delete', 'user', existing.id, existing.email, existing.tenant_id);
  res.json({ ok: true });
});
