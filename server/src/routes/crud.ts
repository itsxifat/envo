import { Router, type Request } from 'express';
import type { z } from 'zod';
import { many, one, exec, insertParts, updateSet } from '../db.js';
import { requireRole, tenantOf, assertTenantAccess, type Role } from '../auth.js';
import { intParam, notFound } from '../lib/http.js';
import { assertNumberFree, audit } from '../lib/validate.js';
import { scheduleApply } from '../asterisk/apply.js';

export interface CrudConfig<S extends z.ZodType<Record<string, unknown>>> {
  table: string;
  entity: string;
  schema: S;
  /** Columns stored as jsonb (arrays must be serialized explicitly for node-postgres). */
  jsonColumns?: string[];
  /** Entity has an internal dialable "number" that must be unique within the tenant. */
  hasNumber?: boolean;
  orderBy?: string;
  writeRoles?: Role[];
  validate?: (data: z.infer<S>, tenantId: number, req: Request, existingId?: number) => Promise<void>;
}

export function crudRouter<S extends z.ZodType<Record<string, unknown>>>(cfg: CrudConfig<S>): Router {
  const router = Router();
  const writeRoles = cfg.writeRoles ?? ['superadmin', 'admin'];
  const order = cfg.orderBy ?? 'id';

  const toColumns = (data: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...data };
    for (const col of cfg.jsonColumns ?? []) if (col in out) out[col] = JSON.stringify(out[col]);
    return out;
  };

  const load = async (req: Request) => {
    const row = await one<Record<string, unknown> & { tenant_id: number }>(`SELECT * FROM ${cfg.table} WHERE id = $1`, [
      intParam(req.params.id),
    ]);
    if (!row) throw notFound(cfg.entity);
    assertTenantAccess(req, row.tenant_id);
    return row;
  };

  router.get('/', async (req, res) => {
    const tenantId = tenantOf(req);
    res.json(await many(`SELECT * FROM ${cfg.table} WHERE tenant_id = $1 ORDER BY ${order}`, [tenantId]));
  });

  router.get('/:id', async (req, res) => {
    res.json(await load(req));
  });

  router.post('/', requireRole(...writeRoles), async (req, res) => {
    const tenantId = tenantOf(req)!;
    const data = cfg.schema.parse(req.body) as Record<string, unknown>;
    if (cfg.hasNumber && data.number) await assertNumberFree(tenantId, String(data.number));
    await cfg.validate?.(data as z.infer<S>, tenantId, req);
    const { cols, placeholders, values } = insertParts({ ...toColumns(data), tenant_id: tenantId });
    const row = await one<{ id: number; name?: string }>(
      `INSERT INTO ${cfg.table} (${cols}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    await audit(req, 'create', cfg.entity, row!.id, String(row!.name ?? ''), tenantId);
    scheduleApply();
    res.status(201).json(row);
  });

  router.put('/:id', requireRole(...writeRoles), async (req, res) => {
    const existing = await load(req);
    const data = cfg.schema.parse(req.body) as Record<string, unknown>;
    if (cfg.hasNumber && data.number) {
      await assertNumberFree(existing.tenant_id, String(data.number), { table: cfg.table, id: Number(existing.id) });
    }
    await cfg.validate?.(data as z.infer<S>, existing.tenant_id, req, Number(existing.id));
    const { clause, values } = updateSet({ ...toColumns(data), updated_at: new Date() });
    const row = await one(`UPDATE ${cfg.table} SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [
      ...values,
      existing.id,
    ]);
    await audit(req, 'update', cfg.entity, Number(existing.id), String(data.name ?? ''), existing.tenant_id);
    scheduleApply();
    res.json(row);
  });

  router.delete('/:id', requireRole(...writeRoles), async (req, res) => {
    const existing = await load(req);
    await exec(`DELETE FROM ${cfg.table} WHERE id = $1`, [existing.id]);
    await audit(req, 'delete', cfg.entity, Number(existing.id), String(existing.name ?? ''), existing.tenant_id);
    scheduleApply();
    res.json({ ok: true });
  });

  return router;
}
