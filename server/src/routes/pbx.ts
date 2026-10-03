import { accountOfTenant, assertLimit } from '../billing/plan.js';
import { z } from 'zod';
import { many, one } from '../db.js';
import { badRequest } from '../lib/http.js';
import {
  assertDestination,
  destTarget,
  destType,
  internalNumber,
  name,
  optionalInternalNumber,
  optionalPhone,
} from '../lib/validate.js';
import { isDialPattern } from '../asterisk/sanitize.js';
import { crudRouter } from './crud.js';

async function assertMembers(tenantId: number, members: string[]): Promise<void> {
  if (!members.length) return;
  const rows = await many<{ number: string }>('SELECT number FROM extensions WHERE tenant_id = $1 AND number = ANY($2)', [
    tenantId,
    members,
  ]);
  const found = new Set(rows.map((r) => r.number));
  const missing = members.filter((m) => !found.has(m));
  if (missing.length) throw badRequest(`Unknown extension(s): ${missing.join(', ')}`);
}

async function assertSound(tenantId: number, soundId: number | null | undefined): Promise<void> {
  if (!soundId) return;
  const row = await one('SELECT 1 FROM sounds WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)', [soundId, tenantId]);
  if (!row) throw badRequest('The selected sound does not exist');
}

const uniqueMembers = z
  .array(internalNumber)
  .max(100)
  .default([])
  .transform((m) => [...new Set(m)]);

