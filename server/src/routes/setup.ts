import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { exec, many, one, tx, insertParts } from '../db.js';
import { hashPassword, requireRole, tenantOf } from '../auth.js';
import { accountOfTenant, assertLimit } from '../billing/plan.js';
import { badRequest, conflict } from '../lib/http.js';
import { assertDestination, audit, destTarget, destType, phoneNumber } from '../lib/validate.js';
import { clearExtensionState, scheduleApply } from '../asterisk/apply.js';
import { live } from '../asterisk/live.js';
import { webEndpoint } from '../asterisk/model.js';
import { assertPublicProvider, trunkSchema, validate as validateTrunk } from './trunks.js';
import { lineHealth } from './adminConsole.js';
import { createExtension, nextExtensionNumber } from './extensions.js';
import { sendInvite } from './users.js';

/**
 * The guided setup ("Get started"): one place that knows how far a SIP server is from taking calls,
 * plus the few combined actions that would otherwise take several pages (a number with its provider
 * line and outgoing-call rule, routing every number at once, a "ring everyone" group).
 */
export const setupRouter = Router();

const ONLINE = new Set(['Reachable', 'NonQualified', 'Created', 'Updated', 'Unknown']);

/** Numbers in Bangladesh: mobile, landline / IP numbers, and the +880 forms. International stays off. */
export const LOCAL_CALL_PATTERNS = ['01[3-9]XXXXXXXX', '0[2-9]XXXXXXX.', '+880XXXXXXXXXX', '880XXXXXXXXXX'];

setupRouter.get('/status', async (req, res) => {
  const tenantId = tenantOf(req)!;
  const [exts, people, numbers, lines, routes, called, tenant] = await Promise.all([
    many<{ id: number; number: string; name: string; sip_username: string; webrtc: boolean }>(
      'SELECT id, number, name, sip_username, webrtc FROM extensions WHERE tenant_id = $1 AND enabled ORDER BY length(number), number',
      [tenantId],
    ),
    one<{ count: number }>('SELECT count(*) AS count FROM users u JOIN extensions e ON e.id = u.extension_id WHERE e.tenant_id = $1', [tenantId]),
    many<{ id: number; number: string; label: string; trunk_id: number | null; dest_type: string; dest_target: string }>(
      'SELECT id, number, label, trunk_id, dest_type, dest_target FROM numbers WHERE tenant_id = $1 ORDER BY number',
      [tenantId],
    ),
    many<Parameters<typeof lineHealth>[0]>(
      'SELECT id, name, host, port, auth_mode, username, enabled, qualify, tenant_id FROM trunks WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY id',
      [tenantId],
    ),
    one<{ count: number }>('SELECT count(*) AS count FROM outbound_routes WHERE tenant_id = $1 AND enabled', [tenantId]),
    one<{ yes: boolean }>('SELECT EXISTS (SELECT 1 FROM cdr WHERE accountcode = $1) AS yes', [`t${tenantId}`]),
    one<{ default_dest_type: string; default_dest_target: string }>('SELECT default_dest_type, default_dest_target FROM tenants WHERE id = $1', [tenantId]),
  ]);
  // The choice from the guided setup counts only while what it points at still exists.
  const chosen =
    tenant?.default_dest_type && (await assertDestination(tenantId, tenant.default_dest_type, tenant.default_dest_target).then(() => true, () => false))
      ? { dest_type: tenant.default_dest_type, dest_target: tenant.default_dest_target }
      : null;
  const onlineEp = new Set(live.contacts.filter((c) => ONLINE.has(c.status)).map((c) => c.endpoint));
  const online = exts.filter((e) => onlineEp.has(e.sip_username) || (e.webrtc && onlineEp.has(webEndpoint(e)))).length;
  const lineStates = lines.map((l) => ({ id: l.id, name: l.name, host: l.host, shared: l.tenant_id === null, ...lineHealth(l) }));
  res.json({
    extensions: exts.length,
    // Provisioning names spare extensions "Extension 102"; a real name means someone set them up.
    named: exts.filter((e) => !/^Extension \d+$/.test(e.name)).length,
    people: people?.count ?? 0,
    online,
    numbers: numbers.map((n) => ({ ...n, line: lineStates.find((l) => l.id === n.trunk_id) ?? null })),
    lines: lineStates.filter((l) => !l.shared),
    outbound_routes: routes?.count ?? 0,
    routed: numbers.length > 0 && numbers.every((n) => n.dest_type !== 'hangup'),
    // Where numbers ring, chosen in the guided setup (also before the first number arrives).
    default_dest: chosen,
    has_calls: called?.yes ?? false,
  });
});

