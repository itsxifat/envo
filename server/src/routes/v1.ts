import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { many, one } from '../db.js';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/http.js';
import { apiKeyAuth, requireScope } from '../lib/apikey.js';
import { groupedCallsSql, hangupCall, liveCalls, originateCall } from '../services/calls.js';
import { live } from '../asterisk/live.js';
import { webEndpoint } from '../asterisk/model.js';
import { getSettings } from '../settings.js';

export const EMBED_AUDIENCE = 'envo-embed';
const ONLINE = new Set(['Reachable', 'NonQualified', 'Created', 'Updated', 'Unknown']);
const RECORDING_RE = /^t\d+\/\d{4}\/\d{2}\/\d{2}\/[0-9A-Za-z._-]+\.wav$/;

export const v1Router = Router();
v1Router.use(apiKeyAuth);

v1Router.get('/ping', async (req, res) => {
  const tenant = await one<{ id: number; name: string; slug: string }>('SELECT id, name, slug FROM tenants WHERE id = $1', [
    req.apiKey!.tenant_id,
  ]);
  res.json({ ok: true, sipServer: tenant, scopes: req.apiKey!.scopes, key: req.apiKey!.name });
});

/** Extensions with live presence, for showing agent availability in another app. */
v1Router.get('/extensions', requireScope('read'), async (req, res) => {
  const tenantId = req.apiKey!.tenant_id;
  const rows = await many<{ number: string; name: string; sip_username: string; webrtc: boolean; enabled: boolean; dnd: boolean }>(
    'SELECT number, name, sip_username, webrtc, enabled, dnd FROM extensions WHERE tenant_id = $1 ORDER BY number',
    [tenantId],
  );
  const onlineEndpoints = new Set(live.contacts.filter((c) => ONLINE.has(c.status)).map((c) => c.endpoint));
  const states = new Map(
    [...live.extStates.values()].filter((s) => s.context === `t${tenantId}-internal`).map((s) => [s.exten, s.status]),
  );
  res.json(
    rows.map((e) => ({
      extension: e.number,
      name: e.name,
      enabled: e.enabled,
      dnd: e.dnd,
      webPhone: e.webrtc,
      online: onlineEndpoints.has(e.sip_username) || (e.webrtc && onlineEndpoints.has(webEndpoint(e))),
      status: states.get(e.number) ?? 'unavailable',
    })),
  );
});

const listQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  status: z.enum(['answered', 'missed']).optional(),
  search: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

v1Router.get('/calls/live', requireScope('read'), (req, res) => {
  res.json({ calls: liveCalls(req.apiKey!.tenant_id) });
});

/** Call history, one entry per call. */
v1Router.get('/calls', requireScope('read'), async (req, res) => {
  const f = listQuery.parse(req.query);
  const params: unknown[] = [`t${req.apiKey!.tenant_id}`, f.from ?? new Date(Date.now() - 30 * 86400_000).toISOString()];
  const where = ["channel NOT LIKE 'Local/%'", 'accountcode = $1', 'calldate >= $2'];
  if (f.to) {
    params.push(f.to);
    where.push(`calldate < $${params.length}`);
  }
  const having: string[] = [];
  if (f.search) {
    params.push(`%${f.search.replace(/[%_\\]/g, '')}%`);
    const p = `$${params.length}`;
    having.push(`bool_or(src ILIKE ${p} OR dst ILIKE ${p} OR clid ILIKE ${p} OR did ILIKE ${p})`);
  }
  if (f.direction) {
    params.push(f.direction);
    having.push(`bool_or(direction = $${params.length})`);
  }
  if (f.status === 'answered') having.push("bool_or(disposition = 'ANSWERED')");
  if (f.status === 'missed') having.push("NOT bool_or(disposition = 'ANSWERED')");

  const sql = groupedCallsSql(where.join(' AND '), having.length ? `HAVING ${having.join(' AND ')}` : '');
  const offset = (f.page - 1) * f.limit;
  const [rows, total] = await Promise.all([
    many<Record<string, unknown>>(`${sql} ORDER BY calldate DESC LIMIT ${f.limit} OFFSET ${offset}`, params),
    one<{ count: number }>(`SELECT count(*) AS count FROM (${sql}) g`, params),
  ]);
  res.json({
    calls: rows.map(serializeCall),
    total: total?.count ?? 0,
    page: f.page,
    limit: f.limit,
  });
});

v1Router.get('/calls/:id', requireScope('read'), async (req, res) => {
  const id = z.string().regex(/^[0-9.]+$/).parse(req.params.id);
  const sql = groupedCallsSql("channel NOT LIKE 'Local/%' AND accountcode = $1 AND linkedid = $2");
  const row = await one<Record<string, unknown>>(sql, [`t${req.apiKey!.tenant_id}`, id]);
  if (!row) throw notFound('Call');
  res.json(serializeCall(row));
});

