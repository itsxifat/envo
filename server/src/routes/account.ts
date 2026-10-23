import { Router } from 'express';
import { z } from 'zod';
import { exec, many, one } from '../db.js';
import { requireOwner } from '../auth.js';
import { badRequest } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { getAccountPlan, getUsage, invalidatePlans } from '../billing/plan.js';

/** The signed-in customer's own account: plan, limits and usage. Works while the account is suspended. */
export const accountRouter = Router();

accountRouter.get('/', async (req, res) => {
  const user = req.user!;
  if (user.accountId === null) throw badRequest('Platform administrators have no customer account');
  const [account, plan, usage] = await Promise.all([
    one('SELECT id, name, email, phone, address, status, internal, created_at FROM accounts WHERE id = $1', [user.accountId]),
    getAccountPlan(user.accountId),
    getUsage(user.accountId, { recordings: true }),
  ]);
  res.json({ account, plan, usage });
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(300).default(''),
});

accountRouter.put('/', requireOwner, async (req, res) => {
  const user = req.user!;
  if (user.accountId === null) throw badRequest('Platform administrators have no customer account');
  const data = profileSchema.parse(req.body);
  await exec('UPDATE accounts SET name = $1, email = $2, phone = $3, address = $4, updated_at = now() WHERE id = $5', [
    data.name,
    data.email,
    data.phone,
    data.address,
    user.accountId,
  ]);
  invalidatePlans(user.accountId);
  await audit(req, 'update', 'account', user.accountId, data.name, null);
  res.json({ ok: true });
});

/** Packages a customer can move to (the public, active ones). */
accountRouter.get('/packages', async (_req, res) => {
  res.json(await many('SELECT * FROM packages WHERE active AND public ORDER BY sort_order, id'));
});

const onboardingSchema = z.object({
  /** People who make and take calls: the first SIP server gets an extension for each (within the package). */
  people: z.number().int().min(1).max(1000),
  /** Calls at the same time: picks the package. */
  calls: z.number().int().min(1).max(500),
});

/** The answers from "Find the right package", kept so the setup can continue from them. */
accountRouter.get('/onboarding', async (req, res) => {
  const user = req.user!;
  if (user.accountId === null) throw badRequest('Platform administrators have no customer account');
  const row = await one<{ onboarding: Record<string, unknown> }>('SELECT onboarding FROM accounts WHERE id = $1', [user.accountId]);
  res.json(row?.onboarding ?? {});
});

accountRouter.put('/onboarding', requireOwner, async (req, res) => {
  const user = req.user!;
  if (user.accountId === null) throw badRequest('Platform administrators have no customer account');
  const data = onboardingSchema.parse(req.body);
  await exec('UPDATE accounts SET onboarding = onboarding || $1::jsonb, updated_at = now() WHERE id = $2', [JSON.stringify(data), user.accountId]);
  res.json(data);
});
