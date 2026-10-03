import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, exec, insertParts, updateSet } from '../db.js';
import { requireRole, tenantOf, assertTenantAccess } from '../auth.js';
import { badRequest, intParam, notFound } from '../lib/http.js';
import { assertDestination, audit, destTarget, destType, phoneNumber } from '../lib/validate.js';
import { scheduleApply } from '../asterisk/apply.js';
import type { PhoneNumber } from '../asterisk/model.js';

const routingSchema = z.object({
  label: z.string().trim().max(60).default(''),
  dest_type: destType.default('hangup'),
  dest_target: destTarget,
  cid_prefix: z.string().trim().max(20).default(''),
  recording: z.enum(['inherit', 'off', 'on']).default('inherit'),
});

const numberSchema = routingSchema.extend({
  number: phoneNumber,
  trunk_id: z.number().int().positive().nullable().default(null),
  max_channels: z.number().int().min(0).max(10000).default(0),
  enabled: z.boolean().default(true),
});

async function load(req: Request): Promise<PhoneNumber> {
  const row = await one<PhoneNumber>('SELECT * FROM numbers WHERE id = $1', [intParam(req.params.id)]);
  if (!row) throw notFound('Number');
  assertTenantAccess(req, row.tenant_id);
  return row;
}

async function assertTrunk(tenantId: number, trunkId: number | null): Promise<void> {
  if (!trunkId) return;
  const t = await one('SELECT 1 FROM trunks WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)', [trunkId, tenantId]);
  if (!t) throw badRequest('The selected trunk is not available to this SIP server');
}

export const numberRouter = Router();

numberRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req);
  res.json(
    await many(
      `SELECT n.*, k.name AS trunk_name FROM numbers n LEFT JOIN trunks k ON k.id = n.trunk_id
       WHERE n.tenant_id = $1 ORDER BY n.number`,
      [tenantId],
    ),
  );
});

numberRouter.post('/', requireRole('superadmin'), async (req, res) => {
  const tenantId = tenantOf(req)!;
  const data = numberSchema.parse(req.body);
  await assertTrunk(tenantId, data.trunk_id);
  await assertDestination(tenantId, data.dest_type, data.dest_target);
  const { cols, placeholders, values } = insertParts({ ...data, tenant_id: tenantId });
  const row = await one<PhoneNumber>(`INSERT INTO numbers (${cols}) VALUES (${placeholders}) RETURNING *`, values);
  await audit(req, 'create', 'number', row!.id, row!.number, tenantId);
  scheduleApply();
  res.status(201).json(row);
});

numberRouter.put('/:id', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await load(req);
  // SIP server admins may change routing; numbers, trunks and channels belong to the platform admin.
  const data = req.user!.role === 'superadmin' ? numberSchema.parse(req.body) : routingSchema.parse(req.body);
  if ('trunk_id' in data) await assertTrunk(existing.tenant_id, (data as { trunk_id: number | null }).trunk_id);
  await assertDestination(existing.tenant_id, data.dest_type, data.dest_target);
  const { clause, values } = updateSet({ ...data, updated_at: new Date() });
  const row = await one(`UPDATE numbers SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [...values, existing.id]);
  await audit(req, 'update', 'number', existing.id, existing.number, existing.tenant_id);
  scheduleApply();
  res.json(row);
});

numberRouter.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const existing = await load(req);
  await exec('DELETE FROM numbers WHERE id = $1', [existing.id]);
  await audit(req, 'delete', 'number', existing.id, existing.number, existing.tenant_id);
  scheduleApply();
  res.json({ ok: true });
});
