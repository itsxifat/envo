import { accountOfTenant, assertLimit } from '../billing/plan.js';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, exec, tx, insertParts, updateSet } from '../db.js';
import { requireRole, tenantOf, assertTenantAccess } from '../auth.js';
import { HttpError, badRequest, conflict, forbidden, intParam, notFound } from '../lib/http.js';
import { assertNumberFree, audit, forwardTarget, internalNumber, name, optionalPhone } from '../lib/validate.js';
import { keypadPassword, randomPassword, randomPin, sipPasswordProblem } from '../lib/secrets.js';
import { scheduleApply, syncExtensionState, clearExtensionState } from '../asterisk/apply.js';
import type { Extension } from '../asterisk/model.js';
import { getSettings } from '../settings.js';
import { sendMail } from '../lib/mailer.js';
import { emails } from '../lib/emails.js';

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

const sipUsername = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.\-]{3,40}$/, 'use 3-40 letters, digits, _ . -')
  .refine((v) => !v.endsWith('_web') && !v.startsWith('trunk_'), 'this username is reserved');

const createSchema = extensionSchema.extend({
  sip_username: sipUsername.optional(),
  sip_password: z.string().optional(),
  /** strong: 20 random letters/digits; keypad: 10 random digits, quick to type on a desk phone. */
  password_style: z.enum(['strong', 'keypad']).default('strong'),
});

const updateSchema = extensionSchema.extend({ sip_username: sipUsername.optional() });

/** The SIP password to store: the admin's own (checked) or a generated one. */
function sipPassword(input: { sip_password?: string; password_style?: 'strong' | 'keypad' }, ctx: { username: string; number: string }): string {
  if (input.sip_password) {
    const problem = sipPasswordProblem(input.sip_password, ctx);
    if (problem) throw badRequest(`SIP password: ${problem}`);
    return input.sip_password;
  }
  return input.password_style === 'keypad' ? keypadPassword() : randomPassword();
}

async function assertUsernameFree(username: string, exceptId?: number): Promise<void> {
  const row = await one<{ id: number }>('SELECT id FROM extensions WHERE lower(sip_username) = lower($1)', [username]);
  if (row && row.id !== exceptId) throw conflict(`SIP username ${username} is already in use`);
}

const PUBLIC_COLUMNS =
  'id, tenant_id, number, name, sip_username, webrtc, max_contacts, codecs, outbound_cid, allow_outbound, voicemail, email, recording, ring_timeout, dnd, forward_always, forward_busy, forward_noanswer, enabled, created_at, updated_at';

async function loadExtension(req: Request): Promise<Extension> {
  const ext = await one<Extension>('SELECT * FROM extensions WHERE id = $1', [intParam(req.params.id)]);
  if (!ext) throw notFound('Extension');
  assertTenantAccess(req, ext.tenant_id);
  return ext;
}

