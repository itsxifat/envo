import { z } from 'zod';
import { one, exec } from '../db.js';
import { badRequest, conflict } from './http.js';
import type { Request } from 'express';

export const DEST_TYPES = [
  'extension',
  'voicemail',
  'ring_group',
  'queue',
  'ivr',
  'time_condition',
  'conference',
  'external',
  'hangup',
] as const;
export type DestType = (typeof DEST_TYPES)[number];

export const destType = z.enum(DEST_TYPES);
export const destTarget = z.string().trim().max(32).default('');

const NUMBERED_TABLES = [
  { table: 'extensions', label: 'extension' },
  { table: 'ring_groups', label: 'ring group' },
  { table: 'queues', label: 'queue' },
  { table: 'ivrs', label: 'IVR' },
  { table: 'conferences', label: 'conference room' },
] as const;

/** Internal numbers share one dial plan per tenant, so they must be unique across entity types. */
export async function assertNumberFree(
  tenantId: number,
  number: string,
  exclude?: { table: string; id: number },
): Promise<void> {
  if (!number) return;
  for (const { table, label } of NUMBERED_TABLES) {
    const row = await one<{ id: number; name: string }>(`SELECT id, name FROM ${table} WHERE tenant_id = $1 AND number = $2`, [
      tenantId,
      number,
    ]);
    if (row && !(exclude && exclude.table === table && exclude.id === row.id)) {
      throw conflict(`Number ${number} is already used by ${label} "${row.name}"`);
    }
  }
}

/** Checks that a destination exists inside the tenant. */
export async function assertDestination(tenantId: number, type: string, target: string, field = 'destination'): Promise<void> {
  const exists = async (sql: string, params: unknown[]) => !!(await one(sql, params));
  let ok = false;
  switch (type) {
    case 'hangup':
      ok = true;
      break;
    case 'external':
      ok = /^\+?[0-9]{3,20}$/.test(target);
      if (!ok) throw badRequest(`${field}: enter a valid phone number`);
      break;
    case 'extension':
      ok = await exists('SELECT 1 FROM extensions WHERE tenant_id = $1 AND number = $2', [tenantId, target]);
      break;
    case 'voicemail':
      ok = await exists('SELECT 1 FROM extensions WHERE tenant_id = $1 AND number = $2 AND voicemail', [tenantId, target]);
      break;
    case 'ring_group':
      ok = /^\d+$/.test(target) && (await exists('SELECT 1 FROM ring_groups WHERE tenant_id = $1 AND id = $2', [tenantId, Number(target)]));
      break;
    case 'queue':
      ok = /^\d+$/.test(target) && (await exists('SELECT 1 FROM queues WHERE tenant_id = $1 AND id = $2', [tenantId, Number(target)]));
      break;
    case 'ivr':
      ok = /^\d+$/.test(target) && (await exists('SELECT 1 FROM ivrs WHERE tenant_id = $1 AND id = $2', [tenantId, Number(target)]));
      break;
    case 'time_condition':
      ok =
        /^\d+$/.test(target) &&
        (await exists('SELECT 1 FROM time_conditions WHERE tenant_id = $1 AND id = $2', [tenantId, Number(target)]));
      break;
    case 'conference':
      ok = /^\d+$/.test(target) && (await exists('SELECT 1 FROM conferences WHERE tenant_id = $1 AND id = $2', [tenantId, Number(target)]));
      break;
    default:
      throw badRequest(`${field}: unknown destination type`);
  }
  if (!ok) throw badRequest(`${field}: the selected ${type.replace('_', ' ')} does not exist in this SIP server`);
}

export async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId: string | number,
  summary = '',
  tenantId?: number | null,
): Promise<void> {
  await exec(
    'INSERT INTO audit_log (user_id, tenant_id, action, entity, entity_id, summary) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.user?.id ?? null, tenantId ?? req.user?.tenantId ?? null, action, entity, String(entityId), summary.slice(0, 300)],
  ).catch((err) => console.warn('[audit] failed:', err));
}

// Shared field schemas
export const phoneNumber = z.string().trim().regex(/^\+?[0-9]{3,20}$/, 'must be a phone number (digits, optional +)');
export const optionalPhone = z.union([z.literal(''), phoneNumber]).default('');
export const internalNumber = z.string().trim().regex(/^[0-9]{2,8}$/, 'must be 2-8 digits');
export const optionalInternalNumber = z.union([z.literal(''), internalNumber]).default('');
export const name = z.string().trim().min(1, 'is required').max(60);
export const forwardTarget = z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9*#]{2,32}$/, 'must be a number')]).default('');
