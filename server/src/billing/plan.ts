import fs from 'node:fs/promises';
import path from 'node:path';
import { many, one } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import type { AccountStatus } from '../auth.js';

/** Countable limits. null = unlimited, 0 = not included. */
export const LIMIT_KEYS = ['max_servers', 'max_dids', 'max_extensions', 'max_channels', 'max_ivrs', 'recording_mb'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export const FEATURE_KEYS = ['call_monitoring', 'api_access'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const IVR_TIERS = ['basic', 'basic_ai', 'multi_ai', 'advanced_ai', 'unlimited'] as const;
export type IvrTier = (typeof IVR_TIERS)[number];

export interface PlanLimits {
  max_servers: number | null;
  max_dids: number | null;
  max_extensions: number | null;
  max_channels: number | null;
  max_ivrs: number | null;
  recording_mb: number | null;
  /** Days recordings are kept; 0 = recording not included. */
  recording_days: number;
  ivr_tier: IvrTier;
  call_monitoring: boolean;
  api_access: boolean;
}

export interface AccountPlan {
  accountId: number;
  accountName: string;
  internal: boolean;
  status: AccountStatus;
  /** SIP servers work (calls, registrations) only while this is true. */
  usable: boolean;
  package: { id: number; name: string; slug: string } | null;
  subscription: {
    id: number;
    status: 'active' | 'past_due' | 'cancelled';
    price: number;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    nextPackageId: number | null;
  } | null;
  limits: PlanLimits;
}

const UNLIMITED: PlanLimits = {
  max_servers: null,
  max_dids: null,
  max_extensions: null,
  max_channels: null,
  max_ivrs: null,
  recording_mb: null,
  recording_days: 3650,
  ivr_tier: 'unlimited',
  call_monitoring: true,
  api_access: true,
};

/** An account without a package can create nothing until one is assigned or bought. */
const NOTHING: PlanLimits = {
  max_servers: 0,
  max_dids: 0,
  max_extensions: 0,
  max_channels: 0,
  max_ivrs: 0,
  recording_mb: 0,
  recording_days: 0,
  ivr_tier: 'basic',
  call_monitoring: false,
  api_access: false,
};

interface PlanRow {
  id: number;
  name: string;
  status: AccountStatus;
  internal: boolean;
  sub_id: number | null;
  sub_status: 'active' | 'past_due' | 'cancelled' | null;
  sub_price: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean | null;
  next_package_id: number | null;
  overrides: Partial<PlanLimits> | null;
  pkg_id: number | null;
  pkg_name: string | null;
  pkg_slug: string | null;
  max_servers: number | null;
  max_dids: number | null;
  max_extensions: number | null;
  max_channels: number | null;
  max_ivrs: number | null;
  recording_mb: number | null;
  recording_days: number | null;
  ivr_tier: IvrTier | null;
  call_monitoring: boolean | null;
  api_access: boolean | null;
}

function limitsOf(row: PlanRow): PlanLimits {
  if (row.internal) return UNLIMITED;
  if (row.pkg_id === null) return NOTHING;
  const base: PlanLimits = {
    max_servers: row.max_servers,
    max_dids: row.max_dids,
    max_extensions: row.max_extensions,
    max_channels: row.max_channels,
    max_ivrs: row.max_ivrs,
    recording_mb: row.recording_mb,
    recording_days: row.recording_days ?? 0,
    ivr_tier: row.ivr_tier ?? 'basic',
    call_monitoring: !!row.call_monitoring,
    api_access: !!row.api_access,
  };
  // Per-customer overrides win key by key; anything unknown is ignored.
  const o = row.overrides ?? {};
  for (const key of Object.keys(base) as (keyof PlanLimits)[]) {
    if (key in o) (base as unknown as Record<string, unknown>)[key] = (o as Record<string, unknown>)[key];
  }
  return base;
}

const cache = new Map<number, { at: number; plan: AccountPlan }>();
const TTL_MS = 10_000;

/** Call after anything that changes an account, its subscription or its package. */
export function invalidatePlans(accountId?: number): void {
  if (accountId === undefined) cache.clear();
  else cache.delete(accountId);
}

export async function getAccountPlan(accountId: number): Promise<AccountPlan> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;
  const row = await one<PlanRow>(
    `SELECT a.id, a.name, a.status, a.internal,
            s.id AS sub_id, s.status AS sub_status, s.price AS sub_price, s.current_period_end, s.cancel_at_period_end,
            s.next_package_id, s.overrides,
            p.id AS pkg_id, p.name AS pkg_name, p.slug AS pkg_slug, p.max_servers, p.max_dids, p.max_extensions, p.max_channels,
            p.max_ivrs, p.recording_mb, p.recording_days, p.ivr_tier, p.call_monitoring, p.api_access
       FROM accounts a
       LEFT JOIN subscriptions s ON s.account_id = a.id AND s.status <> 'cancelled'
       LEFT JOIN packages p ON p.id = s.package_id
      WHERE a.id = $1`,
    [accountId],
  );
  if (!row) throw new HttpError(404, 'Account not found');
  const plan: AccountPlan = {
    accountId: row.id,
    accountName: row.name,
    internal: row.internal,
    status: row.status,
    usable: row.internal || row.status === 'active',
    package: row.pkg_id ? { id: row.pkg_id, name: row.pkg_name!, slug: row.pkg_slug! } : null,
    subscription: row.sub_id
      ? {
          id: row.sub_id,
          status: row.sub_status!,
          price: Number(row.sub_price ?? 0),
          currentPeriodEnd: row.current_period_end!.toISOString(),
          cancelAtPeriodEnd: !!row.cancel_at_period_end,
          nextPackageId: row.next_package_id,
        }
      : null,
    limits: limitsOf(row),
  };
  cache.set(accountId, { at: Date.now(), plan });
  return plan;
}

const tenantAccount = new Map<number, number>();

export async function accountOfTenant(tenantId: number): Promise<number> {
  const known = tenantAccount.get(tenantId);
  if (known !== undefined) return known;
  const row = await one<{ account_id: number }>('SELECT account_id FROM tenants WHERE id = $1', [tenantId]);
  if (!row) throw new HttpError(404, 'SIP server not found');
  tenantAccount.set(tenantId, row.account_id);
  return row.account_id;
}

export async function planForTenant(tenantId: number): Promise<AccountPlan> {
  return getAccountPlan(await accountOfTenant(tenantId));
}

export interface AccountUsage {
  servers: number;
  dids: number;
  extensions: number;
  ivrs: number;
  users: number;
  /** null when not measured (only the usage page measures disk). */
  recordingMb: number | null;
}

export async function getUsage(accountId: number, opts: { recordings?: boolean } = {}): Promise<AccountUsage> {
  const row = await one<Omit<AccountUsage, 'recordingMb'>>(
    `SELECT (SELECT count(*) FROM tenants WHERE account_id = $1) AS servers,
            (SELECT count(*) FROM numbers n JOIN tenants t ON t.id = n.tenant_id WHERE t.account_id = $1) AS dids,
            (SELECT count(*) FROM extensions e JOIN tenants t ON t.id = e.tenant_id WHERE t.account_id = $1) AS extensions,
            (SELECT count(*) FROM ivrs i JOIN tenants t ON t.id = i.tenant_id WHERE t.account_id = $1) AS ivrs,
            (SELECT count(*) FROM users WHERE account_id = $1) AS users`,
    [accountId],
  );
  const usage: AccountUsage = { servers: 0, dids: 0, extensions: 0, ivrs: 0, users: 0, ...row, recordingMb: null };
  if (opts.recordings) usage.recordingMb = Math.round((await recordingBytes(accountId)) / 1048576);
  return usage;
}

/** Bytes of call recordings stored for every SIP server of the account. */
export async function recordingBytes(accountId: number): Promise<number> {
  const tenants = await many<{ id: number }>('SELECT id FROM tenants WHERE account_id = $1', [accountId]);
  let total = 0;
  for (const t of tenants) total += await dirSize(path.join(config.paths.monitorDir, `t${t.id}`));
  return total;
}

async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

const LABELS: Record<Exclude<LimitKey, 'recording_mb'>, [string, string, keyof AccountUsage]> = {
  max_servers: ['SIP server', 'SIP servers', 'servers'],
  max_dids: ['phone number', 'phone numbers', 'dids'],
  max_extensions: ['extension', 'extensions', 'extensions'],
  max_channels: ['call channel', 'call channels', 'servers'],
  max_ivrs: ['IVR menu', 'IVR menus', 'ivrs'],
};

/** Refuses to create `adding` more of something when the account's package does not allow it. */
export async function assertLimit(accountId: number, key: 'max_servers' | 'max_dids' | 'max_extensions' | 'max_ivrs', adding = 1): Promise<void> {
  const plan = await getAccountPlan(accountId);
  const limit = plan.limits[key];
  if (limit === null) return;
  const [one_, many_, usageKey] = LABELS[key];
  const used = (await getUsage(accountId))[usageKey] as number;
  if (used + adding <= limit) return;
  const pkg = plan.package?.name ?? 'Your account';
  const what = limit === 1 ? one_ : many_;
  throw new HttpError(
    403,
    limit === 0
      ? `${pkg} does not include ${many_}. Upgrade your package to add them.`
      : `${pkg} includes ${limit} ${what} and ${used} ${used === 1 ? 'is' : 'are'} in use. Upgrade your package to add more.`,
    { code: 'limit_reached', limit: key, allowed: limit, used },
  );
}

export async function assertFeature(accountId: number, feature: FeatureKey): Promise<void> {
  const plan = await getAccountPlan(accountId);
  if (plan.limits[feature]) return;
  const label = feature === 'call_monitoring' ? 'Live call monitoring' : 'Developer API access';
  throw new HttpError(403, `${label} is not part of ${plan.package?.name ?? 'your package'}. Upgrade to use it.`, {
    code: 'feature_missing',
    feature,
  });
}
