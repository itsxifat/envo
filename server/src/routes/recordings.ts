import { Router, type Request } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { exec, many, one } from '../db.js';
import { requireRole, tenantOf } from '../auth.js';
import { badRequest, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { config } from '../config.js';
import { callScope } from './calls.js';
import { accountOfTenant, getAccountPlan } from '../billing/plan.js';
import {
  forgetRecordings,
  listFiles,
  recordingRetention,
  RECORDING_RE,
  type FileInfo,
  type RecordingRetention,
} from '../billing/retention.js';
import { CAPTURE_EXT, PART_EXT } from '../lib/recordingFiles.js';
import { scheduleApply } from '../asterisk/apply.js';

const DAY_MS = 86400_000;
/** Recordings this close to automatic removal are flagged on the page. */
const SOON_DAYS = 3;

const listSchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(40).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  extension: z.string().regex(/^[0-9]{2,8}$/).optional(),
  min_sec: z.coerce.number().int().min(0).max(86400).optional(),
  sort: z.enum(['newest', 'oldest', 'longest']).default('newest'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
type ListFilters = z.infer<typeof listSchema>;

interface RecordingRow {
  id: number;
  linkedid: string;
  calldate: string;
  clid: string;
  src: string;
  dst: string;
  did: string | null;
  direction: string | null;
  answered_channel: string;
  billsec: number;
  recordingfile: string;
}

/**
 * One row per recording file: a call rings several devices, so several CDR rows share the file.
 * The answered leg describes the call. Calls nobody answered never have audio and are left out.
 */
async function recordingQuery(req: Request, f: Partial<ListFilters>, file?: string): Promise<{ sql: string; params: unknown[] }> {
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = ["recordingfile <> ''"];
  if (file) where.push(`recordingfile = ${add(file)}`);
  if (f.from) where.push(`calldate >= ${add(f.from)}`);
  if (f.to) where.push(`calldate < ${add(f.to)}`);
  const s = await callScope(req, params.length + 1, { localLegs: true });
  params.push(...s.params);
  where.push(s.sql);

  const having = ["bool_or(disposition = 'ANSWERED')"];
  if (f.q) {
    const p = add(`%${f.q.replace(/[%_\\]/g, '')}%`);
    having.push(`bool_or(src ILIKE ${p} OR dst ILIKE ${p} OR dialed ILIKE ${p} OR clid ILIKE ${p} OR did ILIKE ${p})`);
  }
  if (f.direction) having.push(`bool_or(direction = ${add(f.direction)})`);
  if (f.min_sec) having.push(`max(billsec) >= ${add(f.min_sec)}`);
  if (f.extension) {
    const tenantId = tenantOf(req, { required: false });
    const ext =
      tenantId === null
        ? null
        : await one<{ sip_username: string }>('SELECT sip_username FROM extensions WHERE tenant_id = $1 AND number = $2', [tenantId, f.extension]);
    const n = add(f.extension);
    const legs = [`src = ${n}`, `dst = ${n}`, `dialed = ${n}`, `dstchannel LIKE ${add(`Local/${f.extension}@%`)}`];
    if (ext) {
      const desk = add(`PJSIP/${ext.sip_username}-%`);
      const web = add(`PJSIP/${ext.sip_username}_web-%`);
      legs.push(`channel LIKE ${desk}`, `channel LIKE ${web}`, `dstchannel LIKE ${desk}`, `dstchannel LIKE ${web}`);
    }
    having.push(`bool_or(${legs.join(' OR ')})`);
  }

  const first = "ORDER BY (disposition = 'ANSWERED') DESC, (uniqueid = linkedid) DESC, calldate, id";
  const sql = `
    SELECT (array_agg(id ${first}))[1] AS id,
      (array_agg(linkedid ${first}))[1] AS linkedid,
      min(calldate) AS calldate,
      (array_agg(clid ${first}))[1] AS clid,
      (array_agg(src ${first}))[1] AS src,
      (array_agg(COALESCE(NULLIF(dialed, ''), dst) ${first}))[1] AS dst,
      (array_agg(did ${first}) FILTER (WHERE did <> ''))[1] AS did,
      (array_agg(direction ${first}) FILTER (WHERE direction <> ''))[1] AS direction,
      (array_agg(dstchannel ${first}))[1] AS answered_channel,
      max(billsec)::int AS billsec,
      recordingfile
    FROM cdr WHERE ${where.join(' AND ')}
    GROUP BY recordingfile
    HAVING ${having.join(' AND ')}`;
  return { sql, params };
}

/** Adds what the page shows about the file itself: size, and when retention removes it. */
async function decorate(rows: RecordingRow[]) {
  const retentions = new Map<number, Promise<RecordingRetention | null>>();
  // The folder (t<id>/...) decides whose package applies, exactly as the retention job sees it.
  const retentionOf = (tenantId: number) => {
    let r = retentions.get(tenantId);
    if (!r) {
      r = accountOfTenant(tenantId)
        .then(getAccountPlan)
        .then(recordingRetention)
        .catch(() => null);
      retentions.set(tenantId, r);
    }
    return r;
  };
  return Promise.all(
    rows.map(async ({ recordingfile, ...row }) => {
      const valid = RECORDING_RE.test(recordingfile);
      const st = valid ? await fs.stat(path.join(config.paths.monitorDir, recordingfile)).catch(() => null) : null;
      const retention = valid ? await retentionOf(Number(recordingfile.slice(1, recordingfile.indexOf('/')))) : null;
      return {
        ...row,
        available: !!st,
        size: st?.size ?? null,
        recorded_at: st ? new Date(st.mtimeMs).toISOString() : null,
        expires_at: st && retention?.days != null ? new Date(st.mtimeMs + retention.days * DAY_MS).toISOString() : null,
        kept_until_deleted: retention?.days === null,
      };
    }),
  );
}

/** A recording the user may see, by the id of any of its call records. */
async function findRecording(req: Request, id: number) {
  const s = await callScope(req, 2, { localLegs: true });
  return one<{ recordingfile: string; calldate: Date; src: string; dst: string }>(
    `SELECT recordingfile, calldate, src, COALESCE(NULLIF(did, ''), NULLIF(dialed, ''), dst) AS dst
       FROM cdr WHERE id = $1 AND recordingfile <> '' AND ${s.sql}`,
    [id, ...s.params],
  );
}

const fileCache = new Map<number, { at: number; files: FileInfo[] }>();

/** Recording files of one SIP server (cached briefly: the summary walks the whole folder). */
async function tenantFiles(tenantId: number): Promise<FileInfo[]> {
  const hit = fileCache.get(tenantId);
  if (hit && Date.now() - hit.at < 30_000) return hit.files;
  const files = await listFiles(path.join(config.paths.monitorDir, `t${tenantId}`));
  fileCache.set(tenantId, { at: Date.now(), files });
  return files;
}

async function downloadName(req: Request, row: { calldate: Date; src: string; dst: string }): Promise<string> {
  const tenantId = tenantOf(req, { required: false });
  const tz = (tenantId !== null && (await one<{ timezone: string }>('SELECT timezone FROM tenants WHERE id = $1', [tenantId]))?.timezone) || 'Asia/Dhaka';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(row.calldate));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const clean = (v: string) => v.replace(/[^0-9A-Za-z+]/g, '').slice(0, 24) || 'unknown';
  return `call_${get('year')}-${get('month')}-${get('day')}_${get('hour')}${get('minute')}_${clean(row.src)}_to_${clean(row.dst)}.wav`;
}

export const recordingRouter = Router();

recordingRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query);
  const { sql, params } = await recordingQuery(req, f);
  const order = { newest: 'calldate DESC, id DESC', oldest: 'calldate, id', longest: 'billsec DESC, calldate DESC' }[f.sort];
  const offset = (f.page - 1) * f.limit;
  const [rows, totals] = await Promise.all([
    many<RecordingRow>(`${sql} ORDER BY ${order} LIMIT ${f.limit} OFFSET ${offset}`, params),
    one<{ count: number; seconds: number }>(`SELECT count(*)::int AS count, COALESCE(sum(billsec), 0)::int AS seconds FROM (${sql}) g`, params),
  ]);
  res.json({ rows: await decorate(rows), total: totals?.count ?? 0, seconds: totals?.seconds ?? 0, page: f.page, limit: f.limit });
});

