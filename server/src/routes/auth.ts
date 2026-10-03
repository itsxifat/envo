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
import { getSettings } from '../settings.js';

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
  const user = await one<{ id: number; password_hash: string; enabled: boolean }>(
    'SELECT id, password_hash, enabled FROM users WHERE email = $1',
    [email],
  );
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
  if (!user || !ok || !user.enabled) throw new HttpError(401, 'Wrong email or password');
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
  res.json({ user: req.user, company: settings.company_name, sipDomain: settings.sip_domain });
});

authRouter.post('/password', authenticate, async (req, res) => {
  const { current, next } = z
    .object({ current: z.string().min(1), next: z.string().min(8, 'must be at least 8 characters').max(128) })
    .parse(req.body);
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!row || !(await verifyPassword(current, row.password_hash))) throw badRequest('Your current password is wrong');
  await exec('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(next), req.user!.id]);
  res.json({ ok: true });
});