const providerSchema = z.object({
  host: z.string().trim().min(1, 'enter the server address your provider gave you'),
  port: z.number().int().min(1).max(65535).default(5060),
  transport: z.enum(['udp', 'tcp', 'tls']).default('udp'),
  auth_mode: z.enum(['register', 'outbound', 'ip']).default('register'),
  /** Defaults to the phone number, which is what most IPTSPs use. */
  username: z.string().trim().max(64).default(''),
  password: z.string().max(128).default(''),
});

const lineSchema = z.object({
  number: phoneNumber,
  label: z.string().trim().max(60).default(''),
  /** Add the number to one of this SIP server's existing lines instead of a new one. */
  trunk_id: z.number().int().positive().nullable().default(null),
  provider: providerSchema.optional(),
  dest_type: destType.default('hangup'),
  dest_target: destTarget,
  /** Also make an outgoing-call rule over this line when the server has none yet. */
  outbound: z.boolean().default(true),
});

export type LineInput = z.infer<typeof lineSchema>;
export const lineInput = (body: unknown): LineInput => lineSchema.parse(body);

/**
 * Where a new number rings: the choice made in the guided setup (while it still exists), else where
 * the other numbers ring, else the first extension.
 */
export async function defaultDestination(tenantId: number): Promise<{ dest_type: string; dest_target: string }> {
  const chosen = await one<{ dest_type: string; dest_target: string }>(
    "SELECT default_dest_type AS dest_type, default_dest_target AS dest_target FROM tenants WHERE id = $1 AND default_dest_type <> ''",
    [tenantId],
  );
  if (chosen && (await assertDestination(tenantId, chosen.dest_type, chosen.dest_target).then(() => true, () => false))) return chosen;
  const routed = await one<{ dest_type: string; dest_target: string }>(
    "SELECT dest_type, dest_target FROM numbers WHERE tenant_id = $1 AND dest_type <> 'hangup' ORDER BY id LIMIT 1",
    [tenantId],
  );
  if (routed) return routed;
  const ext = await one<{ number: string }>('SELECT number FROM extensions WHERE tenant_id = $1 AND enabled ORDER BY length(number), number LIMIT 1', [tenantId]);
  return ext ? { dest_type: 'extension', dest_target: ext.number } : { dest_type: 'hangup', dest_target: '' };
}

/**
 * Connects a phone number to a SIP server: its provider line (new or existing), where its calls ring
 * and, for the server's first number, outgoing calls. Used by the guided setup, and by support when a
 * number a customer asked for arrives.
 */
