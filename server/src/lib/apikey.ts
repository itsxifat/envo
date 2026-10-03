import { planForTenant } from '../billing/plan.js';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { one, exec } from '../db.js';
import { HttpError, forbidden } from './http.js';

export interface ApiKeyRecord {
  id: number;
  tenant_id: number;
  name: string;
  scopes: string[];
  allowed_origins: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: ApiKeyRecord;
  }
}

export const API_SCOPES = ['read', 'calls', 'webphone'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const hashKey = (key: string): string => crypto.createHash('sha256').update(key).digest('hex');

/** A new key: the plaintext is shown once, only its hash is stored. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `envo_live_${crypto.randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 18), hash: hashKey(key) };
}

// Token bucket per key: 120 requests/minute, small burst allowance.
const buckets = new Map<number, { tokens: number; updated: number }>();
function allow(keyId: number, perMinute = 120): boolean {
  const now = Date.now();
  const bucket = buckets.get(keyId) ?? { tokens: perMinute, updated: now };
  const refill = ((now - bucket.updated) / 60_000) * perMinute;
  bucket.tokens = Math.min(perMinute, bucket.tokens + refill);
  bucket.updated = now;
  if (bucket.tokens < 1) {
    buckets.set(keyId, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(keyId, bucket);
  return true;
}

export async function loadApiKey(raw: string): Promise<ApiKeyRecord | null> {
  if (!raw || raw.length < 20) return null;
  return one<ApiKeyRecord>(
    'SELECT id, tenant_id, name, scopes, allowed_origins FROM api_keys WHERE key_hash = $1 AND enabled',
    [hashKey(raw)],
  );
}

/** Allows the browser origins configured on the key (used for in-page integrations). */
export function applyCors(res: Response, origin: string | undefined, allowed: string): boolean {
  const list = allowed.split(/[\s,]+/).filter(Boolean);
  const ok = !origin || list.includes('*') || list.includes(origin);
  if (origin && ok) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return ok;
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-api-key'] ?? '').trim();
  const key = await loadApiKey(raw);
  if (!key) {
    // Preflight requests carry no credentials; answer them permissively so the real call can run.
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Api-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.status(204).end();
      return;
    }
    return next(new HttpError(401, 'Missing or invalid API key'));
  }
  if (!applyCors(res, req.headers.origin, key.allowed_origins)) {
    return next(forbidden('This origin is not allowed for this API key'));
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (!allow(key.id)) return next(new HttpError(429, 'Rate limit exceeded (120 requests/minute)'));
  // The key works only while its customer's package includes the API and the account is active.
  try {
    const plan = await planForTenant(key.tenant_id);
    if (!plan.usable) return next(new HttpError(402, 'This account is not active'));
    if (!plan.limits.api_access) return next(forbidden('API access is not part of this package'));
  } catch (err) {
    return next(err);
  }
  req.apiKey = key;
  void exec('UPDATE api_keys SET last_used_at = now(), requests = requests + 1 WHERE id = $1', [key.id]).catch(() => undefined);
  next();
}

export function requireScope(scope: ApiScope) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiKey?.scopes.includes(scope)) return next(forbidden(`This API key is missing the "${scope}" scope`));
    next();
  };
}