async function assertCapacity(tenantId: number, adding: number): Promise<{ slug: string }> {
  await assertLimit(await accountOfTenant(tenantId), 'max_extensions', adding);
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

/**
 * The next free internal number of a SIP server: one after its highest extension (same width), or
 * 101 for an empty server. Skips numbers taken by ring groups, queues, IVRs and conference rooms.
 */
export async function nextExtensionNumber(tenantId: number): Promise<string> {
  const used = new Set(
    (
      await many<{ number: string | null }>(
        `SELECT number FROM extensions WHERE tenant_id = $1 UNION SELECT number FROM ring_groups WHERE tenant_id = $1
         UNION SELECT number FROM queues WHERE tenant_id = $1 UNION SELECT number FROM ivrs WHERE tenant_id = $1
         UNION SELECT number FROM conferences WHERE tenant_id = $1`,
        [tenantId],
      )
    ).map((r) => r.number),
  );
  const exts = (await many<{ number: string }>('SELECT number FROM extensions WHERE tenant_id = $1', [tenantId])).map((r) => r.number).filter((n) => /^\d+$/.test(n));
  const highest = exts.reduce<string | null>((a, n) => (a === null || Number(n) > Number(a) ? n : a), null);
  const width = highest?.length ?? 3;
  for (let n = highest ? Number(highest) + 1 : 101; String(n).length <= 8; n++) {
    const candidate = String(n).padStart(width, '0');
    if (!used.has(candidate)) return candidate;
  }
  throw badRequest('There is no free extension number left in this SIP server');
}

/** Creates an extension with the next free number (or the given one) and strong random secrets. */
export async function createExtension(tenantId: number, input: { number?: string; name: string; email?: string }): Promise<Extension> {
  const tenant = await assertCapacity(tenantId, 1);
  const number = input.number ?? (await nextExtensionNumber(tenantId));
  await assertNumberFree(tenantId, number);
  const sipUsername = `${number}_${tenant.slug}`;
  if (await one('SELECT 1 FROM extensions WHERE sip_username = $1', [sipUsername])) throw conflict(`SIP username ${sipUsername} is already in use`);
  const ext = await one<Extension>(
    `INSERT INTO extensions (tenant_id, number, name, sip_username, sip_password, voicemail_pin, email)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenantId, number, input.name.slice(0, 60), sipUsername, randomPassword(), randomPin(), input.email ?? ''],
  );
  scheduleApply();
  void syncExtensionState(ext!).catch(() => undefined);
  return ext!;
}

export const extensionRouter = Router();

extensionRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req);
  // Admins also see who uses each extension (the logins linked to it).
  const users =
    req.user!.role === 'agent'
      ? ''
      : `, COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role) ORDER BY u.id)
                       FROM users u WHERE u.extension_id = e.id), '[]') AS users`;
  res.json(await many(`SELECT ${PUBLIC_COLUMNS}${users} FROM extensions e WHERE tenant_id = $1 ORDER BY length(number), number`, [tenantId]));
});

/** The number "Add extension" suggests. */
extensionRouter.get('/next-number', requireRole('superadmin', 'admin'), async (req, res) => {
  res.json({ number: await nextExtensionNumber(tenantOf(req)!) });
});

/** Full details including SIP credentials and phone provisioning values. */
extensionRouter.get('/:id', async (req, res) => {
  const ext = await loadExtension(req);
  const user = req.user!;
  if (user.role === 'agent' && user.extensionId !== ext.id) throw forbidden();
  const settings = await getSettings();
  const internal = !!(await one('SELECT 1 FROM tenants t JOIN accounts a ON a.id = t.account_id WHERE t.id = $1 AND a.internal', [ext.tenant_id]));
  res.json({
    ...ext,
    provisioning: {
      domain: settings.sip_domain,
      server_ip: settings.public_ip,
      office_host: user.role === 'superadmin' || internal ? settings.office_sip_host : '',
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
  const { password_style, ...data } = createSchema.parse(req.body);
  const tenant = await assertCapacity(tenantId, 1);
  await assertNumberFree(tenantId, data.number);
  const username = data.sip_username ?? `${data.number}_${tenant.slug}`;
  await assertUsernameFree(username);
  const row = {
    ...data,
    tenant_id: tenantId,
    sip_username: username,
    sip_password: sipPassword({ sip_password: data.sip_password, password_style }, { username, number: data.number }),
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
  password_style: z.enum(['strong', 'keypad']).default('strong'),
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
        [tenantId, n, `${data.name_prefix} ${n}`.trim(), `${n}_${tenant.slug}`, data.password_style === 'keypad' ? keypadPassword() : randomPassword(), randomPin(), data.webrtc, data.voicemail],
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
  const { sip_username: newUsername, ...data } = updateSchema.parse(req.body);
  // Advanced: a shorter username for typing on desk phones. Phones using the old one must be updated.
  const renamed = newUsername !== undefined && newUsername !== existing.sip_username;
  if (renamed) await assertUsernameFree(newUsername, existing.id);
  if (data.number !== existing.number) {
    await assertNumberFree(existing.tenant_id, data.number, { table: 'extensions', id: existing.id });
    await clearExtensionState(existing.tenant_id, existing.number);
  }
  const { clause, values } = updateSet({
    ...data,
    ...(renamed ? { sip_username: newUsername } : {}),
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

/** Emails the phone settings to the person using the extension (or any address). */
extensionRouter.post('/:id/send-setup', requireRole('superadmin', 'admin'), async (req, res) => {
  const ext = await loadExtension(req);
  const { to } = z.object({ to: z.union([z.literal(''), z.email()]).default('') }).parse(req.body ?? {});
  const linked = await one<{ email: string }>('SELECT email FROM users WHERE extension_id = $1 ORDER BY id LIMIT 1', [ext.id]);
  const address = (to || ext.email || linked?.email || '').toLowerCase();
  if (!address) throw badRequest('Enter the email address to send the phone settings to');
  const settings = await getSettings();
  const status = await sendMail(
    emails.phoneSetup(address, {
      name: ext.name,
      number: ext.number,
      domain: settings.sip_domain,
      username: ext.sip_username,
      password: ext.sip_password,
      udp: 5060,
      tls: 5061,
      voicemailPin: ext.voicemail ? ext.voicemail_pin : '',
    }),
  );
  if (status === 'failed') throw new HttpError(502, 'The email could not be sent. Check the email settings, or copy the settings instead.');
  await audit(req, 'send_setup', 'extension', ext.id, `${ext.number} to ${address}`, ext.tenant_id);
  res.json({ status, to: address });
});

const passwordSchema = z.union([
  z.object({ style: z.enum(['strong', 'keypad']) }),
  z.object({ password: z.string().min(1) }),
]);

/** Sets the desk-phone password: the admin's own, or a new strong or keypad-friendly one. */
extensionRouter.put('/:id/password', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await loadExtension(req);
  const body = passwordSchema.parse(req.body);
  const password = sipPassword('password' in body ? { sip_password: body.password } : { password_style: body.style }, {
    username: existing.sip_username,
    number: existing.number,
  });
  await exec('UPDATE extensions SET sip_password = $1, updated_at = now() WHERE id = $2', [password, existing.id]);
  await audit(req, 'change_password', 'extension', existing.id, existing.number, existing.tenant_id);
  scheduleApply();
  res.json({ sip_password: password });
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