export async function connectLine(req: Request, tenantId: number, d: LineInput, source = 'guided setup'): Promise<{ trunk_id: number | null; number_id: number; route_id: number | null }> {
  await assertLimit(await accountOfTenant(tenantId), 'max_dids');
  if (await one('SELECT 1 FROM numbers WHERE number = $1', [d.number])) {
    throw conflict(`${d.number} is already connected to a SIP server. If it is yours, contact support.`);
  }
  await assertDestination(tenantId, d.dest_type, d.dest_target);

  let trunk: z.infer<typeof trunkSchema> | null = null;
  if (d.trunk_id) {
    if (!(await one('SELECT 1 FROM trunks WHERE id = $1 AND tenant_id = $2', [d.trunk_id, tenantId]))) throw badRequest('Choose one of your own lines');
  } else {
    if (!d.provider) throw badRequest('Enter the details your provider gave you');
    const p = d.provider;
    trunk = trunkSchema.parse({
      name: (d.label ? `${d.label} line` : `Line ${d.number}`).slice(0, 60),
      host: p.host,
      port: p.port,
      transport: p.transport,
      auth_mode: p.auth_mode,
      username: p.auth_mode === 'ip' ? '' : p.username || d.number.replace(/^\+/, ''),
      password: p.auth_mode === 'ip' ? '' : p.password,
    });
    if (req.user!.role !== 'superadmin') await assertPublicProvider(trunk);
    await validateTrunk(trunk, tenantId, false);
  }

  const created = await tx(async (db) => {
    let trunkId = d.trunk_id;
    if (trunk) {
      const { shared: _shared, ...fields } = trunk;
      const t = insertParts({ ...fields, tenant_id: tenantId });
      trunkId = (await db.query<{ id: number }>(`INSERT INTO trunks (${t.cols}) VALUES (${t.placeholders}) RETURNING id`, t.values)).rows[0]!.id;
    }
    const n = insertParts({ tenant_id: tenantId, trunk_id: trunkId, number: d.number, label: d.label, dest_type: d.dest_type, dest_target: d.dest_target });
    const numberId = (await db.query<{ id: number }>(`INSERT INTO numbers (${n.cols}) VALUES (${n.placeholders}) RETURNING id`, n.values)).rows[0]!.id;
    let routeId: number | null = null;
    if (d.outbound && !(await db.query('SELECT 1 FROM outbound_routes WHERE tenant_id = $1 LIMIT 1', [tenantId])).rowCount) {
      routeId = (
        await db.query<{ id: number }>(
          `INSERT INTO outbound_routes (tenant_id, name, priority, patterns, trunk_ids, callerid) VALUES ($1, $2, 10, $3, $4, $5) RETURNING id`,
          [tenantId, 'Calls to Bangladesh numbers', LOCAL_CALL_PATTERNS, [trunkId], d.number],
        )
      ).rows[0]!.id;
    }
    return { trunk_id: trunkId, number_id: numberId, route_id: routeId };
  });
  await audit(req, 'create', 'number', created.number_id, `${d.number} (${source}${trunk ? `, line ${trunk.host}` : ''})`, tenantId);
  scheduleApply();
  return created;
}

/** Connects a phone number: its provider line (new or existing), routing and outgoing calls in one step. */
setupRouter.post('/line', requireRole('superadmin', 'admin'), async (req, res) => {
  res.status(201).json(await connectLine(req, tenantOf(req)!, lineSchema.parse(req.body)));
});

const routingSchema = z.object({
  dest_type: destType,
  dest_target: destTarget,
  /** Only these numbers; all of the SIP server's numbers when left out. */
  number_ids: z.array(z.number().int().positive()).max(1000).optional(),
});

/**
 * Sends calls to every (or the chosen) number of a SIP server to one place. For every number it is
 * also where numbers connected later ring, even when the server has none yet.
 */
setupRouter.post('/routing', requireRole('superadmin', 'admin'), async (req, res) => {
  const tenantId = tenantOf(req)!;
  const d = routingSchema.parse(req.body);
  await assertDestination(tenantId, d.dest_type, d.dest_target);
  const updated = d.number_ids
    ? await exec('UPDATE numbers SET dest_type = $1, dest_target = $2, updated_at = now() WHERE tenant_id = $3 AND id = ANY($4)', [d.dest_type, d.dest_target, tenantId, d.number_ids])
    : await exec('UPDATE numbers SET dest_type = $1, dest_target = $2, updated_at = now() WHERE tenant_id = $3', [d.dest_type, d.dest_target, tenantId]);
  if (!d.number_ids) {
    await exec('UPDATE tenants SET default_dest_type = $1, default_dest_target = $2, updated_at = now() WHERE id = $3', [d.dest_type, d.dest_target, tenantId]);
  }
  await audit(req, 'update', 'number', '', `calls to ${updated} number(s) → ${d.dest_type} ${d.dest_target}`.trim(), tenantId);
  scheduleApply();
  res.json({ updated });
});

