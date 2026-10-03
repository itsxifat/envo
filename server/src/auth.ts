import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse as parseCookie } from 'cookie';
import { config } from './config.js';
import { one } from './db.js';
import { HttpError, forbidden } from './lib/http.js';

export type Role = 'superadmin' | 'admin' | 'agent';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  tenantId: number | null;
  extensionId: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = 'envo_session';
const SESSION_TTL_SEC = 7 * 24 * 3600;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function issueSession(res: Response, userId: number): void {
  const token = jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: SESSION_TTL_SEC });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    maxAge: SESSION_TTL_SEC * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolves the logged-in user from a raw Cookie header (used by HTTP and WebSocket upgrades). */
export async function userFromCookieHeader(cookieHeader: string | undefined): Promise<SessionUser | null> {
  if (!cookieHeader) return null;
  const token = parseCookie(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  } catch {
    return null;
  }
  const row = await one<{
    id: number;
    email: string;
    name: string;
    role: Role;
    tenant_id: number | null;
    extension_id: number | null;
    enabled: boolean;
    tenant_enabled: boolean | null;
  }>(
    `SELECT u.id, u.email, u.name, u.role, u.tenant_id, u.extension_id, u.enabled, t.enabled AS tenant_enabled
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [Number(payload.sub)],
  );
  if (!row || !row.enabled) return null;
  if (row.role !== 'superadmin' && row.tenant_enabled === false) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tenantId: row.tenant_id,
    extensionId: row.extension_id,
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = await userFromCookieHeader(req.headers.cookie);
  if (!user) return next(new HttpError(401, 'Not signed in'));
  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/**
 * Tenant a request operates on. Superadmins pick one with ?tenant_id= (or body.tenant_id);
 * everyone else is pinned to their own tenant.
 */
export function tenantOf(req: Request, opts: { required?: boolean } = { required: true }): number | null {
  const user = req.user!;
  if (user.role !== 'superadmin') return user.tenantId;
  const raw = (req.query.tenant_id as string | undefined) ?? (req.body && (req.body as Record<string, unknown>).tenant_id);
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) throw new HttpError(400, 'Select a SIP server first (tenant_id is required)');
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid tenant_id');
  return id;
}

export function assertTenantAccess(req: Request, tenantId: number | null): void {
  const user = req.user!;
  if (user.role === 'superadmin') return;
  if (tenantId === null || tenantId !== user.tenantId) throw forbidden();
}

// Simple in-memory limiter for login attempts: 10 per 5 minutes per IP + email.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
}, 60_000).unref();
