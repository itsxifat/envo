import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse as parseCookie } from 'cookie';
import { config } from './config.js';
import { one } from './db.js';
import { HttpError, forbidden } from './lib/http.js';

export type Role = 'superadmin' | 'admin' | 'agent';

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'closed';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** Home SIP server: an agent's only one, an admin's default. */
  tenantId: number | null;
  extensionId: number | null;
  /** Customer account; null for platform admins. */
  accountId: number | null;
  accountStatus: AccountStatus | null;
  /** The account owner manages billing and the team. */
  isOwner: boolean;
  /** SIP servers this login may work in; null = every one (platform admins). */
  tenantIds: number[] | null;
  /** A platform admin who opened this customer's portal from /admin (support access). */
  impersonator: { id: number; name: string; email: string } | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = 'envo_session';
const SESSION_TTL_SEC = 7 * 24 * 3600;
/** Support access to a customer's portal ends by itself after this long. */
const IMPERSONATION_TTL_SEC = 4 * 3600;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Signs in as `userId`. With `impersonatorId` a platform admin works in that customer's portal: the
 * session acts as the customer login and remembers who really holds it.
 */
export function issueSession(res: Response, userId: number, opts: { impersonatorId?: number } = {}): void {
  const ttl = opts.impersonatorId ? IMPERSONATION_TTL_SEC : SESSION_TTL_SEC;
  const claims = opts.impersonatorId ? { sub: String(userId), imp: String(opts.impersonatorId) } : { sub: String(userId) };
  const token = jwt.sign(claims, config.jwtSecret, { expiresIn: ttl });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    maxAge: ttl * 1000,
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
    account_id: number | null;
    is_owner: boolean;
    account_status: AccountStatus | null;
    tenant_enabled: boolean | null;
    account_tenants: number[];
  }>(
    `SELECT u.id, u.email, u.name, u.role, u.tenant_id, u.extension_id, u.enabled, u.account_id, u.is_owner,
            a.status AS account_status, t.enabled AS tenant_enabled,
            COALESCE((SELECT array_agg(x.id ORDER BY x.id) FROM tenants x WHERE x.account_id = u.account_id), '{}') AS account_tenants
       FROM users u
       LEFT JOIN accounts a ON a.id = u.account_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1`,
    [Number(payload.sub)],
  );
  if (!row || !row.enabled) return null;
  if (row.role !== 'superadmin') {
    if (row.account_status === 'closed') return null;
    if (row.role === 'agent' && row.tenant_enabled === false) return null;
  }
  let impersonator: SessionUser['impersonator'] = null;
  if (payload.imp) {
    // Support access holds only while the admin behind it is still an active platform admin.
    const imp = await one<{ id: number; name: string; email: string; role: Role; enabled: boolean }>(
      'SELECT id, name, email, role, enabled FROM users WHERE id = $1',
      [Number(payload.imp)],
    );
    if (!imp || !imp.enabled || imp.role !== 'superadmin' || row.role === 'superadmin') return null;
    impersonator = { id: imp.id, name: imp.name, email: imp.email };
  }
  const tenantIds = row.role === 'superadmin' ? null : row.role === 'agent' ? (row.tenant_id ? [row.tenant_id] : []) : row.account_tenants;
  const home = row.tenant_id !== null && (tenantIds === null || tenantIds.includes(row.tenant_id)) ? row.tenant_id : (tenantIds?.[0] ?? row.tenant_id);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tenantId: home,
    extensionId: row.extension_id,
    accountId: row.account_id,
    accountStatus: row.account_status,
    isOwner: row.role === 'superadmin' || row.is_owner,
    tenantIds,
    impersonator,
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
 * The PBX works only for active accounts. Pending (nothing bought yet) and suspended accounts can
 * still sign in, see their plan and pay (/api/account), but not use the phone system.
 */
export function requireActiveAccount(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user!;
  if (user.role === 'superadmin' || user.accountStatus === 'active') return next();
  next(
    new HttpError(
      402,
      user.accountStatus === 'pending' ? 'Choose a package to start using your phone system' : 'Your account is suspended. Renew your package to continue.',
      { code: 'account_inactive', status: user.accountStatus },
    ),
  );
}

/** Owners (and platform admins) only: billing, team and account settings. */
export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user || !req.user.isOwner) return next(forbidden('Only the account owner can do this'));
  next();
}

export function canAccessTenant(user: SessionUser, tenantId: number | null): boolean {
  if (user.tenantIds === null) return true;
  return tenantId !== null && user.tenantIds.includes(tenantId);
}

/**
 * Tenant a request operates on, from ?tenant_id= (or body.tenant_id). Agents are pinned to their own
 * SIP server, admins may pick any server of their account (default: their home server), platform
 * admins any server at all.
 */
export function tenantOf(req: Request, opts: { required?: boolean } = { required: true }): number | null {
  const user = req.user!;
  if (user.role === 'agent') return user.tenantId;
  const raw = (req.query.tenant_id as string | undefined) ?? (req.body && (req.body as Record<string, unknown>).tenant_id);
  if (raw === undefined || raw === null || raw === '') {
    if (user.role === 'superadmin') {
      if (opts.required) throw new HttpError(400, 'Select a SIP server first (tenant_id is required)');
      return null;
    }
    if (user.tenantId === null && opts.required) throw new HttpError(400, 'Create a SIP server first');
    return user.tenantId;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid tenant_id');
  if (!canAccessTenant(user, id)) throw forbidden();
  return id;
}

export function assertTenantAccess(req: Request, tenantId: number | null): void {
  if (!canAccessTenant(req.user!, tenantId)) throw forbidden();
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
