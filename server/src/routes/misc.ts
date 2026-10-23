import { Router } from 'express';
import { many, one } from '../db.js';
import { tenantOf, type SessionUser } from '../auth.js';
import { live } from '../asterisk/live.js';
import { endpointDirectory, registrationDirectory } from '../asterisk/apply.js';
import { webEndpoint, type Extension } from '../asterisk/model.js';
import { webPassword } from '../lib/secrets.js';
import { getSettings } from '../settings.js';

const ONLINE = new Set(['Reachable', 'NonQualified', 'Created', 'Updated', 'Unknown']);

export const webphoneRouter = Router();

/**
 * SIP-over-WebSocket credentials for a login's own extension: the web phone in the dashboard and the
 * phone app both register with these.
 */
export async function webphoneCredentials(user: SessionUser): Promise<Record<string, unknown>> {
  // Support access must not register as the customer's phone (their calls would ring here too).
  if (user.impersonator) return { enabled: false, reason: "The web phone is off while you view a customer's portal" };
  const settings = await getSettings();
  const ext = user.extensionId
    ? await one<Extension & { tenant_enabled: boolean; tenant_name: string }>(
        `SELECT e.*, t.enabled AS tenant_enabled, t.name AS tenant_name
           FROM extensions e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = $1`,
        [user.extensionId],
      )
    : null;
  if (!ext) return { enabled: false, reason: 'No extension is linked to your account' };
  if (!ext.enabled || !ext.tenant_enabled) return { enabled: false, reason: 'Your extension is disabled' };
  if (!ext.webrtc) return { enabled: false, reason: 'Web phone is turned off for your extension' };
  const username = webEndpoint(ext);
  return {
    enabled: true,
    wsUrl: `wss://${settings.sip_domain}/ws`,
    domain: settings.sip_domain,
    username,
    password: webPassword(ext.sip_username),
    displayName: ext.name,
    extension: ext.number,
    extensionId: ext.id,
    tenantId: ext.tenant_id,
    tenantName: ext.tenant_name,
    iceServers: settings.stun_server ? [{ urls: settings.stun_server }] : [],
  };
}

webphoneRouter.get('/', async (req, res) => {
  res.json(await webphoneCredentials(req.user!));
});

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req, { required: false });
  const inTenant = (tid: number | null) => tenantId === null || tid === tenantId;

  const exts = await many<{ id: number; sip_username: string; webrtc: boolean }>(
    tenantId === null
      ? 'SELECT id, sip_username, webrtc FROM extensions WHERE enabled'
      : 'SELECT id, sip_username, webrtc FROM extensions WHERE enabled AND tenant_id = $1',
    tenantId === null ? [] : [tenantId],
  );
  const onlineEndpoints = new Set(live.contacts.filter((c) => ONLINE.has(c.status)).map((c) => c.endpoint));
  const online = exts.filter(
    (e) => onlineEndpoints.has(e.sip_username) || (e.webrtc && onlineEndpoints.has(webEndpoint(e))),
  ).length;

  const trunks = await many<{ id: number; tenant_id: number | null; auth_mode: string; enabled: boolean }>(
    tenantId === null
      ? 'SELECT id, tenant_id, auth_mode, enabled FROM trunks'
      : 'SELECT id, tenant_id, auth_mode, enabled FROM trunks WHERE tenant_id IS NULL OR tenant_id = $1',
    tenantId === null ? [] : [tenantId],
  );
  const registered = trunks.filter(
    (t) => t.auth_mode === 'register' && live.registrationOf(`trunk_${t.id}`)?.status === 'Registered',
  ).length;

  const numbers = await one<{ count: number }>(
    tenantId === null ? 'SELECT count(*) AS count FROM numbers' : 'SELECT count(*) AS count FROM numbers WHERE tenant_id = $1',
    tenantId === null ? [] : [tenantId],
  );

  const channels = live.channels.filter((c) => inTenant(c.tenantId));
  res.json({
    extensions: { total: exts.length, online },
    trunks: { total: trunks.length, registering: trunks.filter((t) => t.auth_mode === 'register' && t.enabled).length, registered },
    numbers: numbers?.count ?? 0,
    activeCalls: new Set(channels.map((c) => c.linkedid)).size,
    activeChannels: channels.length,
    asterisk: live.asterisk,
    unknownRegistrations: live.registrations.filter((r) => !registrationDirectory.has(r.name)).length,
    endpointsKnown: endpointDirectory.size,
  });
});

export const destinationRouter = Router();

/** Everything a call can be sent to inside a tenant, for destination pickers. */
destinationRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req);
  const [extensions, ringGroups, queues, ivrs, timeConditions, conferences] = await Promise.all([
    many<{ number: string; name: string; voicemail: boolean }>(
      'SELECT number, name, voicemail FROM extensions WHERE tenant_id = $1 ORDER BY number',
      [tenantId],
    ),
    many<{ id: number; name: string; number: string }>('SELECT id, name, number FROM ring_groups WHERE tenant_id = $1 ORDER BY name', [tenantId]),
    many<{ id: number; name: string; number: string }>('SELECT id, name, number FROM queues WHERE tenant_id = $1 ORDER BY name', [tenantId]),
    many<{ id: number; name: string; number: string }>('SELECT id, name, number FROM ivrs WHERE tenant_id = $1 ORDER BY name', [tenantId]),
    many<{ id: number; name: string }>('SELECT id, name FROM time_conditions WHERE tenant_id = $1 ORDER BY name', [tenantId]),
    many<{ id: number; name: string; number: string }>('SELECT id, name, number FROM conferences WHERE tenant_id = $1 ORDER BY name', [tenantId]),
  ]);
  const label = (n: string, name: string) => (n ? `${n} · ${name}` : name);
  res.json({
    extension: extensions.map((e) => ({ value: e.number, label: label(e.number, e.name) })),
    voicemail: extensions.filter((e) => e.voicemail).map((e) => ({ value: e.number, label: label(e.number, e.name) })),
    ring_group: ringGroups.map((r) => ({ value: String(r.id), label: label(r.number, r.name) })),
    queue: queues.map((q) => ({ value: String(q.id), label: label(q.number, q.name) })),
    ivr: ivrs.map((i) => ({ value: String(i.id), label: label(i.number, i.name) })),
    time_condition: timeConditions.map((t) => ({ value: String(t.id), label: t.name })),
    conference: conferences.map((c) => ({ value: String(c.id), label: label(c.number, c.name) })),
  });
});
