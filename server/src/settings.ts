import { many, exec } from './db.js';
import { config } from './config.js';

export interface Settings {
  /** Hostname SIP phones and the web phone use to reach this server. */
  sip_domain: string;
  /** Public IPv4 address advertised in SIP/SDP. */
  public_ip: string;
  /**
   * Address desk phones inside the server's own office use (its LAN IP), when the router does not
   * hairpin SIP to the public address. Shown in phone setup to platform admins and internal users.
   */
  office_sip_host: string;
  /** Country calling code without "+", used to match DIDs in either national or international form. */
  country_code: string;
  /** National trunk prefix (e.g. "0" in Bangladesh). */
  national_prefix: string;
  stun_server: string;
  company_name: string;
}

export function defaultSettings(): Settings {
  return {
    sip_domain: config.sipDomain,
    public_ip: config.publicIp,
    office_sip_host: '',
    country_code: '880',
    national_prefix: '0',
    stun_server: 'stun:stun.l.google.com:19302',
    company_name: 'Envo',
  };
}

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await many<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const merged: Record<string, unknown> = { ...defaultSettings() };
  // Only the known public keys: other rows (billing credentials) have readers of their own.
  for (const row of rows) if (row.key in merged) merged[row.key] = row.value;
  cache = merged as unknown as Settings;
  return cache;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  cache = null;
  return getSettings();
}
