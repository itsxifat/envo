import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { requireRole, type SessionUser } from '../auth.js';
import { badRequest, forbidden, notFound } from '../lib/http.js';
import { live, type LiveKind } from '../asterisk/live.js';
import { endpointDirectory, numberDirectory, registrationDirectory } from '../asterisk/apply.js';
import { ami } from '../asterisk/pbx.js';
import type { Extension } from '../asterisk/model.js';
import { hangupCall, originateCall } from '../services/calls.js';

function visible(user: SessionUser, tenantId: number | null): boolean {
  if (user.role === 'superadmin') return true;
  return tenantId !== null && tenantId === user.tenantId;
}

/** Live state filtered to what `user` may see. Shared by REST and the WebSocket feed. */
export function livePayload(kind: LiveKind, user: SessionUser): unknown {
  switch (kind) {
    case 'contacts':
      return live.contacts.filter((c) => visible(user, endpointDirectory.get(c.endpoint)?.tenantId ?? null));
    case 'registrations':
      return live.registrations.filter((r) => visible(user, registrationDirectory.get(r.name)?.tenantId ?? null));
    case 'channels':
      return live.channels.filter((c) => visible(user, c.tenantId));
    case 'extstates':
      return [...live.extStates.values()].filter((s) => visible(user, s.tenantId));
    case 'asterisk':
      return live.asterisk;
    case 'groups': {
      if (user.role === 'superadmin') return live.groups;
      const out: Record<string, number> = {};
      for (const [key, count] of Object.entries(live.groups)) {
        const [category, group = ''] = key.split('/');
        let tenantId: number | null = null;
        if (category === 'envo_tenant') tenantId = Number(group.slice(1));
        else if (category === 'envo_trunk') tenantId = endpointDirectory.get(`trunk_${group.slice(5)}`)?.tenantId ?? null;
        else if (category === 'envo_did') tenantId = numberDirectory.get(Number(group.slice(3))) ?? null;
        if (visible(user, tenantId)) out[key] = count;
      }
      return out;
    }
  }
}

export const liveRouter = Router();

liveRouter.get('/snapshot', (req, res) => {
  const user = req.user!;
  res.json({
    contacts: livePayload('contacts', user),
    registrations: livePayload('registrations', user),
    channels: livePayload('channels', user),
    extstates: livePayload('extstates', user),
    asterisk: livePayload('asterisk', user),
    groups: livePayload('groups', user),
  });
});

liveRouter.post('/hangup', requireRole('superadmin', 'admin'), async (req, res) => {
  const { channel } = z.object({ channel: z.string().min(3).max(200) }).parse(req.body);
  const ch = live.channels.find((c) => c.name === channel);
  if (!ch) throw notFound('Channel');
  if (!visible(req.user!, ch.tenantId) || ch.tenantId === null) throw forbidden();
  await hangupCall(ch.tenantId, channel);
  res.json({ ok: true });
});

/** Click-to-call: rings the user's own phones first, then dials the target once answered. */
liveRouter.post('/originate', async (req, res) => {
  const { to } = z.object({ to: z.string().trim().regex(/^\+?[0-9*#]{1,32}$/, 'invalid number') }).parse(req.body);
  const user = req.user!;
  if (!user.extensionId) throw badRequest('Link an extension to your user to place calls');
  const ext = await one<Extension>('SELECT number, tenant_id FROM extensions WHERE id = $1 AND enabled', [user.extensionId]);
  if (!ext) throw badRequest('Your extension is disabled');
  res.json(await originateCall({ tenantId: ext.tenant_id, extension: ext.number, to }));
});