// ---------------------------------------------------------------- IVR menus
const ivrSchema = z.object({
  name,
  number: optionalInternalNumber,
  greeting_sound_id: z.number().int().positive().nullable().default(null),
  timeout: z.number().int().min(1).max(60).default(5),
  max_retries: z.number().int().min(1).max(10).default(3),
  direct_dial: z.boolean().default(true),
  options: z
    .array(z.object({ digit: z.string().regex(/^[0-9*#]$/, 'must be 0-9, * or #'), dest_type: destType, dest_target: destTarget }))
    .max(12)
    .default([]),
  timeout_dest_type: destType.default('hangup'),
  timeout_dest_target: destTarget,
  invalid_dest_type: destType.default('hangup'),
  invalid_dest_target: destTarget,
});

export const ivrRouter = crudRouter({
  table: 'ivrs',
  entity: 'ivr',
  schema: ivrSchema,
  jsonColumns: ['options'],
  hasNumber: true,
  validate: async (data, tenantId, _req, existingId) => {
    if (existingId === undefined) await assertLimit(await accountOfTenant(tenantId), 'max_ivrs');
    const digits = data.options.map((o) => o.digit);
    if (new Set(digits).size !== digits.length) throw badRequest('Each key can only be used once');
    await assertSound(tenantId, data.greeting_sound_id);
    for (const o of data.options) await assertDestination(tenantId, o.dest_type, o.dest_target, `Key ${o.digit}`);
    await assertDestination(tenantId, data.timeout_dest_type, data.timeout_dest_target, 'Timeout destination');
    await assertDestination(tenantId, data.invalid_dest_type, data.invalid_dest_target, 'Invalid destination');
  },
});

// ---------------------------------------------------------------- Ring groups
const ringGroupSchema = z.object({
  name,
  number: optionalInternalNumber,
  strategy: z.enum(['ringall', 'hunt']).default('ringall'),
  members: uniqueMembers,
  ring_time: z.number().int().min(5).max(300).default(20),
  cid_prefix: z.string().trim().max(20).default(''),
  failover_dest_type: destType.default('hangup'),
  failover_dest_target: destTarget,
});

export const ringGroupRouter = crudRouter({
  table: 'ring_groups',
  entity: 'ring_group',
  schema: ringGroupSchema,
  hasNumber: true,
  validate: async (data, tenantId) => {
    await assertMembers(tenantId, data.members);
    await assertDestination(tenantId, data.failover_dest_type, data.failover_dest_target, 'Failover destination');
  },
});

// ---------------------------------------------------------------- Queues
const queueSchema = z.object({
  name,
  number: optionalInternalNumber,
  strategy: z.enum(['ringall', 'leastrecent', 'fewestcalls', 'random', 'rrmemory', 'linear']).default('ringall'),
  members: uniqueMembers,
  agent_timeout: z.number().int().min(5).max(120).default(15),
  max_wait: z.number().int().min(0).max(7200).default(300),
  wrapup: z.number().int().min(0).max(600).default(0),
  announce_position: z.boolean().default(true),
  join_sound_id: z.number().int().positive().nullable().default(null),
  failover_dest_type: destType.default('hangup'),
  failover_dest_target: destTarget,
});

export const queueRouter = crudRouter({
  table: 'queues',
  entity: 'queue',
  schema: queueSchema,
  hasNumber: true,
  validate: async (data, tenantId) => {
    await assertMembers(tenantId, data.members);
    await assertSound(tenantId, data.join_sound_id);
    await assertDestination(tenantId, data.failover_dest_type, data.failover_dest_target, 'Failover destination');
  },
});

// ---------------------------------------------------------------- Time conditions
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'must be HH:MM');
const timeConditionSchema = z.object({
  name,
  mode: z.enum(['auto', 'open', 'closed']).default('auto'),
  rules: z
    .array(
      z.object({
        days: z.array(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).min(1, 'pick at least one day'),
        start: hhmm,
        end: hhmm,
      }),
    )
    .max(20)
    .default([]),
  holidays: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'), name: z.string().max(60).default('') }))
    .max(100)
    .default([]),
  match_dest_type: destType.default('hangup'),
  match_dest_target: destTarget,
  nomatch_dest_type: destType.default('hangup'),
  nomatch_dest_target: destTarget,
});

export const timeConditionRouter = crudRouter({
  table: 'time_conditions',
  entity: 'time_condition',
  schema: timeConditionSchema,
  jsonColumns: ['rules', 'holidays'],
  validate: async (data, tenantId, _req, existingId) => {
    for (const r of data.rules) if (r.start >= r.end && r.end !== '24:00') throw badRequest('Each time range must end after it starts');
    const selfRef = (type: string, target: string) => type === 'time_condition' && existingId !== undefined && Number(target) === existingId;
    if (selfRef(data.match_dest_type, data.match_dest_target) || selfRef(data.nomatch_dest_type, data.nomatch_dest_target)) {
      throw badRequest('A time condition cannot point to itself');
    }
    await assertDestination(tenantId, data.match_dest_type, data.match_dest_target, 'Open destination');
    await assertDestination(tenantId, data.nomatch_dest_type, data.nomatch_dest_target, 'Closed destination');
  },
});

// ---------------------------------------------------------------- Blocked callers
const blockedSchema = z
  .object({
    match: z.enum(['exact', 'prefix', 'anonymous']).default('exact'),
    number: z.string().trim().max(24).default(''),
    note: z.string().trim().max(80).default(''),
  })
  .transform((v) => (v.match === 'anonymous' ? { ...v, number: 'anonymous' } : v))
  .superRefine((v, ctx) => {
    if (v.match === 'exact' && !/^\+?[0-9]{3,20}$/.test(v.number)) ctx.addIssue({ code: 'custom', path: ['number'], message: 'must be a phone number' });
    if (v.match === 'prefix' && !/^\+?[0-9]{1,15}$/.test(v.number)) ctx.addIssue({ code: 'custom', path: ['number'], message: 'must be digits' });
  });

export const blockedRouter = crudRouter({
  table: 'blocked_numbers',
  entity: 'blocked_number',
  schema: blockedSchema,
  orderBy: 'created_at DESC',
});

// ---------------------------------------------------------------- Conference rooms
const conferenceSchema = z.object({
  name,
  number: internalNumber,
  pin: z.union([z.literal(''), z.string().regex(/^[0-9]{3,10}$/, 'must be 3-10 digits')]).default(''),
  max_members: z.number().int().min(2).max(200).default(20),
  announce_join: z.boolean().default(true),
});

export const conferenceRouter = crudRouter({
  table: 'conferences',
  entity: 'conference',
  schema: conferenceSchema,
  hasNumber: true,
});

// ---------------------------------------------------------------- Outbound routes
const outboundRouteSchema = z.object({
  name,
  priority: z.number().int().min(0).max(1000).default(10),
  patterns: z
    .array(z.string().trim().refine(isDialPattern, 'invalid dial pattern'))
    .min(1, 'add at least one dial pattern')
    .max(30),
  strip: z.number().int().min(0).max(20).default(0),
  prepend: z.string().trim().regex(/^\+?[0-9]{0,15}$/, 'digits only').default(''),
  callerid: optionalPhone,
  trunk_ids: z.array(z.number().int().positive()).min(1, 'pick at least one trunk').max(5),
  enabled: z.boolean().default(true),
});

export const outboundRouteRouter = crudRouter({
  table: 'outbound_routes',
  entity: 'outbound_route',
  schema: outboundRouteSchema,
  orderBy: 'priority, id',
  validate: async (data, tenantId) => {
    const rows = await many<{ id: number }>(
      'SELECT id FROM trunks WHERE id = ANY($1) AND (tenant_id IS NULL OR tenant_id = $2)',
      [data.trunk_ids, tenantId],
    );
    if (rows.length !== new Set(data.trunk_ids).size) throw badRequest('One of the selected trunks is not available to this SIP server');
  },
});