/**
 * Brings the "Everyone" ring group up to date with the team (every enabled extension, then the first
 * voicemail), creating it when asked. Returns its id, or null when there is none to update.
 */
async function syncEveryone(req: Request, tenantId: number, create: boolean): Promise<{ id: number; members: number } | null> {
  const exts = await many<{ number: string; voicemail: boolean }>(
    'SELECT number, voicemail FROM extensions WHERE tenant_id = $1 AND enabled ORDER BY length(number), number',
    [tenantId],
  );
  const existing = await one<{ id: number }>("SELECT id FROM ring_groups WHERE tenant_id = $1 AND name = 'Everyone' ORDER BY id LIMIT 1", [tenantId]);
  if (!existing && !create) return null;
  if (!exts.length) throw badRequest('Add at least one person first');
  const members = exts.slice(0, 100).map((e) => e.number);
  const vm = exts.find((e) => e.voicemail);
  let id: number;
  if (existing) {
    await exec('UPDATE ring_groups SET members = $1, updated_at = now() WHERE id = $2', [members, existing.id]);
    id = existing.id;
  } else {
    id = (
      await one<{ id: number }>(
        `INSERT INTO ring_groups (tenant_id, name, strategy, members, ring_time, failover_dest_type, failover_dest_target)
         VALUES ($1, 'Everyone', 'ringall', $2, 25, $3, $4) RETURNING id`,
        [tenantId, members, vm ? 'voicemail' : 'hangup', vm?.number ?? ''],
      )
    )!.id;
  }
  await audit(req, existing ? 'update' : 'create', 'ring_group', id, `Everyone (${members.length})`, tenantId);
  scheduleApply();
  return { id, members: members.length };
}

/**
 * The "Everyone" ring group: rings every enabled extension at once, then the first one's voicemail.
 * Created on first use and brought up to date with the current team on every later call.
 */
setupRouter.post('/ring-everyone', requireRole('superadmin', 'admin'), async (req, res) => {
  res.json(await syncEveryone(req, tenantOf(req)!, true));
});

const PLACEHOLDER = /^Extension \d+$/;

const teamSchema = z.object({
  people: z
    .array(
      z.object({
        /** This SIP server's extension to keep (and rename); null makes a new one. */
        extension_id: z.number().int().positive().nullable().default(null),
        /** '' keeps the extension's name (a new one is called "Extension 105"). */
        name: z.string().trim().max(60).default(''),
        /** With an email they also get a login: an invitation to choose a password. */
        email: z
          .union([z.literal(''), z.email('enter a valid email')])
          .default('')
          .transform((v) => v.toLowerCase()),
      }),
    )
    .min(1, 'add at least one person')
    .max(200),
  /** Spare extensions nobody uses (made for people who are not coming after all). */
  remove: z.array(z.number().int().positive()).max(200).default([]),
});

/**
 * "Who takes calls", in one go: names the extensions, makes new ones, removes unused spares, gives
 * everyone with an email a login (and the invitation) and keeps "Everyone" ringing the whole team.
 * Everything is checked before anything changes.
 */
