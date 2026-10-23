import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, exec } from '../db.js';
import {
  authenticate,
  clearLoginAttempts,
  clearSession,
  hashPassword,
  issueSession,
  loginRateLimited,
  verifyPassword,
} from '../auth.js';
import { HttpError, badRequest } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { getSettings } from '../settings.js';
import { getAccountPlan } from '../billing/plan.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
});

// Compared against when the email is unknown, so both cases take the same time.
const dummyHash = hashPassword(crypto.randomUUID());

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const key = `${req.ip}|${email}`;
  if (loginRateLimited(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = await one<{ id: number; password_hash: string; enabled: boolean; email_verified_at: Date | null }>(
    'SELECT id, password_hash, enabled, email_verified_at FROM users WHERE email = $1',
    [email],
  );
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
  if (!user || !ok || !user.enabled) throw new HttpError(401, 'Wrong email or password');
  if (!user.email_verified_at) {
    throw new HttpError(403, 'Confirm your email first: open the link we sent you.', { code: 'email_unverified' });
  }
  clearLoginAttempts(key);
  await exec('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  issueSession(res, user.id);
  res.json({ ok: true });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const settings = await getSettings();
  const plan = req.user!.accountId !== null ? await getAccountPlan(req.user!.accountId) : null;
  res.json({ user: req.user, plan, company: settings.company_name, sipDomain: settings.sip_domain });
});

/** Ends support access to a customer's portal and returns to the platform admin's own login. */
authRouter.post('/impersonation/stop', authenticate, async (req, res) => {
  const user = req.user!;
  if (!user.impersonator) throw badRequest("You are not viewing a customer's portal");
  await audit(req, 'impersonate_end', 'account', user.accountId ?? '', `left the portal of ${user.email}`, null);
  issueSession(res, user.impersonator.id);
  res.json({ ok: true, accountId: user.accountId });
});

authRouter.post('/password', authenticate, async (req, res) => {
  if (req.user!.impersonator) throw badRequest("The customer's password can't be changed from support access");
  const { current, next } = z
    .object({ current: z.string().min(1), next: z.string().min(8, 'must be at least 8 characters').max(128) })
    .parse(req.body);
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!row || !(await verifyPassword(current, row.password_hash))) throw badRequest('Your current password is wrong');
  // Signs out every other browser and phone; this one gets a fresh session. Node's clock for both.
  await exec('UPDATE users SET password_hash = $1, sessions_valid_after = $2, updated_at = now() WHERE id = $3', [await hashPassword(next), new Date(), req.user!.id]);
  issueSession(res, req.user!.id);
  res.json({ ok: true });
});
