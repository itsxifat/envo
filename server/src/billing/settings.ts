import { exec, one } from '../db.js';

/** Billing configuration (platform admins only): kept apart from the general settings customers can read. */
export interface BillingSettings {
  /** Enfinito Pay (pay.enfinito.com): the only way customers pay, in the app and on the website. */
  enfinito_pay: {
    enabled: boolean;
    /** sk_test_… (sandbox, no real money) or sk_live_…. */
    secret_key: string;
    /** whsec_…: signs the webhooks Enfinito Pay sends us. */
    webhook_secret: string;
  };
  /** The gateway used before Enfinito Pay: kept only so payments started there can still settle. */
  sslcommerz: {
    enabled: boolean;
    /** Sandbox (sandbox.sslcommerz.com) or live (securepay.sslcommerz.com). */
    sandbox: boolean;
    store_id: string;
    store_passwd: string;
  };
  /** Days after a period ends before an unpaid account is suspended. */
  grace_days: number;
  /** Renewal invoices are issued this many days before a period ends. */
  renewal_notice_days: number;
  /** Seller details printed on invoices. */
  business: { name: string; address: string; email: string; phone: string };
}

export const DEFAULT_BILLING: BillingSettings = {
  enfinito_pay: { enabled: false, secret_key: '', webhook_secret: '' },
  sslcommerz: { enabled: false, sandbox: true, store_id: '', store_passwd: '' },
  grace_days: 3,
  renewal_notice_days: 7,
  business: { name: 'Enfinito', address: 'Dhaka, Bangladesh', email: '', phone: '' },
};

let cache: BillingSettings | null = null;

export async function getBillingSettings(): Promise<BillingSettings> {
  if (cache) return cache;
  const row = await one<{ value: Partial<BillingSettings> }>("SELECT value FROM settings WHERE key = 'billing'");
  const v = row?.value ?? {};
  cache = {
    ...DEFAULT_BILLING,
    ...v,
    enfinito_pay: { ...DEFAULT_BILLING.enfinito_pay, ...(v.enfinito_pay ?? {}) },
    sslcommerz: { ...DEFAULT_BILLING.sslcommerz, ...(v.sslcommerz ?? {}) },
    business: { ...DEFAULT_BILLING.business, ...(v.business ?? {}) },
  };
  return cache;
}

export async function updateBillingSettings(next: BillingSettings): Promise<BillingSettings> {
  await exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ('billing', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  cache = null;
  return getBillingSettings();
}

/** Customers pay through Enfinito Pay only, once it is switched on with its keys. */
export function onlineGateway(s: BillingSettings): 'enfinito_pay' | null {
  return s.enfinito_pay.enabled && s.enfinito_pay.secret_key ? 'enfinito_pay' : null;
}

/** What customers may know about how to pay: never the gateway credentials. */
export async function publicPaymentOptions(): Promise<{ online: boolean; gateway: 'enfinito_pay' | null }> {
  const gateway = onlineGateway(await getBillingSettings());
  return { online: gateway !== null, gateway };
}