/** What gets recorded on the selected SIP server and how long recordings stay. */
recordingRouter.get('/summary', async (req, res) => {
  const tenantId = tenantOf(req, { required: false });
  if (tenantId === null) {
    res.json({ tenant: null });
    return;
  }
  const t = await one<{ id: number; name: string; recording: string; account_id: number }>(
    'SELECT id, name, recording, account_id FROM tenants WHERE id = $1',
    [tenantId],
  );
  if (!t) throw notFound('SIP server');
  const plan = await getAccountPlan(t.account_id);
  const retention = recordingRetention(plan);
  const admin = req.user!.role !== 'agent';
  let stored = null;
  let storage = null;
  let exceptions = null;
  if (admin) {
    const files = await tenantFiles(t.id);
    const now = Date.now();
    const days = retention.days;
    stored = {
      files: files.length,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      oldest: files.length ? new Date(Math.min(...files.map((f) => f.mtimeMs))).toISOString() : null,
      expiringSoon: days === null ? 0 : files.filter((f) => f.mtimeMs + days * DAY_MS - now < SOON_DAYS * DAY_MS).length,
    };
    // The storage quota covers every SIP server of the account.
    let usedBytes = 0;
    for (const { id } of await many<{ id: number }>('SELECT id FROM tenants WHERE account_id = $1', [t.account_id])) {
      usedBytes += (await tenantFiles(id)).reduce((sum, f) => sum + f.size, 0);
    }
    storage = { usedBytes, quotaBytes: retention.quotaBytes };
    exceptions = {
      extensions: await many<{ number: string; name: string; recording: string }>(
        "SELECT number, name, recording FROM extensions WHERE tenant_id = $1 AND recording NOT IN ('inherit', 'all') ORDER BY number",
        [t.id],
      ),
      numbers: await many<{ number: string; recording: string }>("SELECT number, recording FROM numbers WHERE tenant_id = $1 AND recording = 'off' ORDER BY number", [t.id]),
    };
  }
  res.json({
    tenant: { id: t.id, name: t.name },
    policy: t.recording,
    included: retention.included,
    usable: plan.usable,
    internal: plan.internal,
    accountId: plan.accountId,
    retentionDays: retention.days,
    soonDays: SOON_DAYS,
    stored,
    storage,
    exceptions,
  });
});

