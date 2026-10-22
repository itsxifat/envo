import { exec, one } from '../db.js';

/** Billing configuration (platform admins only): kept apart from the general settings customers can read. */
export interface BillingSettings {
  /** Enfinito Pay (pay.enfinito.com). When on, it takes online payments instead of SSLCommerz. */
  enfinito_pay: {
    enabled: boolean;
    /** sk_test_… (sandbox, no real money) or sk_live_…. */
    secret_key: string;
    /** whsec_…: signs the webhooks Enfinito Pay sends us. */
    webhook_secret: string;
  };
  sslcommerz: {
    enabled: boolean;
    /** Sandbox (sandbox.sslcommerz.com) or live (securepay.sslcommerz.com). */
    sandbox: boolean;
    store_id: string;
    store_passwd: string;
  };
  manual: {
    enabled: boolean;
    /** Shown to customers: bKash/Nagad merchant numbers, bank account, what to write as reference. */
    instructions: string;
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
  manual: {
    enabled: true,
    instructions: 'Send the invoice amount by bKash or bank transfer, then enter the transaction ID below. We confirm payments within a few hours.',
  },
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
    manual: { ...DEFAULT_BILLING.manual, ...(v.manual ?? {}) },
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

/** The gateway that takes online payments: Enfinito Pay when it is set up, else SSLCommerz, else none. */
export function onlineGateway(s: BillingSettings): 'enfinito_pay' | 'sslcommerz' | null {
  if (s.enfinito_pay.enabled && s.enfinito_pay.secret_key) return 'enfinito_pay';
  if (s.sslcommerz.enabled && s.sslcommerz.store_id && s.sslcommerz.store_passwd) return 'sslcommerz';
  return null;
}

/** What customers may know about how to pay: never the gateway credentials. */
export async function publicPaymentOptions(): Promise<{ online: boolean; gateway: 'enfinito_pay' | 'sslcommerz' | null; manual: boolean; manualInstructions: string }> {
  const s = await getBillingSettings();
  const gateway = onlineGateway(s);
  return {
    online: gateway !== null,
    gateway,
    manual: s.manual.enabled,
    manualInstructions: s.manual.instructions,
  };
}
