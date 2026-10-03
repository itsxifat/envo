import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, exec, insertParts, updateSet } from '../db.js';
import { requireRole, tenantOf } from '../auth.js';
import { badRequest, forbidden, intParam, notFound } from '../lib/http.js';
import { assertDestination, audit, destTarget, destType, name } from '../lib/validate.js';
import { isHost, isIpOrCidr, isSipUser } from '../asterisk/sanitize.js';
import { scheduleApply } from '../asterisk/apply.js';
import { live } from '../asterisk/live.js';
import { trunkEndpoint, type Trunk } from '../asterisk/model.js';

const sipUser = z
  .string()
  .trim()
  .max(64)
  .refine((v) => v === '' || isSipUser(v), 'letters, digits and _ . + - only')
  .default('');

const trunkSchema = z
  .object({
    name,
    shared: z.boolean().default(false),
    host: z.string().trim().refine(isHost, 'must be a hostname or IPv4 address'),
    port: z.number().int().min(1).max(65535).default(5060),
    transport: z.enum(['udp', 'tcp', 'tls']).default('udp'),
    auth_mode: z.enum(['register', 'outbound', 'ip']).default('register'),
    username: sipUser,
    auth_username: sipUser,
    password: z.string().max(128).refine((v) => !/[\r\n]/.test(v), 'no line breaks').default(''),
    from_user: sipUser,
    from_domain: z.string().trim().refine((v) => v === '' || isHost(v), 'must be a hostname').default(''),
    contact_user: sipUser,
    register_expiry: z.number().int().min(60).max(7200).default(300),
    match_ips: z
      .string()
      .trim()
      .refine((v) => v.split(/[\s,]+/).filter(Boolean).every(isIpOrCidr), 'use IPv4 addresses or CIDR ranges')
      .default(''),
    codecs: z.string().trim().max(100).default('alaw,ulaw,g722'),
    dtmf_mode: z.enum(['rfc4733', 'inband', 'info', 'auto']).default('rfc4733'),
    max_channels: z.number().int().min(0).max(10000).default(0),
    qualify: z.boolean().default(false),
    send_pai: z.boolean().default(false),
    outbound_proxy: z
      .string()
      .trim()
      .refine((v) => v === '' || isHost(v.replace(/:\d+$/, '')), 'must be host or host:port')
      .default(''),
    default_dest_type: destType.default('hangup'),
    default_dest_target: destTarget,
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.auth_mode === 'register' && !v.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'is required to register' });
    // Web phones arrive from 127.0.0.1 (nginx); a trunk matching localhost would capture them.
    if (/^(localhost|127\.)/i.test(v.host)) ctx.addIssue({ code: 'custom', path: ['host'], message: 'cannot be this server' });
    if (v.match_ips.split(/[\s,]+/).some((ip) => ip && coversLoopback(ip))) {
      ctx.addIssue({ code: 'custom', path: ['match_ips'], message: 'cannot include 127.0.0.0/8' });
    }
  });

function coversLoopback(cidr: string): boolean {
  const [ip = '', bits = '32'] = cidr.split('/');
  const toInt = (a: string) => a.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const prefix = Number(bits);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt('127.0.0.1') & mask) >>> 0);
}

function present(trunk: Trunk) {
  const ep = trunkEndpoint(trunk);
  const reg = live.registrationOf(ep);
  const contact = live.contacts.find((c) => c.endpoint === ep);
  const { password, ...rest } = trunk;
  return {
    ...rest,
    password: '',
    has_password: password !== '',
    endpoint: ep,
    registration: reg ? { status: reg.status, nextRegSec: reg.nextRegSec } : null,
    reachability: contact ? { status: contact.status, rttMs: contact.rttMs } : null,
  };
}

async function loadTrunk(req: Request, write: boolean): Promise<Trunk> {
  const trunk = await one<Trunk>('SELECT * FROM trunks WHERE id = $1', [intParam(req.params.id)]);
  if (!trunk) throw notFound('Trunk');
  const user = req.user!;
  if (user.role !== 'superadmin') {
    if (trunk.tenant_id === null && write) throw forbidden('Shared trunks are managed by the platform administrator');
    if (trunk.tenant_id !== null && trunk.tenant_id !== user.tenantId) throw forbidden();
  }
  return trunk;
}

export const trunkRouter = Router();

trunkRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req, { required: false });
  const rows =
    tenantId === null
      ? await many<Trunk>('SELECT * FROM trunks ORDER BY id')
      : await many<Trunk>('SELECT * FROM trunks WHERE tenant_id IS NULL OR tenant_id = $1 ORDER BY id', [tenantId]);
  res.json(rows.map(present));
});

trunkRouter.get('/:id', async (req, res) => {
  res.json(present(await loadTrunk(req, false)));
});

async function validate(data: z.infer<typeof trunkSchema>, tenantId: number | null, hasStoredPassword: boolean) {
  if (data.auth_mode === 'register' && !data.password && !hasStoredPassword) {
    throw badRequest('password: is required to register');
  }
  if (data.default_dest_type !== 'hangup') {
    if (tenantId === null) throw badRequest('Shared trunks cannot have a catch-all destination; assign numbers instead');
    await assertDestination(tenantId, data.default_dest_type, data.default_dest_target, 'Catch-all destination');
  }
}

trunkRouter.post('/', requireRole('superadmin', 'admin'), async (req, res) => {
  const data = trunkSchema.parse(req.body);
  const user = req.user!;
  const tenantId = user.role === 'superadmin' ? (data.shared ? null : tenantOf(req)) : user.tenantId;
  await validate(data, tenantId, false);
  const { shared: _shared, ...fields } = data;
  const { cols, placeholders, values } = insertParts({ ...fields, tenant_id: tenantId });
  const row = await one<Trunk>(`INSERT INTO trunks (${cols}) VALUES (${placeholders}) RETURNING *`, values);
  await audit(req, 'create', 'trunk', row!.id, row!.name, tenantId);
  scheduleApply();
  res.status(201).json(present(row!));
});

trunkRouter.put('/:id', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await loadTrunk(req, true);
  const data = trunkSchema.parse(req.body);
  await validate(data, existing.tenant_id, existing.password !== '');
  const { shared: _shared, password, ...fields } = data;
  const patch: Record<string, unknown> = { ...fields, updated_at: new Date() };
  if (password) patch.password = password;
  if (data.auth_mode === 'ip') patch.password = '';
  const { clause, values } = updateSet(patch);
  const row = await one<Trunk>(`UPDATE trunks SET ${clause} WHERE id = $${values.length + 1} RETURNING *`, [...values, existing.id]);
  await audit(req, 'update', 'trunk', existing.id, data.name, existing.tenant_id);
  scheduleApply();
  res.json(present(row!));
});

trunkRouter.delete('/:id', requireRole('superadmin', 'admin'), async (req, res) => {
  const existing = await loadTrunk(req, true);
  const used = await one<{ count: number }>('SELECT count(*) AS count FROM outbound_routes WHERE $1 = ANY(trunk_ids)', [existing.id]);
  await exec('UPDATE outbound_routes SET trunk_ids = array_remove(trunk_ids, $1) WHERE $1 = ANY(trunk_ids)', [existing.id]);
  await exec('DELETE FROM trunks WHERE id = $1', [existing.id]);
  await audit(req, 'delete', 'trunk', existing.id, existing.name, existing.tenant_id);
  scheduleApply();
  res.json({ ok: true, routes_updated: used?.count ?? 0 });
});
