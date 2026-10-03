import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { many, one, exec, tx, insertParts, updateSet } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, conflict, intParam, notFound, forbidden } from '../lib/http.js';
import { audit, optionalPhone } from '../lib/validate.js';
import { randomPassword, randomPin } from '../lib/secrets.js';
import { scheduleApply } from '../asterisk/apply.js';
import { ami } from '../asterisk/pbx.js';
import { config } from '../config.js';

export const TIMEZONE_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/;

const tenantSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9]{1,19}$/, 'must start with a letter and use only a-z, 0-9 (2-20 chars)')
    .optional(),
  description: z.string().trim().max(300).default(''),
  enabled: z.boolean().default(true),
  max_channels: z.number().int().min(0).max(10000).default(0),
  max_extensions: z.number().int().min(0).max(100000).default(0),
  outbound_cid: optionalPhone,
  recording: z.enum(['off', 'inbound', 'outbound', 'all']).default('off'),
  timezone: z.string().trim().regex(TIMEZONE_RE, 'invalid timezone').default('Asia/Dhaka'),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('en'),
});

const createSchema = tenantSchema.extend({
  quick_extensions: z
    .object({ start: z.string().regex(/^[0-9]{2,8}$/), count: z.number().int().min(1).max(200) })
    .optional(),
});

function slugify(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-z]/.test(s)) s = `s${s}`;
  return s.slice(0, 16) || 'server';
}

export const tenantRouter = Router();

tenantRouter.get('/', async (req, res) => {
  const user = req.user!;
  const where = user.role === 'superadmin' ? '' : 'WHERE t.id = $1';
  const rows = await many(
    `SELECT t.*,
       (SELECT count(*) FROM extensions e WHERE e.tenant_id = t.id) AS extension_count,
       (SELECT count(*) FROM numbers n WHERE n.tenant_id = t.id) AS number_count,
       (SELECT count(*) FROM trunks k WHERE k.tenant_id = t.id) AS trunk_count
     FROM tenants t ${where} ORDER BY t.id`,
    user.role === 'superadmin' ? [] : [user.tenantId],
  );
  res.json(rows);
});

tenantRouter.get('/:id', async (req, res) => {
  const id = intParam(req.params.id);
  if (req.user!.role !== 'superadmin' && req.user!.tenantId !== id) throw forbidden();
  const row = await one('SELECT * FROM tenants WHERE id = $1', [id]);
  if (!row) throw notFound('SIP server');
  res.json(row);
});

tenantRouter.post('/', requireRole('superadmin'), async (req, res) => {
  const { quick_extensions, ...data } = createSchema.parse(req.body);
  let slug = data.slug ?? slugify(data.name);
  if (!data.slug) {
    for (let i = 2; await one('SELECT 1 FROM tenants WHERE slug = $1', [slug]); i++) slug = `${slugify(data.name).slice(0, 14)}${i}`;
  } else if (await one('SELECT 1 FROM tenants WHERE slug = $1', [slug])) {
    throw conflict(`The short name "${slug}" is already taken`);
  }

  const tenant = await tx(async (db) => {
    const { cols, placeholders, values } = insertParts({ ...data, slug });
    const t = (await db.query(`INSERT INTO tenants (${cols}) VALUES (${placeholders}) RETURNING *`, values)).rows[0];
    if (quick_extensions) {
      const start = Number(quick_extensions.start);
      const width = quick_extensions.start.length;
      for (let i = 0; i < quick_extensions.count; i++) {
        const number = String(start + i).padStart(width, '0');
        if (number.length > 8) break;
        await db.query(
          `INSERT INTO extensions (tenant_id, number, name, sip_username, sip_password, voicemail_pin)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.id, number, `Extension ${number}`, `${number}_${slug}`, randomPassword(), randomPin()],
        );
      }
    }
    return t;
  });
  await audit(req, 'create', 'tenant', tenant.id, tenant.name, tenant.id);
  scheduleApply();
  res.status(201).json(tenant);
});

tenantRouter.put('/:id', requireRole('superadmin'), async (req, res) => {
  const id = intParam(req.params.id);
  const existing = await one<{ slug: string }>('SELECT slug FROM tenants WHERE id = $1', [id]);
  if (!existing) throw notFound('SIP server');
  const data = tenantSchema.parse(req.body);
  if (data.slug && data.slug !== existing.slug) throw badRequest('The short name cannot be changed after creation');
  const { slug: _ignored, ...rest } = data;
  const { clause, values } = updateSet({ ...rest, updated_at: new Date() });
  const row = await one(`UPDATE tenants SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
  await audit(req, 'update', 'tenant', id, data.name, id);
  scheduleApply();
  res.json(row);
});

tenantRouter.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const id = intParam(req.params.id);
  const t = await one<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [id]);
  if (!t) throw notFound('SIP server');
  const own = await one<{ tenant_id: number }>(
    'SELECT e.tenant_id FROM users u JOIN extensions e ON e.id = u.extension_id WHERE u.id = $1',
    [req.user!.id],
  );
  if (own?.tenant_id === id) throw badRequest('Your own web phone extension lives in this SIP server; link another one first');
  await exec('DELETE FROM tenants WHERE id = $1', [id]);
  await fs.rm(path.join(config.paths.soundsDir, `t${id}`), { recursive: true, force: true }).catch(() => undefined);
  if (ami.connected) await ami.action({ Action: 'DBDelTree', Family: `envo/t${id}` }).catch(() => undefined);
  await audit(req, 'delete', 'tenant', id, t.name, null);
  scheduleApply();
  res.json({ ok: true });
});