setupRouter.post('/team', requireRole('superadmin', 'admin'), async (req, res) => {
  const tenantId = tenantOf(req)!;
  const d = teamSchema.parse(req.body);
  const exts = await many<{ id: number; number: string; name: string; users: number }>(
    'SELECT e.id, e.number, e.name, (SELECT count(*) FROM users u WHERE u.extension_id = e.id)::int AS users FROM extensions e WHERE e.tenant_id = $1',
    [tenantId],
  );
  const byId = new Map(exts.map((e) => [e.id, e]));
  const kept = d.people.flatMap((p) => (p.extension_id === null ? [] : [p.extension_id]));
  if (new Set(kept).size !== kept.length) throw badRequest('Each extension can be on the list only once');
  for (const id of kept) if (!byId.has(id)) throw badRequest('One of the extensions is not in this SIP server');

  const emails = d.people.map((p) => p.email).filter(Boolean);
  if (new Set(emails).size !== emails.length) throw badRequest('Each email can be used for one person only');
  if (d.people.some((p) => p.email && !p.name)) throw badRequest('Add a name for everyone who gets a login');
  // An extension that already has a login keeps it; the email only invites people without one.
  const invites = d.people.filter((p) => p.email && !(p.extension_id !== null && byId.get(p.extension_id)!.users > 0));
  for (const p of invites) {
    if (await one('SELECT 1 FROM users WHERE email = $1', [p.email])) throw conflict(`${p.email} is already used by another login`);
  }

  const remove = d.remove.filter((id) => !kept.includes(id));
  for (const id of remove) {
    const e = byId.get(id);
    if (!e) throw badRequest('One of the extensions to remove is not in this SIP server');
    if (e.users > 0 || !PLACEHOLDER.test(e.name)) throw badRequest(`Extension ${e.number} is in use, so it stays. Remove it on the Extensions page.`);
    if (await one("SELECT 1 FROM numbers WHERE tenant_id = $1 AND dest_type IN ('extension', 'voicemail') AND dest_target = $2", [tenantId, e.number])) {
      throw badRequest(`Calls to one of your numbers ring extension ${e.number}, so it stays`);
    }
  }
  const accountId = await accountOfTenant(tenantId);
  const adding = d.people.filter((p) => p.extension_id === null).length;
  if (adding > remove.length) await assertLimit(accountId, 'max_extensions', adding - remove.length);

  for (const id of remove) {
    const e = byId.get(id)!;
    await exec('DELETE FROM extensions WHERE id = $1', [id]);
    await clearExtensionState(tenantId, e.number);
  }
  const out: { extension_id: number; number: string; name: string; email: string; invite_url?: string; invite_status?: 'sent' | 'failed' | 'skipped' }[] = [];
  for (const p of d.people) {
    let ext: { id: number; number: string; name: string };
    if (p.extension_id === null) {
      const number = await nextExtensionNumber(tenantId);
      ext = await createExtension(tenantId, { number, name: p.name || `Extension ${number}`, email: p.email || undefined });
    } else {
      ext = byId.get(p.extension_id)!;
      if (p.name && ext.name !== p.name) {
        await exec('UPDATE extensions SET name = $1, updated_at = now() WHERE id = $2', [p.name, ext.id]);
        ext = { ...ext, name: p.name };
      }
    }
    const row: (typeof out)[number] = { extension_id: ext.id, number: ext.number, name: ext.name, email: p.email };
    if (invites.includes(p)) {
      // Invited people choose their own password; until then nobody knows the random one.
      const user = (await one<{ id: number }>(
        `INSERT INTO users (email, name, role, account_id, tenant_id, extension_id, password_hash, email_verified_at)
         VALUES ($1, $2, 'agent', $3, $4, $5, $6, now()) RETURNING id`,
        [p.email, p.name, accountId, tenantId, ext.id, await hashPassword(crypto.randomBytes(24).toString('base64url'))],
      ))!;
      await audit(req, 'create', 'user', user.id, p.email, tenantId);
      Object.assign(row, await sendInvite(req, { id: user.id, name: p.name, email: p.email, account_id: accountId, extension_id: ext.id }));
    }
    out.push(row);
  }
  await syncEveryone(req, tenantId, false);
  await audit(req, 'update', 'team', '', `${d.people.length} people (${adding} new, ${invites.length} invited, ${remove.length} removed)`, tenantId);
  scheduleApply();
  res.json({ people: out, removed: remove.length });
});
