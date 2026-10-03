import crypto from 'node:crypto';
import { many, one, exec } from './db.js';
import { config } from './config.js';
import { ami } from './asterisk/pbx.js';
import type { AmiMessage } from './asterisk/ami.js';
import { endpointOfChannel, live, tenantOf } from './asterisk/live.js';
import { resolvePublicUrl } from './lib/net.js';

export type CallEvent = 'call.started' | 'call.answered' | 'call.ended';
export const CALL_EVENTS: CallEvent[] = ['call.started', 'call.answered', 'call.ended'];

interface TrackedCall {
  linkedid: string;
  tenantId: number | null;
  from: string;
  fromName: string;
  to: string;
  direction: string;
  startedAt: number;
  answeredAt: number | null;
  channels: Set<string>;
  announced: boolean;
}

const tracked = new Map<string, TrackedCall>();

interface Webhook {
  id: number;
  tenant_id: number;
  url: string;
  secret: string;
  events: string[];
}

function payloadFor(call: TrackedCall, event: CallEvent, extra: Record<string, unknown> = {}) {
  return {
    event,
    id: call.linkedid,
    sipServer: call.tenantId,
    direction: call.direction || null,
    from: call.from || null,
    fromName: call.fromName || null,
    to: call.to || null,
    startedAt: new Date(call.startedAt).toISOString(),
    answeredAt: call.answeredAt ? new Date(call.answeredAt).toISOString() : null,
    durationSec: Math.max(0, Math.round((Date.now() - call.startedAt) / 1000)),
    talkSec: call.answeredAt ? Math.max(0, Math.round((Date.now() - call.answeredAt) / 1000)) : 0,
    ...extra,
  };
}

/** Sends one event to every webhook of the SIP server that subscribed to it. */
export async function dispatch(tenantId: number | null, event: CallEvent, payload: Record<string, unknown>): Promise<void> {
  if (tenantId === null) return;
  const hooks = await many<Webhook>(
    'SELECT id, tenant_id, url, secret, events FROM webhooks WHERE tenant_id = $1 AND enabled AND $2 = ANY(events)',
    [tenantId, event],
  ).catch(() => []);
  const tenant = hooks.length
    ? await one<{ id: number; name: string; slug: string }>('SELECT id, name, slug FROM tenants WHERE id = $1', [tenantId])
    : null;
  for (const hook of hooks) {
    void deliver(hook, event, { ...payload, sipServer: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug } : tenantId });
  }
}

export async function deliver(hook: Webhook, event: string, payload: Record<string, unknown>): Promise<void> {
  const reachable = await resolvePublicUrl(hook.url);
  if (!reachable.ok) {
    await exec(
      `INSERT INTO webhook_deliveries (webhook_id, event, payload, status, error, attempts) VALUES ($1, $2, $3::jsonb, NULL, $4, 0)`,
      [hook.id, event, JSON.stringify(payload), `blocked: ${reachable.reason}`],
    ).catch(() => undefined);
    return;
  }
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', hook.secret).update(`${timestamp}.${body}`).digest('hex');
  const deliveryId = crypto.randomUUID();
  let status: number | null = null;
  let error = '';
  let attempts = 0;
  const started = Date.now();

  for (const delayMs of [0, 3000, 15_000]) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    attempts++;
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Envo-Webhook/1',
          'X-Envo-Event': event,
          'X-Envo-Delivery': deliveryId,
          'X-Envo-Signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      error = res.ok ? '' : `HTTP ${res.status}`;
      if (res.ok) break;
    } catch (err) {
      status = null;
      error = err instanceof Error ? err.message.slice(0, 200) : 'request failed';
    }
  }

  await exec(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, status, error, attempts, duration_ms)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [hook.id, event, body, status, error, attempts, Date.now() - started],
  ).catch(() => undefined);
}

/**
 * A call counts as answered when two parties join a bridge, when a Dial() is picked up,
 * or - for calls handled by an application such as an IVR, voicemail or the echo test -
 * when the only channel of the call goes up.
 */
function isAnswerSignal(e: AmiMessage, call: TrackedCall): boolean {
  if (e.Event === 'BridgeEnter') {
    const parties = live.channels.filter((c) => c.linkedid === call.linkedid && c.bridgeId === e.BridgeUniqueid);
    return parties.length >= 2 || Number(e.BridgeNumChannels ?? 0) >= 2;
  }
  if (e.Event === 'DialEnd') return String(e.DialStatus ?? '').toUpperCase() === 'ANSWER';
  if (e.Event === 'Newstate') return String(e.ChannelStateDesc ?? '') === 'Up' && call.channels.size === 1;
  return false;
}

