import { Router, type Request } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { many, one } from '../db.js';
import { tenantOf } from '../auth.js';
import { forbidden, intParam, notFound } from '../lib/http.js';
import { config } from '../config.js';
import { groupedCallsSql } from '../services/calls.js';

const querySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(40).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  status: z.enum(['answered', 'missed']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

interface Scope {
  sql: string;
  params: unknown[];
}

/** WHERE clause restricting CDR rows to what the user may see. */
async function scope(req: Request, startIndex: number): Promise<Scope> {
  const user = req.user!;
  const clauses: string[] = ["channel NOT LIKE 'Local/%'"];
  const params: unknown[] = [];
  // Called right after a push: the placeholder of the value just added.
  const next = () => `$${startIndex + params.length - 1}`;
  const tenantId = tenantOf(req, { required: false });
  if (tenantId !== null) {
    params.push(`t${tenantId}`);
    clauses.push(`accountcode = ${next()}`);
  } else if (user.role !== 'superadmin') {
    throw forbidden();
  }
  if (user.role === 'agent') {
    const ext = user.extensionId
      ? await one<{ number: string; sip_username: string }>('SELECT number, sip_username FROM extensions WHERE id = $1', [user.extensionId])
      : null;
    if (!ext) return { sql: 'false', params: [] };
    params.push(ext.number);
    const n = next();
    params.push(`PJSIP/${ext.sip_username}-%`);
    const a = next();
    params.push(`PJSIP/${ext.sip_username}_web-%`);
    const b = next();
    clauses.push(`(src = ${n} OR dst = ${n} OR channel LIKE ${a} OR channel LIKE ${b} OR dstchannel LIKE ${a} OR dstchannel LIKE ${b})`);
  }
  return { sql: clauses.join(' AND '), params };
}

export const callRouter = Router();

callRouter.get('/', async (req, res) => {
  const f = querySchema.parse(req.query);
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  add('calldate >= ?', f.from ?? new Date(Date.now() - 30 * 86400_000).toISOString());
  if (f.to) add('calldate < ?', f.to);
  const s = await scope(req, params.length + 1);
  params.push(...s.params);
  where.push(s.sql);
  const base = where.join(' AND ');

  const having: string[] = [];
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, '')}%`);
    const p = `$${params.length}`;
    having.push(`bool_or(src ILIKE ${p} OR dst ILIKE ${p} OR clid ILIKE ${p} OR did ILIKE ${p})`);
  }
  if (f.direction) {
    params.push(f.direction);
    having.push(`bool_or(direction = $${params.length})`);
  }
  if (f.status === 'answered') having.push("bool_or(disposition = 'ANSWERED')");
  if (f.status === 'missed') having.push("NOT bool_or(disposition = 'ANSWERED')");
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';

  const grouped = groupedCallsSql(base, havingSql);

  const offset = (f.page - 1) * f.limit;
  const [rows, total] = await Promise.all([
    many(`${grouped} ORDER BY calldate DESC LIMIT ${f.limit} OFFSET ${offset}`, params),
    one<{ count: number }>(`SELECT count(*) AS count FROM (${grouped}) g`, params),
  ]);
  res.json({ rows, total: total?.count ?? 0, page: f.page, limit: f.limit });
});

callRouter.get('/stats', async (req, res) => {
  const tz = await timezoneOf(req);
  const s = await scope(req, 2);
  const params = [tz, ...s.params];
  const rows = await many<{ bucket: string; answered: boolean; direction: string | null; billsec: number; today: boolean }>(
    `WITH calls AS (
       SELECT linkedid, min(calldate) AS started, bool_or(disposition = 'ANSWERED') AS answered, max(billsec) AS billsec,
              (array_agg(direction ORDER BY (uniqueid = linkedid) DESC, calldate, id) FILTER (WHERE direction <> ''))[1] AS direction
         FROM cdr WHERE calldate >= now() - interval '26 hours' AND ${s.sql}
        GROUP BY linkedid)
     SELECT to_char(date_trunc('hour', started AT TIME ZONE $1), 'YYYY-MM-DD"T"HH24') AS bucket, answered, direction, billsec,
            (started AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date AS today
       FROM calls WHERE started >= now() - interval '24 hours' OR (started AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`,
    params,
  );
  const today = rows.filter((r) => r.today);
  const answered = today.filter((r) => r.answered);
  const hourly = new Map<string, { answered: number; missed: number }>();
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    hourly.set(hourKey(d, tz), { answered: 0, missed: 0 });
  }
  for (const r of rows) {
    const h = hourly.get(r.bucket);
    if (h) r.answered ? h.answered++ : h.missed++;
  }

  // 14-day trend for the dashboard sparklines, plus yesterday for the day-over-day deltas.
  const days = await many<{ day: string; total: number; answered: number; talksec: number }>(
    `WITH calls AS (
       SELECT linkedid, min(calldate) AS started, bool_or(disposition = 'ANSWERED') AS answered, max(billsec) AS billsec
         FROM cdr WHERE calldate >= now() - interval '15 days' AND ${s.sql}
        GROUP BY linkedid)
     SELECT to_char((started AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
            count(*)::int AS total,
            count(*) FILTER (WHERE answered)::int AS answered,
            COALESCE(sum(billsec) FILTER (WHERE answered), 0)::int AS talksec
       FROM calls GROUP BY 1 ORDER BY 1`,
    params,
  );
  const byDay = new Map(days.map((d) => [d.day, d]));
  const daily: Array<{ day: string; total: number; answered: number; missed: number; talkSec: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const day = dayKey(new Date(now.getTime() - i * 86400_000), tz);
    const d = byDay.get(day);
    daily.push({ day, total: d?.total ?? 0, answered: d?.answered ?? 0, missed: (d?.total ?? 0) - (d?.answered ?? 0), talkSec: d?.talksec ?? 0 });
  }
  const yd = byDay.get(dayKey(new Date(now.getTime() - 86400_000), tz));

  res.json({
    today: {
      total: today.length,
      answered: answered.length,
      missed: today.length - answered.length,
      inbound: today.filter((r) => r.direction === 'inbound').length,
      outbound: today.filter((r) => r.direction === 'outbound').length,
      internal: today.filter((r) => r.direction === 'internal').length,
      avgTalkSec: answered.length ? Math.round(answered.reduce((a, r) => a + r.billsec, 0) / answered.length) : 0,
      talkSec: answered.reduce((a, r) => a + r.billsec, 0),
    },
    yesterday: {
      total: yd?.total ?? 0,
      answered: yd?.answered ?? 0,
      missed: (yd?.total ?? 0) - (yd?.answered ?? 0),
      talkSec: yd?.talksec ?? 0,
      avgTalkSec: yd?.answered ? Math.round(yd.talksec / yd.answered) : 0,
    },
    hourly: [...hourly.entries()].map(([hour, v]) => ({ hour, ...v })),
    daily,
    timezone: tz,
  });
});

callRouter.get('/call/:linkedid', async (req, res) => {
  const linkedid = z.string().regex(/^[0-9.]+$/).parse(req.params.linkedid);
  const s = await scope(req, 2);
  res.json(
    await many(
      `SELECT id, calldate, clid, src, dst, channel, dstchannel, lastapp, duration, billsec, disposition, direction, did,
              recordingfile <> '' AS has_recording
         FROM cdr WHERE linkedid = $1 AND ${s.sql} ORDER BY calldate, id`,
      [linkedid, ...s.params],
    ),
  );
});

const RECORDING_RE = /^t\d+\/\d{4}\/\d{2}\/\d{2}\/[0-9A-Za-z._-]+\.wav$/;

callRouter.get('/:id/recording', async (req, res) => {
  const s = await scope(req, 2);
  const row = await one<{ recordingfile: string; calldate: string }>(
    `SELECT recordingfile, calldate FROM cdr WHERE id = $1 AND ${s.sql}`,
    [intParam(req.params.id), ...s.params],
  );
  if (!row || !RECORDING_RE.test(row.recordingfile)) throw notFound('Recording');
  const file = path.join(config.paths.monitorDir, row.recordingfile);
  await fs.access(file).catch(() => {
    throw notFound('Recording file');
  });
  if (req.query.download) res.attachment(`call-${path.basename(row.recordingfile)}`);
  res.sendFile(file);
});

async function timezoneOf(req: Request): Promise<string> {
  const tenantId = tenantOf(req, { required: false });
  if (tenantId === null) return 'Asia/Dhaka';
  const t = await one<{ timezone: string }>('SELECT timezone FROM tenants WHERE id = $1', [tenantId]);
  return t?.timezone ?? 'Asia/Dhaka';
}

function hourKey(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}`;
}

function dayKey(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD, which matches the SQL to_char above.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
