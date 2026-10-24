import { exec, one } from '../db.js';

/**
 * Envo Phone (the phone app and the website's personal side), as set by platform admins: whether
 * people can sign up, the first recharge that activates a number, recharges after that, what calls
 * cost, and what the app shows and requires.
 */
export interface PhoneSettings {
  /** New people can sign up. Those who have an account can always sign in. */
  signups: boolean;
  /** The provider whose pool personal numbers come from (an id from number supply, e.g. "icc"). */
  provider: string;
  /** The least first recharge, BDT: it activates the number and all of it becomes balance. */
  activation_min: number;
  /** Later recharges, BDT. */
  recharge: { min: number; max: number; presets: number[] };
  /** BDT per started minute of an answered call to another network. */
  rate_per_min: number;
  /** Calls between Envo numbers cost nothing. */
  free_onnet: boolean;
  /**
   * The selfie is taken live (looking straight, then turning the head) and checked automatically, and
   * matched with the NID photo. Off: any photo is accepted and support compares by eye.
   */
  selfie_check: boolean;
  /** Shown under "Help and support" in the app. */
  support: { phone: string; email: string };
  /** Older apps are asked to update before they can be used (e.g. "1.0.0"). */
  min_app_version: string;
  /** Where the update button goes: the Play Store page or a download link. */
  update_url: string;
}

export const DEFAULT_PHONE: PhoneSettings = {
  signups: true,
  provider: 'icc',
  activation_min: 100,
  recharge: { min: 50, max: 10_000, presets: [100, 200, 500, 1000] },
  rate_per_min: 0.4,
  free_onnet: true,
  selfie_check: true,
  support: { phone: '', email: '' },
  min_app_version: '1.0.0',
  update_url: '',
};

let cache: PhoneSettings | null = null;

export async function getPhoneSettings(): Promise<PhoneSettings> {
  if (cache) return cache;
  const row = await one<{ value: Partial<PhoneSettings> }>("SELECT value FROM settings WHERE key = 'phone_app'");
  const v = row?.value ?? {};
  cache = {
    ...DEFAULT_PHONE,
    ...v,
    recharge: { ...DEFAULT_PHONE.recharge, ...(v.recharge ?? {}) },
    support: { ...DEFAULT_PHONE.support, ...(v.support ?? {}) },
  };
  return cache;
}

export async function updatePhoneSettings(next: PhoneSettings): Promise<PhoneSettings> {
  await exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ('phone_app', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  cache = null;
  return getPhoneSettings();
}
