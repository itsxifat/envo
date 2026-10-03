import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { many, one, exec, insertParts, updateSet } from '../db.js';
import { requireRole, tenantOf, assertTenantAccess } from '../auth.js';
import { badRequest, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { API_SCOPES, generateApiKey } from '../lib/apikey.js';
import { CALL_EVENTS, deliver, sampleCallPayload } from '../webhooks.js';
import { config } from '../config.js';
import { resolvePublicUrl } from '../lib/net.js';
import { assertFeature } from '../billing/plan.js';

export const integrationRouter = Router();
integrationRouter.use(requireRole('superadmin', 'admin'));
integrationRouter.use(async (req, _res, next) => {
  try {
    if (req.user!.accountId !== null) await assertFeature(req.user!.accountId, 'api_access');
    next();
  } catch (err) {
    next(err);
  }
});

const KEY_COLUMNS = 'id, tenant_id, name, prefix, scopes, allowed_origins, last_used_at, requests, enabled, created_at';

const keySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'pick at least one permission').default(['read', 'calls', 'webphone']),
  allowed_origins: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v.split(/[\s,]+/).filter(Boolean).every((o) => o === '*' || /^https?:\/\/[^\s/]+$/.test(o)), 'use full origins like https://shop.example.com')
    .default(''),
  enabled: z.boolean().default(true),
});

integrationRouter.get('/keys', async (req, res) => {
  const tenantId = tenantOf(req);
  res.json(await many(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]));
});

integrationRouter.post('/keys', async (req, res) => {
  const tenantId = tenantOf(req)!;
  const data = keySchema.parse(req.body);
  const { key, prefix, hash } = generateApiKey();
  const { cols, placeholders, values } = insertParts({ ...data, tenant_id: tenantId, prefix, key_hash: hash });
  const row = await one<{ id: number }>(`INSERT INTO api_keys (${cols}) VALUES (${placeholders}) RETURNING ${KEY_COLUMNS}`, values);
  await audit(req, 'create', 'api_key', row!.id, data.name, tenantId);
  // The plaintext key is shown once and never stored.
  res.status(201).json({ ...row, key });
});

async function loadKey(req: Request) {
  const row = await one<{ id: number; tenant_id: number; name: string }>('SELECT id, tenant_id, name FROM api_keys WHERE id = $1', [
    intParam(req.params.id),
  ]);
  if (!row) throw notFound('API key');
  assertTenantAccess(req, row.tenant_id);
  return row;
}

integrationRouter.put('/keys/:id', async (req, res) => {
  const existing = await loadKey(req);
  const data = keySchema.parse(req.body);
  const { clause, values } = updateSet({ ...data, updated_at: new Date() });
  const row = await one(`UPDATE api_keys SET ${clause} WHERE id = $${values.length + 1} RETURNING ${KEY_COLUMNS}`, [
    ...values,
    existing.id,
  ]);
  await audit(req, 'update', 'api_key', existing.id, data.name, existing.tenant_id);
  res.json(row);
});

integrationRouter.delete('/keys/:id', async (req, res) => {
  const existing = await loadKey(req);
  await exec('DELETE FROM api_keys WHERE id = $1', [existing.id]);
  await audit(req, 'delete', 'api_key', existing.id, existing.name, existing.tenant_id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ webhooks
const webhookSchema = z.object({
  name: z.string().trim().max(60).default(''),
  url: z.string().trim().regex(/^https?:\/\/[^\s]+$/, 'must be an http(s) URL').max(500),
  events: z.array(z.enum(['call.started', 'call.answered', 'call.ended'])).min(1, 'pick at least one event').default(CALL_EVENTS),
  enabled: z.boolean().default(true),
});

integrationRouter.get('/webhooks', async (req, res) => {
  const tenantId = tenantOf(req);
  res.json(
    await many(
      `SELECT w.*, (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS deliveries,
              (SELECT max(created_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS last_delivery_at,
              (SELECT status FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY id DESC LIMIT 1) AS last_status
         FROM webhooks w WHERE w.tenant_id = $1 ORDER BY w.created_at DESC`,
      [tenantId],
    ),
  );
});

async function assertReachable(url: string): Promise<void> {
  const check = await resolvePublicUrl(url);
  if (!check.ok) throw badRequest(`url: ${check.reason}`);
}

integrationRouter.post('/webhooks', async (req, res) => {
  const tenantId = tenantOf(req)!;
  const data = webhookSchema.parse(req.body);
  await assertReachable(data.url);
  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
  const { cols, placeholders, values } = insertParts({ ...data, tenant_id: tenantId, secret });
  const row = await one(`INSERT INTO webhooks (${cols}) VALUES (${placeholders}) RETURNING *`, values);
  await audit(req, 'create', 'webhook', (row as { id: number }).id, data.url, tenantId);
  res.status(201).json(row);
});

async function loadWebhook(req: Request) {
  const row = await one<{ id: number; tenant_id: number; url: string; secret: string; events: string[] }>(
    'SELECT * FROM webhooks WHERE id = $1',
    [intParam(req.params.id)],
  );
  if (!row) throw notFound('Webhook');
  assertTenantAccess(req, row.tenant_id);
  return row;
}

integrationRouter.put('/webhooks/:id', async (req, res) => {
  const existing = await loadWebhook(req);
  const data = webhookSchema.parse(req.body);
  await assertReachable(data.url);
  const { clause, values } = updateSet({ ...data, updated_at: new Date() });
  const row = await one(`UPDATE webhooks SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [...values, existing.id]);
  await audit(req, 'update', 'webhook', existing.id, data.url, existing.tenant_id);
  res.json(row);
});

integrationRouter.delete('/webhooks/:id', async (req, res) => {
  const existing = await loadWebhook(req);
  await exec('DELETE FROM webhooks WHERE id = $1', [existing.id]);
  await audit(req, 'delete', 'webhook', existing.id, existing.url, existing.tenant_id);
  res.json({ ok: true });
});

integrationRouter.post('/webhooks/:id/test', async (req, res) => {
  const hook = await loadWebhook(req);
  await deliver(hook, 'call.ended', sampleCallPayload());
  const last = await one('SELECT status, error, attempts, duration_ms, created_at FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 1', [
    hook.id,
  ]);
  res.json({ ok: true, delivery: last });
});

integrationRouter.get('/webhooks/:id/deliveries', async (req, res) => {
  const hook = await loadWebhook(req);
  res.json(
    await many(
      'SELECT id, event, status, error, attempts, duration_ms, created_at FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 20',
      [hook.id],
    ),
  );
});

/** Ready-made snippets for the dashboard's integration guide. */
integrationRouter.get('/examples', async (req, res) => {
  const tenantId = tenantOf(req);
  const ext = await one<{ number: string }>('SELECT number FROM extensions WHERE tenant_id = $1 ORDER BY number LIMIT 1', [tenantId]);
  res.json({
    baseUrl: `https://${config.publicHost}`,
    sampleExtension: ext?.number ?? '1000',
    embedScript: `https://${config.publicHost}/embed/phone.js`,
  });
});
