import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { exec, one, tx } from '../db.js';
import { hashPassword, issueSession } from '../auth.js';
import { HttpError, badRequest, conflict } from '../lib/http.js';
import { sendMail } from '../lib/mailer.js';
import { emails } from '../lib/emails.js';
import { closeSetup, needsSetup, setupTokenValid } from '../setup.js';

/** Public self-service: sign up, confirm email, reset password. No session needed. */
export const signupRouter = Router();

// --------------------------------------------------------------------------- abuse protection
const hits = new Map<string, { count: number; resetAt: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  return ++e.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}, 10 * 60_000).unref();

function guard(req: Request, action: string, max: number, windowMs: number): void {
  if (limited(`${action}|${req.ip}`, max, windowMs)) throw new HttpError(429, 'Too many attempts. Try again a little later.');
}

// --------------------------------------------------------------------------------- one-time links
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

async function issueToken(db: pg.PoolClient | null, userId: number, kind: 'verify' | 'reset', ttlMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const run = async (q: (sql: string, params: unknown[]) => Promise<unknown>) => {
    // Only the newest link of a kind works.
    await q('UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL', [userId, kind]);
    await q('INSERT INTO email_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [userId, kind, sha256(token), new Date(Date.now() + ttlMs)]);
  };
  if (db) await run((sql, params) => db.query(sql, params as unknown[]));
  else await run((sql, params) => exec(sql, params));
  return token;
}

/** Uses a link once; returns its user or null when unknown, used or expired. */
async function useToken(token: string, kind: 'verify' | 'reset'): Promise<number | null> {
  const row = await one<{ user_id: number }>(
    `UPDATE email_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(token), kind],
  );
  return row?.user_id ?? null;
}

const VERIFY_TTL = 48 * 3600_000;
const RESET_TTL = 3600_000;

// ------------------------------------------------------------------------------------- sign up
const signupSchema = z.object({
  company: z.string().trim().min(2, 'enter your company name').max(80),
  name: z.string().trim().min(1, 'enter your name').max(60),
  email: z.email('enter a valid email').transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(30).default(''),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
  package: z.string().trim().max(40).optional(),
  /** Honeypot: people never see this field; bots fill it in. */
  website: z.string().max(200).optional(),
});

signupRouter.post('/signup', async (req, res) => {
  guard(req, 'signup', 5, 3600_000);
  if (await needsSetup()) throw new HttpError(403, 'Envo is not open for sign-ups yet.');
  const d = signupSchema.parse(req.body);
  if (d.website) {
    res.status(201).json({ ok: true });
    return;
  }
  if (await one('SELECT 1 FROM users WHERE email = $1', [d.email])) {
    throw conflict('An account with this email already exists. Sign in, or reset your password.');
  }
  const pkg = d.package ? await one<{ id: number }>('SELECT id FROM packages WHERE slug = $1 AND active AND public', [d.package]) : null;
  const passwordHash = await hashPassword(d.password);
  const { userId, token } = await tx(async (db) => {
    const account = (
      await db.query<{ id: number }>(
        `INSERT INTO accounts (name, email, phone, status, signup_package_id) VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
        [d.company, d.email, d.phone, pkg?.id ?? null],
      )
    ).rows[0]!;
    const user = (
      await db.query<{ id: number }>(
        `INSERT INTO users (email, name, password_hash, role, account_id, is_owner) VALUES ($1, $2, $3, 'admin', $4, true) RETURNING id`,
        [d.email, d.name, passwordHash, account.id],
      )
    ).rows[0]!;
    return { userId: user.id, token: await issueToken(db, user.id, 'verify', VERIFY_TTL) };
  });
  await sendMail(emails.verify(d.email, d.name, token));
  console.log(`[signup] ${d.company} <${d.email}> (user ${userId})`);
  res.status(201).json({ ok: true });
});

/** The link in the welcome email: confirms the address and signs the customer in. */
signupRouter.post('/verify', async (req, res) => {
  guard(req, 'verify', 30, 3600_000);
  const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.body);
  const userId = await useToken(token, 'verify');
  if (!userId) throw badRequest('This confirmation link has expired or was already used. Sign in to get a new one.');
  const user = await one<{ id: number; enabled: boolean; signup_package_id: number | null }>(
    `UPDATE users u SET email_verified_at = COALESCE(u.email_verified_at, now()), updated_at = now()
       FROM accounts a WHERE u.id = $1 AND a.id = u.account_id
     RETURNING u.id, u.enabled, a.signup_package_id`,
    [userId],
  );
  if (!user?.enabled) throw badRequest('This account is disabled');
  issueSession(res, user.id);
  res.json({ ok: true, package_id: user.signup_package_id });
});

