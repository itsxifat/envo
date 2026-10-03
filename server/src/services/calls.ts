import { one } from '../db.js';
import { badRequest, notFound } from '../lib/http.js';
import { ami } from '../asterisk/pbx.js';
import { live } from '../asterisk/live.js';
import { webEndpoint, type Extension, type Tenant } from '../asterisk/model.js';
import { effectiveRecording } from '../asterisk/generator.js';

/**
 * One row per call (grouped by linkedid). A single call produces several CDR rows - one per dial
 * attempt - so the call is described by its originating leg.
 */
export function groupedCallsSql(where: string, having = ''): string {
  const first = 'ORDER BY (uniqueid = linkedid) DESC, calldate, id';
  return `
    SELECT linkedid,
      min(calldate) AS calldate,
      (array_agg(clid ${first}))[1] AS clid,
      (array_agg(src ${first}))[1] AS src,
      (array_agg(COALESCE(NULLIF(dialed, ''), dst) ${first}))[1] AS dst,
      (array_agg(did ${first}) FILTER (WHERE did <> ''))[1] AS did,
      (array_agg(direction ${first}) FILTER (WHERE direction <> ''))[1] AS direction,
      bool_or(disposition = 'ANSWERED') AS answered,
      (array_agg(disposition ORDER BY (disposition = 'ANSWERED') DESC, calldate, id))[1] AS disposition,
      (array_agg(dstchannel ORDER BY (disposition = 'ANSWERED') DESC, calldate, id))[1] AS answered_channel,
      max(duration) AS duration,
      max(billsec) AS billsec,
      (array_agg(id ORDER BY (recordingfile <> '') DESC, id))[1] AS record_id,
      bool_or(recordingfile <> '') AS has_recording,
      (array_agg(accountcode ORDER BY calldate, id) FILTER (WHERE accountcode <> ''))[1] AS accountcode,
      count(*) AS legs
    FROM cdr WHERE ${where}
    GROUP BY linkedid ${having}`;
}

/** Active calls of one SIP server, grouped into one entry per call. */
export function liveCalls(tenantId: number) {
  const channels = live.channels.filter((c) => c.tenantId === tenantId);
  const byCall = new Map<string, typeof channels>();
  for (const c of channels) byCall.set(c.linkedid, [...(byCall.get(c.linkedid) ?? []), c]);
  return [...byCall.entries()].map(([id, chans]) => {
    const main = chans.slice().sort((a, b) => a.startedAt - b.startedAt)[0]!;
    return {
      id,
      from: main.callerNum || null,
      fromName: main.callerName || null,
      to: main.exten || main.connectedNum || null,
      state: chans.some((c) => c.state === 'Up' && c.bridgeId) ? 'talking' : main.state.toLowerCase(),
      application: main.application,
      startedAt: new Date(main.startedAt).toISOString(),
      durationSec: Math.max(0, Math.round((Date.now() - main.startedAt) / 1000)),
      channels: chans.map((c) => ({ name: c.name, state: c.state, endpoint: c.endpoint })),
    };
  });
}

export async function hangupCall(tenantId: number, channelOrCallId: string): Promise<number> {
  const targets = live.channels.filter(
    (c) => c.tenantId === tenantId && (c.name === channelOrCallId || c.linkedid === channelOrCallId),
  );
  if (!targets.length) throw notFound('Call');
  for (const c of targets) await ami.action({ Action: 'Hangup', Channel: c.name, Cause: 16 }).catch(() => undefined);
  return targets.length;
}

/**
 * Click-to-call: rings the extension's own devices first, then dials the target once answered.
 * Used by the dashboard and by POST /api/v1/calls.
 */
export async function originateCall(opts: { tenantId: number; extension: string; to: string; callerId?: string }) {
  if (!/^\+?[0-9*#]{1,32}$/.test(opts.to)) throw badRequest('to: invalid number');
  const ext = await one<Extension>('SELECT * FROM extensions WHERE tenant_id = $1 AND number = $2 AND enabled', [
    opts.tenantId,
    opts.extension,
  ]);
  if (!ext) throw badRequest(`Extension ${opts.extension} does not exist or is disabled`);
  const tenant = await one<Tenant>('SELECT * FROM tenants WHERE id = $1', [opts.tenantId]);
  if (!tenant) throw notFound('SIP server');

  const policy = effectiveRecording(ext, tenant);
  const vars = [
    `ENVO_TENANT=${tenant.id}`,
    `ENVO_EXT=${ext.number}`,
    `ENVO_OUTBOUND=${ext.allow_outbound ? 1 : 0}`,
    `ENVO_RECOUT=${policy === 'outbound' || policy === 'all' ? 1 : 0}`,
    `ENVO_CC_TARGET=${opts.to}`,
    `ENVO_CC_EP1=${ext.sip_username}`,
    `ENVO_CC_EP2=${ext.webrtc ? webEndpoint(ext) : ''}`,
  ];
  const cid = opts.callerId && /^\+?[0-9]{3,20}$/.test(opts.callerId) ? opts.callerId : ext.outbound_cid;
  if (/^\+?[0-9]{3,20}$/.test(cid)) vars.push(`ENVO_OUTCID=${cid}`);

  const res = await ami.action({
    Action: 'Originate',
    Channel: `Local/${ext.number}@envo-cc`,
    Context: `t${tenant.id}-internal`,
    Exten: opts.to,
    Priority: 1,
    CallerID: `"${ext.name.replace(/["<>]/g, '')}" <${ext.number}>`,
    Account: `t${tenant.id}`,
    Timeout: 30000,
    Async: 'true',
    Variable: vars,
  });
  if (res.Response !== 'Success') throw badRequest(res.Message || 'Could not start the call');
  return { extension: ext.number, to: opts.to, startedAt: new Date().toISOString() };
}
