import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { getBillingSettings } from './settings.js';

/**
 * Enfinito Pay (pay.enfinito.com): one checkout for every Enfinito product. We create a checkout,
 * send the customer to it and learn the result from its signed webhook, or by asking for the
 * checkout server to server. The browser coming back is never proof of payment.
 */

export type CheckoutStatus = 'open' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded';

export interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  livemode: boolean;
  status: CheckoutStatus;
  reference: string;
  currency: string;
  amount_total: number;
  url: string;
  expires_at: string;
  payment?: { method: string; transaction_id: string; invoice_number?: string; payer_mobile?: string; paid_at: string } | null;
  metadata?: Record<string, string>;
}

export interface CheckoutRequest {
  reference: string;
  items: { name: string; amount: number; quantity?: number }[];
  description?: string;
  customer?: { name?: string; email?: string; phone?: string; address?: string };
  success_url: string;
  cancel_url: string;
  metadata?: Record<string, string>;
}

export interface WebhookEvent {
  id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'checkout.expired' | 'checkout.cancelled' | string;
  livemode: boolean;
  data: CheckoutSession;
}

/** "test" for sk_test_ keys, "live" for sk_live_ keys. */
export function keyMode(key: string): 'test' | 'live' | null {
  return key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : null;
}

async function secretKey(): Promise<string> {
  const s = (await getBillingSettings()).enfinito_pay;
  if (!s.enabled || !s.secret_key) throw new HttpError(400, 'Online payment is not set up yet');
  return s.secret_key;
}

async function call<T>(method: 'GET' | 'POST', path: string, opts: { body?: unknown; idempotencyKey?: string; key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.key ?? (await secretKey())}`, Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${config.enfinitoPayApi}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(15_000),
  }).catch((err: Error) => {
    throw new HttpError(502, `Enfinito Pay did not answer (${err.message})`);
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok || !data) {
    const message = data?.error?.message ?? `HTTP ${res.status}`;
    console.warn(`[enfinito-pay] ${method} ${path}: ${res.status} ${data?.error?.code ?? ''} ${message}`);
    throw new HttpError(res.status === 404 ? 404 : 502, `Enfinito Pay: ${message}`);
  }
  return data;
}

/** Opens a checkout; repeating it with the same idempotency key returns the same checkout. */
export function createCheckout(req: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession> {
  return call<CheckoutSession>('POST', '/checkout/sessions', { body: req, idempotencyKey });
}

export function retrieveCheckout(id: string): Promise<CheckoutSession> {
  return call<CheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

export function cancelCheckout(id: string): Promise<CheckoutSession> {
  return call<CheckoutSession>('POST', `/checkout/sessions/${encodeURIComponent(id)}/cancel`, { body: {} });
}

/**
 * Checks a secret key without touching any payment: asking for a checkout that does not exist
 * answers 404 to a valid key and 401 to an invalid or revoked one.
 */
export async function checkKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    await call('GET', '/checkout/sessions/cs_envo_key_check', { key });
    return { ok: true, message: 'The key works' };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { ok: true, message: 'The key works' };
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * Enfinito-Signature is "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${raw body}`>", keyed with
 * the product's whsec_ secret. Old timestamps are refused so a captured event cannot be replayed.
 */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = new Map(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = parts.get('t') ?? '';
  const v1 = parts.get('v1') ?? '';
  if (!/^\d+$/.test(t) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}

/** A Bangladeshi mobile number as Enfinito Pay accepts it (01XXXXXXXXX), or undefined. */
export function bdMobile(phone: string): string | undefined {
  const digits = phone.replace(/[^\d]/g, '').replace(/^(?:00)?880?(?=1)/, '0');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : undefined;
}
