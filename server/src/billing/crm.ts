import crypto from 'node:crypto';
import { config } from '../config.js';
import { exec, one } from '../db.js';
import { NO_TAX, type TaxPolicy } from './tax.js';

/**
 * The connection to the Enfinito CRM (CRM_BASE_URL + CRM_API_SECRET). Calls are signed like the CRM's other
 * webhooks: Envo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">.
 */

export class CrmError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

export const crmEnabled = (): boolean => !!config.crm.baseUrl && !!config.crm.secret;

export const crmHost = (): string | null => {
  try {
    return config.crm.baseUrl ? new URL(config.crm.baseUrl).host : null;
  } catch {
    return config.crm.baseUrl;
  }
};

export async function crmCall<T>(body: Record<string, unknown>, timeoutMs = 55_000): Promise<T> {
  const text = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', config.crm.secret).update(`${t}.`).update(text).digest('hex');
  const res = await fetch(`${config.crm.baseUrl}/api/webhooks/envo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Envo', 'envo-signature': `t=${t},v1=${v1}` },
    body: text,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err: Error) => {
    throw new CrmError(0, `The CRM did not answer: ${err.message}`);
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw new CrmError(res.status, data?.error ?? `The CRM answered ${res.status}`, retryAfter * 1000);
  }
  return data;
}

// ---------------------------------------------------------------------------------- tax settings
// Kept in the database as well: customers can check out while the CRM is away or Envo has just restarted.
const POLICY_KEY = 'crm_policy';
let policy: TaxPolicy | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const row = await one<{ value: TaxPolicy }>('SELECT value FROM settings WHERE key = $1', [POLICY_KEY]);
  policy = row?.value ?? null;
  loaded = true;
}

/** The tax settings to bill with; null only when connected but the CRM has never been reached. */
export async function currentPolicy(): Promise<TaxPolicy | null> {
  if (!crmEnabled()) return NO_TAX;
  await ensureLoaded();
  return policy;
}

/** Connected to another CRM: its rules apply, so nothing is billed until it has given them. */
export async function forgetPolicy(): Promise<void> {
  await exec('DELETE FROM settings WHERE key = $1', [POLICY_KEY]);
  policy = null;
  loaded = true;
}

/** Asks the CRM for its tax settings. A failure keeps the last ones. */
export async function refreshPolicy(): Promise<TaxPolicy | null> {
  await ensureLoaded();
  const data = await crmCall<{ policy: TaxPolicy }>({ type: 'policy' }, 20_000);
  const next = data.policy;
  if (JSON.stringify(next) !== JSON.stringify(policy)) {
    await exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [POLICY_KEY, JSON.stringify(next)],
    );
    if (policy?.version !== next.version) console.log(`[crm] tax settings now ${next.vatTreatment} ${next.vatRate}% (${next.version})`);
    policy = next;
  }
  return policy;
}