/**
 * Changes what the SIP server records; `reset_overrides` also puts extensions and numbers with a
 * setting of their own back on the server's.
 */
recordingRouter.put('/policy', requireRole('superadmin', 'admin'), async (req, res) => {
  const tenantId = tenantOf(req)!;
  const body = z
    .object({ recording: z.enum(['off', 'inbound', 'outbound', 'all']).optional(), reset_overrides: z.boolean().optional() })
    .parse(req.body);
  const t = await one<{ name: string; account_id: number; recording: string }>('SELECT name, account_id, recording FROM tenants WHERE id = $1', [tenantId]);
  if (!t) throw notFound('SIP server');
  if (body.recording && body.recording !== t.recording) {
    if (body.recording !== 'off' && req.user!.role !== 'superadmin' && !recordingRetention(await getAccountPlan(t.account_id)).included) {
      throw badRequest('Call recording is not part of your package');
    }
    await exec('UPDATE tenants SET recording = $1, updated_at = now() WHERE id = $2', [body.recording, tenantId]);
    await audit(req, 'update', 'tenant', tenantId, `${t.name}: call recording ${body.recording}`, tenantId);
  }
  if (body.reset_overrides) {
    const exts = await exec("UPDATE extensions SET recording = 'inherit', updated_at = now() WHERE tenant_id = $1 AND recording <> 'inherit'", [tenantId]);
    const nums = await exec("UPDATE numbers SET recording = 'inherit', updated_at = now() WHERE tenant_id = $1 AND recording = 'off'", [tenantId]);
    if (exts + nums) await audit(req, 'update', 'tenant', tenantId, `${t.name}: ${exts} extension(s) and ${nums} number(s) back to the server's recording setting`, tenantId);
  }
  scheduleApply();
  res.json({ ok: true });
});

/** Deletes recordings (by call record id) right away; the call records stay. */
recordingRouter.post('/delete', requireRole('superadmin', 'admin'), async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(req.body);
  const s = await callScope(req, 2, { localLegs: true });
  const rows = await many<{ recordingfile: string }>(
    `SELECT DISTINCT recordingfile FROM cdr WHERE id = ANY($1::int[]) AND recordingfile <> '' AND ${s.sql}`,
    [ids, ...s.params],
  );
  const removed: string[] = [];
  let failed = 0;
  for (const { recordingfile } of rows) {
    if (!RECORDING_RE.test(recordingfile)) continue;
    const file = path.join(config.paths.monitorDir, recordingfile);
    // A capture still waiting for conversion would otherwise become this recording again.
    for (const ext of [CAPTURE_EXT, PART_EXT]) await fs.unlink(`${file.slice(0, -'.wav'.length)}${ext}`).catch(() => undefined);
    try {
      await fs.unlink(file);
      removed.push(recordingfile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') removed.push(recordingfile);
      else failed++;
    }
  }
  await forgetRecordings(removed);
  fileCache.clear();
  if (removed.length) await audit(req, 'delete', 'recording', ids.slice(0, 20).join(','), `${removed.length} call recording(s)`, tenantOf(req, { required: false }));
  if (!removed.length && failed) throw badRequest('The recording files could not be deleted (no permission on the server)');
  res.json({ deleted: removed.length, failed });
});

recordingRouter.get('/:id/audio', async (req, res) => {
  const row = await findRecording(req, intParam(req.params.id));
  if (!row || !RECORDING_RE.test(row.recordingfile)) throw notFound('Recording');
  const file = path.join(config.paths.monitorDir, row.recordingfile);
  await fs.access(file).catch(() => {
    throw notFound('Recording file');
  });
  if (req.query.download) res.attachment(await downloadName(req, row));
  // The path is built from a validated name; the folder itself may sit below a dot-folder (.dev).
  res.sendFile(file, { dotfiles: 'allow' });
});

recordingRouter.get('/:id', async (req, res) => {
  const row = await findRecording(req, intParam(req.params.id));
  if (!row) throw notFound('Recording');
  const { sql, params } = await recordingQuery(req, {}, row.recordingfile);
  const found = await many<RecordingRow>(sql, params);
  if (!found.length) throw notFound('Recording');
  res.json((await decorate(found))[0]);
});
