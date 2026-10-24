import { Router } from 'express';
import { z } from 'zod';
import { exec, many, one } from '../db.js';
import { issueSession } from '../auth.js';
import { badRequest, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { live } from '../asterisk/live.js';
import { getApplyStatus } from '../asterisk/apply.js';
import { trunkEndpoint, webEndpoint } from '../asterisk/model.js';
import { getAccountPlan } from '../billing/plan.js';
import { supplyCounts } from '../supply/counts.js';

/**
 * The support console at /admin: what the platform team needs to look after customers (overview,
 * live monitor, lines, activity) and the door into a customer's own portal.
 */
export const adminConsoleRouter = Router();

const ONLINE = new Set(['Reachable', 'NonQualified', 'Created', 'Updated', 'Unknown']);

interface LineRow {
  id: number;
  name: string;
  host: string;
  port: number;
  auth_mode: 'register' | 'outbound' | 'ip';
  username: string;
  enabled: boolean;
  qualify: boolean;
  tenant_id: number | null;
}

export type LineHealth = 'ok' | 'failing' | 'waiting' | 'off';

/** How a provider line is doing right now, from the live registration / keep-alive state. */
export function lineHealth(t: LineRow): { health: LineHealth; label: string } {
  if (!t.enabled) return { health: 'off', label: 'Turned off' };
  if (t.auth_mode === 'register') {
    const s = live.registrationOf(trunkEndpoint(t))?.status;
    if (s === 'Registered') return { health: 'ok', label: 'Registered' };
    if (!s) return { health: 'waiting', label: 'Connecting' };
    if (s === 'Rejected' || s === 'Unregistered') return { health: 'failing', label: s === 'Rejected' ? 'Rejected by provider' : 'Not registered' };
    return { health: 'waiting', label: s };
  }
  if (t.qualify) {
    const c = live.contacts.find((x) => x.endpoint === trunkEndpoint(t));
    if (c?.status === 'Reachable') return { health: 'ok', label: c.rttMs ? `Reachable · ${c.rttMs} ms` : 'Reachable' };
    if (c?.status === 'Unreachable') return { health: 'failing', label: 'Unreachable' };
    return { health: 'waiting', label: 'Checking' };
  }
  return { health: 'ok', label: t.auth_mode === 'ip' ? 'IP line' : 'Ready' };
}

interface TenantInfo {
  id: number;
  name: string;
  account_id: number;
  account_name: string;
}

async function tenantDirectory(): Promise<Map<number, TenantInfo>> {
  const rows = await many<TenantInfo>('SELECT t.id, t.name, t.account_id, a.name AS account_name FROM tenants t JOIN accounts a ON a.id = t.account_id');
  return new Map(rows.map((r) => [r.id, r]));
}

async function onlineExtensions(where = '', params: unknown[] = []): Promise<{ total: number; online: number; byTenant: Map<number, { total: number; online: number }> }> {
  const exts = await many<{ sip_username: string; webrtc: boolean; tenant_id: number }>(
    `SELECT sip_username, webrtc, tenant_id FROM extensions WHERE enabled ${where}`,
    params,
  );
  const onlineEp = new Set(live.contacts.filter((c) => ONLINE.has(c.status)).map((c) => c.endpoint));
  const byTenant = new Map<number, { total: number; online: number }>();
  let online = 0;
  for (const e of exts) {
    const on = onlineEp.has(e.sip_username) || (e.webrtc && onlineEp.has(webEndpoint(e)));
    const t = byTenant.get(e.tenant_id) ?? { total: 0, online: 0 };
    t.total++;
    if (on) {
      t.online++;
      online++;
    }
    byTenant.set(e.tenant_id, t);
  }
  return { total: exts.length, online, byTenant };
}

// ---------------------------------------------------------------------------------- overview
/** SQL on invoices `i`: not an Envo Phone recharge (an unpaid one is a payment someone started, not a debt). */
const NOT_PHONE_RECHARGE = "NOT (i.kind = 'topup' AND i.account_id IN (SELECT id FROM accounts WHERE kind = 'personal'))";

adminConsoleRouter.get('/overview', async (_req, res) => {
  const [counts, recent, money, unverified, lines, tenants, devices, supply] = await Promise.all([
    one<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE NOT internal) AS total,
              count(*) FILTER (WHERE status = 'active' AND NOT internal) AS active,
              count(*) FILTER (WHERE status = 'pending') AS pending,
              count(*) FILTER (WHERE status = 'suspended') AS suspended,
              count(*) FILTER (WHERE status = 'closed') AS closed,
              count(*) FILTER (WHERE created_at >= now() - interval '7 days' AND NOT internal) AS new_week
         FROM accounts WHERE kind = 'business'`,
    ),
    many(
      `SELECT a.id, a.name, a.status, a.created_at, p.name AS package_name
         FROM accounts a
         LEFT JOIN subscriptions s ON s.account_id = a.id AND s.status <> 'cancelled'
         LEFT JOIN packages p ON p.id = s.package_id
        WHERE NOT a.internal AND a.kind = 'business' ORDER BY a.created_at DESC LIMIT 6`,
    ),
    one<{ mrr: string; outstanding: string; overdue: number; reviews: number }>(
      `SELECT (SELECT COALESCE(sum(s.price), 0) FROM subscriptions s JOIN accounts a ON a.id = s.account_id
                WHERE s.status <> 'cancelled' AND a.status = 'active' AND NOT a.internal) AS mrr,
              (SELECT COALESCE(sum(amount), 0) FROM invoices i WHERE status = 'unpaid' AND ${NOT_PHONE_RECHARGE}) AS outstanding,
              (SELECT count(*) FROM invoices i WHERE status = 'unpaid' AND due_at < now() AND ${NOT_PHONE_RECHARGE}) AS overdue,
              (SELECT count(*) FROM payments WHERE status = 'pending_review') AS reviews`,
    ),
    many<{ account_id: number; account_name: string; email: string; created_at: string }>(
      `SELECT a.id AS account_id, a.name AS account_name, u.email, u.created_at
         FROM users u JOIN accounts a ON a.id = u.account_id
        WHERE u.is_owner AND u.email_verified_at IS NULL AND a.status <> 'closed' AND a.kind = 'business' AND u.created_at < now() - interval '1 hour'
        ORDER BY u.created_at DESC LIMIT 5`,
    ),
    many<LineRow>('SELECT id, name, host, port, auth_mode, username, enabled, qualify, tenant_id FROM trunks'),
    tenantDirectory(),
    onlineExtensions(),
    supplyCounts(),
  ]);

  const lineStates = lines.map((l) => ({ ...l, ...lineHealth(l) }));
  const failing = lineStates.filter((l) => l.health === 'failing');
  const apply = getApplyStatus();

  const attention: { key: string; tone: 'danger' | 'warn'; title: string; detail: string; to?: string }[] = [];
  if (!live.asterisk.connected) {
    attention.push({ key: 'pbx', tone: 'danger', title: 'The PBX is not responding', detail: 'No customer can make or receive calls until Asterisk is back.', to: '/admin/system' });
  }
  if (apply.state === 'error') attention.push({ key: 'apply', tone: 'danger', title: 'Configuration did not apply', detail: apply.error ?? 'Asterisk rejected the last change.', to: '/admin/system' });
  for (const w of apply.warnings) attention.push({ key: `warn:${w}`, tone: 'warn', title: 'Configuration warning', detail: w, to: '/admin/system' });
  for (const l of failing) {
    const t = l.tenant_id ? tenants.get(l.tenant_id) : null;
    attention.push({
      key: `line:${l.id}`,
      tone: 'danger',
      title: `${t ? t.account_name : 'Shared'} · line "${l.name}" is down`,
      detail: `${l.label} (${l.host}). Calls on its numbers fail.`,
      to: t ? `/admin/customers/${t.account_id}` : '/admin/lines',
    });
  }
  if ((money?.reviews ?? 0) > 0) {
    attention.push({ key: 'reviews', tone: 'warn', title: `${money!.reviews} payment${money!.reviews === 1 ? '' : 's'} to review`, detail: 'Customers reported a bKash or bank payment.', to: '/admin/sales' });
  }
  if ((money?.overdue ?? 0) > 0) {
    attention.push({ key: 'overdue', tone: 'warn', title: `${money!.overdue} overdue invoice${money!.overdue === 1 ? '' : 's'}`, detail: 'Unpaid past the due date.', to: '/admin/sales' });
  }
  if (supply.new_requests > 0) {
    const n = supply.new_requests;
    attention.push({ key: 'number-requests', tone: 'warn', title: `${n} new number request${n === 1 ? '' : 's'}`, detail: 'Customers are waiting for a phone number: register it with the operator, then connect it.', to: '/admin/number-requests' });
  }
  if (supply.topups_to_add > 0) {
    const n = supply.topups_to_add;
    attention.push({ key: 'topups', tone: 'warn', title: `${n} paid top-up${n === 1 ? '' : 's'} to add`, detail: "Customers paid for balance: add it to their number at the operator.", to: '/admin/number-requests?tab=topups' });
  }
  for (const u of unverified) {
    attention.push({
      key: `verify:${u.account_id}`,
      tone: 'warn',
      title: `${u.account_name} has not confirmed their email`,
      detail: `${u.email} signed up but never opened the confirmation link. Confirm it for them if they ask.`,
      to: `/admin/customers/${u.account_id}`,
    });
  }

  res.json({
    accounts: counts,
    money: { mrr: money?.mrr ?? '0', outstanding: money?.outstanding ?? '0', overdue: money?.overdue ?? 0, reviews: money?.reviews ?? 0 },
    live: {
      calls: new Set(live.channels.map((c) => c.linkedid)).size,
      channels: live.channels.length,
      devices: { total: devices.total, online: devices.online },
      lines: { total: lines.length, ok: lineStates.filter((l) => l.health === 'ok').length, failing: failing.length },
    },
    asterisk: live.asterisk,
    recent,
    attention,
  });
});

// ---------------------------------------------------------------------------------- live monitor
adminConsoleRouter.get('/live', async (_req, res) => {
  const tenants = await tenantDirectory();
  const calls = new Map<
    string,
    {
      linkedid: string;
      tenant_id: number | null;
      tenant_name: string | null;
      account_id: number | null;
      account_name: string | null;
      started_at: number;
      answered: boolean;
      channels: { name: string; state: string; endpoint: string; caller: string; connected: string; exten: string; application: string }[];
    }
  >();
  for (const c of live.channels) {
    const t = c.tenantId !== null ? tenants.get(c.tenantId) : undefined;
    const call = calls.get(c.linkedid) ?? {
      linkedid: c.linkedid,
      tenant_id: c.tenantId,
      tenant_name: t?.name ?? null,
      account_id: t?.account_id ?? null,
      account_name: t?.account_name ?? null,
      started_at: c.startedAt,
      answered: false,
      channels: [],
    };
    call.started_at = Math.min(call.started_at, c.startedAt);
    if (c.state === 'Up') call.answered = true;
    if (call.tenant_id === null && c.tenantId !== null) Object.assign(call, { tenant_id: c.tenantId, tenant_name: t?.name ?? null, account_id: t?.account_id ?? null, account_name: t?.account_name ?? null });
    call.channels.push({
      name: c.name,
      state: c.state,
      endpoint: c.endpoint,
      caller: [c.callerName, c.callerNum].filter(Boolean).join(' '),
      connected: [c.connectedName, c.connectedNum].filter(Boolean).join(' '),
      exten: c.exten,
      application: c.application,
    });
    calls.set(c.linkedid, call);
  }

  // Calls per customer against the account-wide channel cap of their package.
  const perAccount = new Map<number, number>();
  for (const call of calls.values()) if (call.account_id !== null) perAccount.set(call.account_id, (perAccount.get(call.account_id) ?? 0) + 1);
  const accounts = await Promise.all(
    [...perAccount.entries()].map(async ([accountId, count]) => {
      const plan = await getAccountPlan(accountId);
      return { account_id: accountId, account_name: plan.accountName, calls: count, channels_in_use: live.groups[`envo_account/a${accountId}`] ?? count, max_channels: plan.limits.max_channels };
    }),
  );
  accounts.sort((a, b) => b.calls - a.calls);

  res.json({
    asterisk: live.asterisk,
    calls: [...calls.values()].sort((a, b) => a.started_at - b.started_at),
    accounts,
  });
});

// ---------------------------------------------------------------------------------- lines & numbers
adminConsoleRouter.get('/lines', async (_req, res) => {
  const [lines, numbers, tenants] = await Promise.all([
    many<LineRow & { codecs: string; max_channels: number }>(
      'SELECT id, name, host, port, auth_mode, username, enabled, qualify, tenant_id, codecs, max_channels FROM trunks ORDER BY id',
    ),
    many<{ id: number; number: string; label: string; trunk_id: number | null; tenant_id: number; dest_type: string; enabled: boolean }>(
      'SELECT id, number, label, trunk_id, tenant_id, dest_type, enabled FROM numbers ORDER BY number',
    ),
    tenantDirectory(),
  ]);
  const owner = (tenantId: number | null) => {
    const t = tenantId !== null ? tenants.get(tenantId) : undefined;
    return { tenant_name: t?.name ?? null, account_id: t?.account_id ?? null, account_name: t?.account_name ?? null };
  };
  res.json({
    lines: lines.map((l) => ({
      ...l,
      ...lineHealth(l),
      ...owner(l.tenant_id),
      in_use: live.groups[`envo_trunk/trunk${l.id}`] ?? 0,
      numbers: numbers.filter((n) => n.trunk_id === l.id).map((n) => n.number),
    })),
    numbers: numbers.map((n) => ({ ...n, ...owner(n.tenant_id), trunk_name: lines.find((l) => l.id === n.trunk_id)?.name ?? null })),
  });
});

// ---------------------------------------------------------------------------------- activity log
adminConsoleRouter.get('/audit', async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().max(100).default(''),
      account_id: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(10).max(500).default(200),
    })
    .parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    params.push(`%${q.search.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(l.summary) LIKE ${p} OR lower(l.action) LIKE ${p} OR lower(l.entity) LIKE ${p} OR lower(u.email) LIKE ${p} OR lower(a.name) LIKE ${p})`);
  }
  if (q.account_id) {
    params.push(q.account_id);
    const p = `$${params.length}`;
    where.push(`a.id = ${p}`);
  }
  params.push(q.limit);
  res.json(
    await many(
      `SELECT l.id, l.created_at, l.action, l.entity, l.entity_id, l.summary, l.tenant_id,
              u.name AS user_name, u.email AS user_email, u.role AS user_role,
              t.name AS tenant_name, a.id AS account_id, a.name AS account_name
         FROM audit_log l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN tenants t ON t.id = l.tenant_id
         LEFT JOIN accounts a ON a.id = COALESCE(t.account_id, u.account_id,
           CASE WHEN l.entity IN ('account', 'subscription') AND l.entity_id ~ '^[0-9]+$' THEN l.entity_id::int END)
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.id DESC LIMIT $${params.length}`,
      params,
    ),
  );
});

// ---------------------------------------------------------------------------------- support access
/**
 * Opens a customer's portal as their owner (or another admin login): the platform admin sees and
 * changes exactly what the customer would. Ended with POST /api/auth/impersonation/stop.
 */
adminConsoleRouter.post('/accounts/:id/impersonate', async (req, res) => {
  const id = intParam(req.params.id);
  const account = await one<{ name: string; status: string }>('SELECT name, status FROM accounts WHERE id = $1', [id]);
  if (!account) throw notFound('Account');
  if (account.status === 'closed') throw badRequest('This account is closed. Reactivate it to open its portal.');
  const target = await one<{ id: number; email: string; name: string }>(
    `SELECT id, email, name FROM users WHERE account_id = $1 AND enabled AND role <> 'superadmin'
      ORDER BY is_owner DESC, (role = 'admin') DESC, id LIMIT 1`,
    [id],
  );
  if (!target) throw badRequest('This customer has no active login yet');
  await audit(req, 'impersonate', 'account', id, `opened the portal of ${account.name} as ${target.email}`, null);
  issueSession(res, target.id, { impersonatorId: req.user!.id });
  res.json({ ok: true, user: target });
});

/** Turns a customer's login on or off (a leaver, a shared password, a compromised account). */
adminConsoleRouter.post('/users/:id/enabled', async (req, res) => {
  const id = intParam(req.params.id);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const user = await one<{ email: string; role: string; is_owner: boolean; account_id: number | null }>('SELECT email, role, is_owner, account_id FROM users WHERE id = $1', [id]);
  if (!user) throw notFound('User');
  if (user.role === 'superadmin') throw badRequest('Manage platform admins on the Staff page');
  await exec('UPDATE users SET enabled = $1, updated_at = now() WHERE id = $2', [enabled, id]);
  await audit(req, enabled ? 'enable' : 'disable', 'user', id, user.email, null);
  res.json({ ok: true });
});

export { onlineExtensions, tenantDirectory };