/** Tracks call lifecycle from AMI events and emits webhooks. */
export function startWebhooks(): void {
  ami.on('event', (e: AmiMessage) => {
    const linkedid = String(e.Linkedid ?? e.Uniqueid ?? '');
    if (!linkedid) return;

    if (e.Event === 'Newchannel') {
      const channel = String(e.Channel ?? '');
      const call = tracked.get(linkedid);
      if (call) {
        call.channels.add(channel);
        return;
      }
      tracked.set(linkedid, {
        linkedid,
        tenantId: tenantOf({ accountcode: e.AccountCode, endpoint: endpointOfChannel(channel), context: e.Context }),
        from: String(e.CallerIDNum ?? ''),
        fromName: String(e.CallerIDName ?? ''),
        to: String(e.Exten ?? ''),
        direction: '',
        startedAt: Date.now(),
        answeredAt: null,
        channels: new Set([channel]),
        announced: false,
      });
      // Let the dialplan set account code / destination before describing the call.
      setTimeout(() => void announceStart(linkedid), 1200);
      return;
    }

    const call = tracked.get(linkedid);
    if (!call) return;

    if (!call.answeredAt && isAnswerSignal(e, call)) {
      call.answeredAt = Date.now();
      void dispatch(call.tenantId, 'call.answered', payloadFor(call, 'call.answered'));
      return;
    }

    if (e.Event === 'Hangup') {
      call.channels.delete(String(e.Channel ?? ''));
      if (call.channels.size === 0) {
        tracked.delete(linkedid);
        // Wait for Asterisk to write the CDR so the event carries final numbers.
        setTimeout(() => void announceEnd(call), 2000);
      }
    }
  });

  // Keep the delivery log small.
  setInterval(
    () =>
      void exec(
        `DELETE FROM webhook_deliveries WHERE id IN (
           SELECT id FROM webhook_deliveries WHERE created_at < now() - interval '14 days' LIMIT 5000)`,
      ).catch(() => undefined),
    6 * 3600_000,
  ).unref();
}

async function announceStart(linkedid: string): Promise<void> {
  const call = tracked.get(linkedid);
  if (!call || call.announced) return;
  const channel = live.channels.find((c) => c.linkedid === linkedid);
  if (channel) {
    call.tenantId ??= channel.tenantId;
    if (channel.tenantId !== null) call.tenantId = channel.tenantId;
    call.from ||= channel.callerNum;
    call.fromName ||= channel.callerName;
    call.to = channel.exten || call.to;
  }
  const cdr = await one<{ direction: string; did: string; dst: string }>(
    'SELECT direction, did, dst FROM cdr WHERE linkedid = $1 ORDER BY id LIMIT 1',
    [linkedid],
  ).catch(() => null);
  if (cdr?.direction) call.direction = cdr.direction;
  if (cdr?.did) call.to = cdr.did;
  call.announced = true;
  await dispatch(call.tenantId, 'call.started', payloadFor(call, 'call.started'));
}

async function announceEnd(call: TrackedCall): Promise<void> {
  const row = await one<{
    direction: string;
    did: string;
    dst: string;
    clid: string;
    src: string;
    billsec: number;
    duration: number;
    disposition: string;
    record_id: number;
    has_recording: boolean;
  }>(
    `SELECT (array_agg(direction) FILTER (WHERE direction <> ''))[1] AS direction,
            (array_agg(did) FILTER (WHERE did <> ''))[1] AS did,
            (array_agg(COALESCE(NULLIF(dialed, ''), dst) ORDER BY (uniqueid = linkedid) DESC, id))[1] AS dst,
            (array_agg(clid ORDER BY (uniqueid = linkedid) DESC, id))[1] AS clid,
            (array_agg(src ORDER BY (uniqueid = linkedid) DESC, id))[1] AS src,
            max(billsec) AS billsec, max(duration) AS duration,
            (array_agg(disposition ORDER BY (disposition = 'ANSWERED') DESC, id))[1] AS disposition,
            (array_agg(id ORDER BY (recordingfile <> '') DESC, id))[1] AS record_id,
            bool_or(recordingfile <> '') AS has_recording
       FROM cdr WHERE linkedid = $1`,
    [call.linkedid],
  ).catch(() => null);

  const recordingUrl = row?.has_recording ? `https://${config.publicHost}/api/v1/recordings/${row.record_id}` : null;
  await dispatch(call.tenantId, 'call.ended', {
    ...payloadFor(call, 'call.ended', {
      endedAt: new Date().toISOString(),
      answered: row ? row.disposition === 'ANSWERED' : !!call.answeredAt,
      disposition: row?.disposition?.toLowerCase() ?? null,
      talkSec: row?.billsec ?? (call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0),
      durationSec: row?.duration ?? Math.round((Date.now() - call.startedAt) / 1000),
      recordingUrl,
    }),
    direction: row?.direction || call.direction || null,
    to: row?.did || row?.dst || call.to || null,
    from: call.from || row?.src || null,
  });
}

export function sampleCallPayload(): Record<string, unknown> {
  const now = Date.now();
  return {
    event: 'call.ended',
    id: `${Math.floor(now / 1000)}.1`,
    sipServer: { id: 1, name: 'Main', slug: 'main' },
    direction: 'inbound',
    from: '01712345678',
    fromName: 'Test caller',
    to: '09644342036',
    startedAt: new Date(now - 42_000).toISOString(),
    answeredAt: new Date(now - 38_000).toISOString(),
    endedAt: new Date(now).toISOString(),
    answered: true,
    disposition: 'answered',
    durationSec: 42,
    talkSec: 38,
    recordingUrl: null,
    test: true,
  };
}
