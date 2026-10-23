import { exec, one } from '../db.js';

/**
 * Numbers Enfinito provides (from its operator allocation, e.g. ICC): whether customers may ask for
 * one, which line a new number is connected on, and balance top-ups. Platform admins only.
 */
export interface SupplySettings {
  /** Customers see "Get a number from us" and "Apply for a special number". On unless switched off. */
  enabled: boolean;
  /** Named in the customer's consent: their details are shared with this operator. */
  operator_name: string;
  /** The operator's SIP server a new number registers to (its username and password come per number). */
  line: { host: string; port: number; transport: 'udp' | 'tcp' | 'tls' };
  topup: { enabled: boolean; min: number; max: number; presets: number[] };
}

export const DEFAULT_SUPPLY: SupplySettings = {
  enabled: true,
  operator_name: 'ICC Communication Ltd.',
  line: { host: '', port: 5060, transport: 'udp' },
  topup: { enabled: true, min: 50, max: 20_000, presets: [100, 200, 500, 1000] },
};

let cache: SupplySettings | null = null;

export async function getSupplySettings(): Promise<SupplySettings> {
  if (cache) return cache;
  const row = await one<{ value: Partial<SupplySettings> }>("SELECT value FROM settings WHERE key = 'number_supply'");
  const v = row?.value ?? {};
  cache = {
    ...DEFAULT_SUPPLY,
    ...v,
    line: { ...DEFAULT_SUPPLY.line, ...(v.line ?? {}) },
    topup: { ...DEFAULT_SUPPLY.topup, ...(v.topup ?? {}) },
  };
  return cache;
}

export async function updateSupplySettings(next: SupplySettings): Promise<SupplySettings> {
  await exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ('number_supply', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  cache = null;
  return getSupplySettings();
}
