import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, exec, tx, insertParts, updateSet } from '../db.js';
import { requireRole, tenantOf, assertTenantAccess } from '../auth.js';
import { badRequest, conflict, forbidden, intParam, notFound } from '../lib/http.js';
import { assertNumberFree, audit, forwardTarget, internalNumber, name, optionalPhone } from '../lib/validate.js';
import { randomPassword, randomPin } from '../lib/secrets.js';
import { scheduleApply, syncExtensionState, clearExtensionState } from '../asterisk/apply.js';
import type { Extension } from '../asterisk/model.js';
import { getSettings } from '../settings.js';

const extensionSchema = z.object({
  number: internalNumber,
  name,
  webrtc: z.boolean().default(true),
  max_contacts: z.number().int().min(1).max(20).default(3),
  codecs: z.string().trim().max(100).default('g722,ulaw,alaw,opus'),
  outbound_cid: optionalPhone,
  allow_outbound: z.boolean().default(true),
  voicemail: z.boolean().default(true),
  voicemail_pin: z.union([z.literal(''), z.string().regex(/^[0-9]{4,10}$/, 'must be 4-10 digits')]).default(''),
  email: z.union([z.literal(''), z.email()]).default(''),
  recording: z.enum(['inherit', 'off', 'inbound', 'outbound', 'all']).default('inherit'),
  ring_timeout: z.number().int().min(5).max(300).default(25),
  dnd: z.boolean().default(false),
  forward_always: forwardTarget,
  forward_busy: forwardTarget,
  forward_noanswer: forwardTarget,
  enabled: z.boolean().default(true),
});

const createSchema = extensionSchema.extend({
  sip_username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.\-]{3,40}$/, 'use 3-40 letters, digits, _ . -')
    .refine((v) => !v.endsWith('_web') && !v.startsWith('trunk_'), 'this username is reserved')
    .optional(),
  sip_password: z.string().min(8).max(64).regex(/^[\x21-\x7E]+$/, 'printable ASCII without spaces').optional(),
});

const PUBLIC_COLUMNS =
  'id, tenant_id, number, name, sip_username, webrtc, max_contacts, codecs, outbound_cid, allow_outbound, voicemail, email, recording, ring_timeout, dnd, forward_always, forward_busy, forward_noanswer, enabled, created_at, updated_at';

async function loadExtension(req: Request): Promise<Extension> {
  const ext = await one<Extension>('SELECT * FROM extensions WHERE id = $1', [intParam(req.params.id)]);
  if (!ext) throw notFound('Extension');
  assertTenantAccess(req, ext.tenant_id);
  return ext;
}

async function assertCapacity(tenantId: number, adding: number): Promise<{ slug: string }> {
  const t = await one<{ slug: string; max_extensions: number; count: number }>(
    `SELECT slug, max_extensions, (SELECT count(*) FROM extensions WHERE tenant_id = $1) AS count FROM tenants WHERE id = $1`,
    [tenantId],
  );
  if (!t) throw notFound('SIP server');
  if (t.max_extensions > 0 && t.count + adding > t.max_extensions) {
    throw badRequest(`This SIP server is limited to ${t.max_extensions} extensions`);
  }
  return t;
}

export const extensionRouter = Router();

extensionRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req);
  res.json(await many(`SELECT ${PUBLIC_COLUMNS} FROM extensions WHERE tenant_id = $1 ORDER BY number`, [tenantId]));
});

/** Full details including SIP credentials and phone provisioning values. */
extensionRouter.get('/:id', async (req, res) => {
  const ext = await loadExtension(req);
  const user = req.user!;
  if (user.role === 'agent' && user.extensionId !== ext.id) throw forbidden();
  const settings = await getSettings();
  res.json({
    ...ext,
    provisioning: {
      domain: settings.sip_domain,
      server_ip: settings.public_ip,
      udp_port: 5060,
      tcp_port: 5060,
      tls_port: 5061,
      username: ext.sip_username,
      auth_username: ext.sip_username,
      password: ext.sip_password,
      voicemail_pin: ext.voicemail_pin,
    },
  });
});

