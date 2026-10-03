import { getBillingSettings } from './settings.js';
import { HttpError } from '../lib/http.js';

/** SSLCommerz v4 hosted payment page: https://developer.sslcommerz.com/doc/v4/ */

function base(sandbox: boolean): string {
  return sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
}

async function credentials() {
  const s = (await getBillingSettings()).sslcommerz;
  if (!s.enabled || !s.store_id || !s.store_passwd) throw new HttpError(400, 'Online payment is not set up yet');
  return s;
}

export interface SessionRequest {
  tranId: string;
  amount: number;
  productName: string;
  customer: { name: string; email: string; phone: string; address: string };
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
}

/** Opens a payment session; the customer's browser goes to the returned page. */
export async function createSession(req: SessionRequest): Promise<{ url: string; sessionKey: string }> {
  const s = await credentials();
  const form = new URLSearchParams({
    store_id: s.store_id,
    store_passwd: s.store_passwd,
    total_amount: req.amount.toFixed(2),
    currency: 'BDT',
    tran_id: req.tranId,
    success_url: req.successUrl,
    fail_url: req.failUrl,
    cancel_url: req.cancelUrl,
    ipn_url: req.ipnUrl,
    cus_name: req.customer.name.slice(0, 50),
    cus_email: req.customer.email.slice(0, 50),
    cus_add1: (req.customer.address || 'Dhaka').slice(0, 50),
    cus_city: 'Dhaka',
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    cus_phone: req.customer.phone || '01700000000',
    shipping_method: 'NO',
    num_of_item: '1',
    product_name: req.productName.slice(0, 255),
    product_category: 'Cloud PBX subscription',
    product_profile: 'non-physical-goods',
  });
  const res = await fetch(`${base(s.sandbox)}/gwprocess/v4/api.php`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20_000),
  }).catch((err: Error) => {
    throw new HttpError(502, `The payment gateway did not answer (${err.message})`);
  });
  const data = (await res.json().catch(() => null)) as { status?: string; GatewayPageURL?: string; sessionkey?: string; failedreason?: string } | null;
  if (!data || data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw new HttpError(502, `The payment gateway refused the payment: ${data?.failedreason || 'no reason given'}`);
  }
  return { url: data.GatewayPageURL, sessionKey: data.sessionkey ?? '' };
}

export interface Validation {
  status: string;
  tran_id: string;
  val_id: string;
  amount: string;
  currency_type?: string;
  currency?: string;
  bank_tran_id?: string;
  card_type?: string;
  risk_level?: string;
  risk_title?: string;
  [key: string]: unknown;
}

/** The authoritative check: asks SSLCommerz what really happened to a payment (by val_id). */
export async function validate(valId: string): Promise<Validation | null> {
  const s = await credentials();
  const q = new URLSearchParams({ val_id: valId, store_id: s.store_id, store_passwd: s.store_passwd, v: '1', format: 'json' });
  const res = await fetch(`${base(s.sandbox)}/validator/api/validationserverAPI.php?${q}`, { signal: AbortSignal.timeout(20_000) });
  return (await res.json().catch(() => null)) as Validation | null;
}

/** Looks a transaction up by our tran_id (for payments whose redirect never came back). */
export async function queryTransaction(tranId: string): Promise<Validation[]> {
  const s = await credentials();
  const q = new URLSearchParams({ tran_id: tranId, store_id: s.store_id, store_passwd: s.store_passwd, format: 'json' });
  const res = await fetch(`${base(s.sandbox)}/validator/api/merchantTransIDvalidationAPI.php?${q}`, { signal: AbortSignal.timeout(20_000) });
  const data = (await res.json().catch(() => null)) as { element?: Validation[] } | null;
  return data?.element ?? [];
}