/** Click-to-call: rings the extension, then dials the customer. */
v1Router.post('/calls', requireScope('calls'), async (req, res) => {
  const body = z
    .object({
      from: z.string().trim().regex(/^[0-9]{2,8}$/, 'must be an extension number'),
      to: z.string().trim().regex(/^\+?[0-9*#]{1,32}$/, 'invalid number'),
      callerId: z.string().trim().regex(/^\+?[0-9]{3,20}$/).optional(),
    })
    .parse(req.body);
  const result = await originateCall({ tenantId: req.apiKey!.tenant_id, extension: body.from, to: body.to, callerId: body.callerId });
  res.status(202).json({ ok: true, ...result });
});

v1Router.post('/calls/hangup', requireScope('calls'), async (req, res) => {
  const { call } = z.object({ call: z.string().min(3).max(200) }).parse(req.body);
  const count = await hangupCall(req.apiKey!.tenant_id, call);
  res.json({ ok: true, channels: count });
});

v1Router.get('/numbers', requireScope('read'), async (req, res) => {
  res.json(
    await many(
      `SELECT n.number, n.label, n.max_channels AS channels, n.dest_type AS destination_type, n.dest_target AS destination,
              n.enabled, k.name AS trunk
         FROM numbers n LEFT JOIN trunks k ON k.id = n.trunk_id WHERE n.tenant_id = $1 ORDER BY n.number`,
      [req.apiKey!.tenant_id],
    ),
  );
});

v1Router.get('/recordings/:id', requireScope('read'), async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const row = await one<{ recordingfile: string }>('SELECT recordingfile FROM cdr WHERE id = $1 AND accountcode = $2', [
    id,
    `t${req.apiKey!.tenant_id}`,
  ]);
  if (!row || !RECORDING_RE.test(row.recordingfile)) throw notFound('Recording');
  const file = path.join(config.paths.monitorDir, row.recordingfile);
  await fs.access(file).catch(() => {
    throw notFound('Recording file');
  });
  if (req.query.download) res.attachment(`call-${id}.wav`);
  res.sendFile(file);
});

/**
 * Mints a short-lived token your backend hands to the browser, which the embedded phone
 * exchanges for SIP credentials. The API key itself never reaches the browser.
 */
v1Router.post('/webphone/token', requireScope('webphone'), async (req, res) => {
  const body = z
    .object({
      extension: z.string().trim().regex(/^[0-9]{2,8}$/, 'must be an extension number'),
      ttlSeconds: z.coerce.number().int().min(60).max(3600).default(600),
    })
    .parse(req.body);
  const ext = await one<{ id: number; number: string; webrtc: boolean; enabled: boolean }>(
    'SELECT id, number, webrtc, enabled FROM extensions WHERE tenant_id = $1 AND number = $2',
    [req.apiKey!.tenant_id, body.extension],
  );
  if (!ext) throw badRequest(`Extension ${body.extension} does not exist`);
  if (!ext.enabled) throw badRequest(`Extension ${body.extension} is disabled`);
  if (!ext.webrtc) throw badRequest(`Extension ${body.extension} does not have the web phone enabled`);
  const settings = await getSettings();
  const token = jwt.sign(
    { sub: String(ext.id), tid: req.apiKey!.tenant_id, kid: req.apiKey!.id, ext: ext.number },
    config.jwtSecret,
    { audience: EMBED_AUDIENCE, expiresIn: body.ttlSeconds },
  );
  res.json({
    token,
    extension: ext.number,
    expiresIn: body.ttlSeconds,
    expiresAt: new Date(Date.now() + body.ttlSeconds * 1000).toISOString(),
    embedScript: `https://${config.publicHost}/embed/phone.js`,
    sipDomain: settings.sip_domain,
  });
});

function serializeCall(row: Record<string, any>) {
  return {
    id: row.linkedid,
    startedAt: row.calldate,
    direction: row.direction ?? null,
    from: row.src || null,
    fromName: /"([^"]*)"/.exec(String(row.clid ?? ''))?.[1] || null,
    to: row.did || row.dst || null,
    answered: !!row.answered,
    disposition: String(row.disposition ?? '').toLowerCase() || null,
    durationSec: Number(row.duration ?? 0),
    talkSec: Number(row.billsec ?? 0),
    recordingUrl: row.has_recording ? `https://${config.publicHost}/api/v1/recordings/${row.record_id}` : null,
    legs: Number(row.legs ?? 1),
  };
}