extensionRouter.post('/', requireRole('superadmin', 'admin'), async (req, res) => {
  const tenantId = tenantOf(req)!;
  const data = createSchema.parse(req.body);
  const tenant = await assertCapacity(tenantId, 1);
  await assertNumberFree(tenantId, data.number);
  const sipUsername = data.sip_username ?? `${data.number}_${tenant.slug}`;
  if (await one('SELECT 1 FROM extensions WHERE sip_username = $1', [sipUsername])) {
    throw conflict(`SIP username ${sipUsername} is already in use`);
  }
  const row = {
    ...data,
    tenant_id: tenantId,
    sip_username: sipUsername,
    sip_password: data.sip_password ?? randomPassword(),
    voicemail_pin: data.voicemail_pin || randomPin(),
  };
  const { cols, placeholders, values } = insertParts(row);
  const ext = await one<Extension>(`INSERT INTO extensions (${cols}) VALUES (${placeholders}) RETURNING *`, values);
  await audit(req, 'create', 'extension', ext!.id, `${ext!.number} ${ext!.name}`, tenantId);
  scheduleApply();
  void syncExtensionState(ext!).catch(() => undefined);
  res.status(201).json(ext);
});

const bulkSchema = z.object({
  start: internalNumber,
  count: z.number().int().min(1).max(200),
  name_prefix: z.string().trim().max(40).default('Extension'),
  webrtc: z.boolean().default(true),
  voicemail: z.boolean().default(true),
});

extensionRouter.post('/bulk', requireRole('superadmin', 'admin'), async (req, res) => {
  const tenantId = tenantOf(req)!;
  const data = bulkSchema.parse(req.body);
  const tenant = await assertCapacity(tenantId, data.count);
  const width = data.start.length;
  const numbers = Array.from({ length: data.count }, (_, i) => String(Number(data.start) + i).padStart(width, '0'));
  if (numbers.some((n) => n.length > 8)) throw badRequest('Numbers would exceed 8 digits');
  for (const n of numbers) await assertNumberFree(tenantId, n);
  const created = await tx(async (db) => {
    const out: Extension[] = [];
    for (const n of numbers) {
      const { rows } = await db.query(
        `INSERT INTO extensions (tenant_id, number, name, sip_username, sip_password, voicemail_pin, webrtc, voicemail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tenantId, n, `${data.name_prefix} ${n}`.trim(), `${n}_${tenant.slug}`, randomPassword(), randomPin(), data.webrtc, data.voicemail],
      );
      out.push(rows[0]);
    }
    return out;
  });
  await audit(req, 'create', 'extension', `${numbers[0]}-${numbers.at(-1)}`, `bulk ${numbers.length}`, tenantId);
  scheduleApply();
  res.status(201).json({ created: created.length });
});

extensionRouter.put('/:id', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await loadExtension(req);
  const data = extensionSchema.parse(req.body);
  if (data.number !== existing.number) {
    await assertNumberFree(existing.tenant_id, data.number, { table: 'extensions', id: existing.id });
    await clearExtensionState(existing.tenant_id, existing.number);
  }
  const { clause, values } = updateSet({
    ...data,
    voicemail_pin: data.voicemail_pin || existing.voicemail_pin || randomPin(),
    updated_at: new Date(),
  });
  const ext = await one<Extension>(`UPDATE extensions SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [
    ...values,
    existing.id,
  ]);
  await audit(req, 'update', 'extension', existing.id, `${ext!.number} ${ext!.name}`, existing.tenant_id);
  scheduleApply();
  await syncExtensionState(ext!).catch(() => undefined);
  res.json(ext);
});

const stateSchema = z.object({
  dnd: z.boolean().optional(),
  forward_always: forwardTarget.optional(),
  forward_busy: forwardTarget.optional(),
  forward_noanswer: forwardTarget.optional(),
});

/** Quick call-handling toggles; agents may change their own extension. */
extensionRouter.patch('/:id/state', async (req, res) => {
  const existing = await loadExtension(req);
  const user = req.user!;
  if (user.role === 'agent' && user.extensionId !== existing.id) throw forbidden();
  const data = stateSchema.parse(req.body);
  const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return void res.json(existing);
  const { clause, values } = updateSet({ ...patch, updated_at: new Date() });
  const ext = await one<Extension>(`UPDATE extensions SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [
    ...values,
    existing.id,
  ]);
  await syncExtensionState(ext!);
  res.json(ext);
});

extensionRouter.post('/:id/reset-password', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await loadExtension(req);
  const password = randomPassword();
  await exec('UPDATE extensions SET sip_password = $1, updated_at = now() WHERE id = $2', [password, existing.id]);
  await audit(req, 'reset_password', 'extension', existing.id, existing.number, existing.tenant_id);
  scheduleApply();
  res.json({ sip_password: password });
});

extensionRouter.delete('/:id', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await loadExtension(req);
  await exec('DELETE FROM extensions WHERE id = $1', [existing.id]);
  await clearExtensionState(existing.tenant_id, existing.number);
  await audit(req, 'delete', 'extension', existing.id, `${existing.number} ${existing.name}`, existing.tenant_id);
  scheduleApply();
  res.json({ ok: true });
});
