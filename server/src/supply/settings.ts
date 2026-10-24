import { exec, one } from '../db.js';

/**
 * Numbers Enfinito provides from its providers' allocations (today only ICC): whether customers may
 * ask for one, the providers with their number prefix and SIP server, and balance top-ups. Platform
 * admins only.
 */
export interface SupplyProvider {
  /** Stable id, kept on requests (e.g. "icc"). */
  id: string;
  /** Shown to customers and named in their consent: their details are shared with this provider. */
  name: string;
  /** Every number of this provider starts with it, e.g. "09639". */
  prefix: string;
  /** Digits in a whole number, the prefix included (11 in Bangladesh). */
  length: number;
  /** Customers can choose it. */
  enabled: boolean;
  /** The SIP server a new number registers to (its username and password come per number). */
  line: { host: string; port: number; transport: 'udp' | 'tcp' | 'tls' };
}

export interface SupplySettings {
  /** Customers see "Get a number from us" and "Apply for a special number". On unless switched off. */
  enabled: boolean;
  providers: SupplyProvider[];
  topup: { enabled: boolean; min: number; max: number; presets: number[] };
}

export const DEFAULT_PROVIDER: SupplyProvider = {
  id: 'icc',
  name: 'ICC Communication Ltd.',
  prefix: '09639',
  length: 11,
  enabled: true,
  line: { host: '103.15.140.151', port: 5060, transport: 'udp' },
};

export const DEFAULT_SUPPLY: SupplySettings = {
  enabled: true,
  providers: [DEFAULT_PROVIDER],
  topup: { enabled: true, min: 50, max: 20_000, presets: [100, 200, 500, 1000] },
};

/** Settings saved before providers existed: one operator name and one SIP server. */
interface StoredSettings extends Partial<SupplySettings> {
  operator_name?: string;
  line?: Partial<SupplyProvider['line']>;
}

let cache: SupplySettings | null = null;

export async function getSupplySettings(): Promise<SupplySettings> {
  if (cache) return cache;
  const row = await one<{ value: StoredSettings }>("SELECT value FROM settings WHERE key = 'number_supply'");
  const { operator_name, line, ...v } = row?.value ?? {};
  // ICC saved before its SIP server was known gets ICC's.
  const known = (p: SupplyProvider): SupplyProvider => (p.id === DEFAULT_PROVIDER.id && !p.line.host ? { ...p, line: { ...p.line, host: DEFAULT_PROVIDER.line.host } } : p);
  cache = {
    ...DEFAULT_SUPPLY,
    ...v,
    // Older settings become the one provider they described (ICC).
    providers: (v.providers ?? [{ ...DEFAULT_PROVIDER, name: operator_name ?? DEFAULT_PROVIDER.name, line: { ...DEFAULT_PROVIDER.line, ...(line ?? {}) } }]).map(known),
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

/** The providers customers can choose. */
export const activeProviders = (s: SupplySettings) => s.providers.filter((p) => p.enabled);

/** The provider whose prefix a number starts with (the longest prefix wins). */
export function providerOfNumber(s: SupplySettings, number: string): SupplyProvider | null {
  return [...s.providers].sort((a, b) => b.prefix.length - a.prefix.length).find((p) => number.startsWith(p.prefix)) ?? null;
}