/** Sends a fresh confirmation link. Answers the same whether or not the email is known. */
signupRouter.post('/resend-verification', async (req, res) => {
  guard(req, 'resend', 5, 3600_000);
  const { email } = z.object({ email: z.email().transform((v) => v.toLowerCase()) }).parse(req.body);
  const user = await one<{ id: number; name: string }>('SELECT id, name FROM users WHERE email = $1 AND email_verified_at IS NULL AND enabled', [email]);
  if (user) await sendMail(emails.verify(email, user.name, await issueToken(null, user.id, 'verify', VERIFY_TTL)));
  res.json({ ok: true });
});

// --------------------------------------------------------------------------------- passwords
signupRouter.post('/forgot-password', async (req, res) => {
  guard(req, 'forgot', 5, 3600_000);
  const { email } = z.object({ email: z.email().transform((v) => v.toLowerCase()) }).parse(req.body);
  const user = await one<{ id: number; name: string }>('SELECT id, name FROM users WHERE email = $1 AND enabled', [email]);
  if (user) await sendMail(emails.reset(email, user.name, await issueToken(null, user.id, 'reset', RESET_TTL)));
  // Same answer either way, so nobody can find out which emails have accounts.
  res.json({ ok: true });
});

signupRouter.post('/reset-password', async (req, res) => {
  guard(req, 'reset', 20, 3600_000);
  const { token, password } = z.object({ token: z.string().min(20).max(100), password: z.string().min(8, 'must be at least 8 characters').max(128) }).parse(req.body);
  const userId = await useToken(token, 'reset');
  if (!userId) throw badRequest('This reset link has expired or was already used. Ask for a new one.');
  // Following the link proves the inbox is theirs, so it also confirms the address.
  await exec('UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $2', [
    await hashPassword(password),
    userId,
  ]);
  await exec("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL", [userId]);
  issueSession(res, userId);
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------ first run
/** Whether the platform still needs its first admin (the website then shows nothing to sign up for). */
signupRouter.get('/setup-status', async (_req, res) => {
  res.json({ needsSetup: await needsSetup() });
});

const setupSchema = z.object({
  token: z.string().min(20).max(100),
  company: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1).max(60),
  email: z.email().transform((v) => v.toLowerCase()),
  password: z.string().min(12, 'use at least 12 characters for the platform admin').max(128),
});

/**
 * Creates the first platform admin, only with the one-time link from the server (see setup.ts).
 * Serialised with an advisory lock and re-checked inside the transaction, so two requests can never
 * both create one; afterwards this answers "already set up" forever.
 */
signupRouter.post('/setup', async (req, res) => {
  guard(req, 'setup', 10, 3600_000);
  const d = setupSchema.parse(req.body);
  if (!(await needsSetup())) throw new HttpError(404, 'Envo is already set up. Sign in instead.');
  if (!setupTokenValid(d.token)) throw new HttpError(403, 'This setup link is not valid. Use the newest link from the server.');
  const passwordHash = await hashPassword(d.password);
  const userId = await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(771001)');
    if ((await db.query("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1")).rowCount) {
      throw new HttpError(404, 'Envo is already set up. Sign in instead.');
    }
    if ((await db.query('SELECT 1 FROM users WHERE email = $1', [d.email])).rowCount) throw conflict('This email is already used by another login');
    // The company running Envo: its own SIP servers are never billed or limited.
    if (!(await db.query('SELECT 1 FROM accounts WHERE internal LIMIT 1')).rowCount) {
      await db.query(`INSERT INTO accounts (name, email, status, internal) VALUES ($1, $2, 'active', true)`, [d.company, d.email]);
    }
    const user = await db.query<{ id: number }>(
      `INSERT INTO users (email, name, password_hash, role, email_verified_at) VALUES ($1, $2, $3, 'superadmin', now()) RETURNING id`,
      [d.email, d.name, passwordHash],
    );
    return user.rows[0]!.id;
  });
  await closeSetup();
  console.log(`[setup] platform admin ${d.email} created; the setup link is closed`);
  issueSession(res, userId);
  res.status(201).json({ ok: true });
});
