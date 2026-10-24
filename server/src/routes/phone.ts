import { Router, type Request, type RequestHandler, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { z } from 'zod';
import { exec, many, one, tx } from '../db.js';
import { config } from '../config.js';
import { clearLoginAttempts, clearSession, hashPassword, issueAppToken, issueSession, loginRateLimited, verifyPassword } from '../auth.js';
import { HttpError, badRequest, conflict, forbidden, intParam, notFound } from '../lib/http.js';
import { audit, bdMobile } from '../lib/validate.js';
import { sendMail } from '../lib/mailer.js';
import { emails } from '../lib/emails.js';
import { createInvoice, startOnlinePayment } from '../billing/invoices.js';
import { publicPaymentOptions } from '../billing/settings.js';
import { getSupplySettings } from '../supply/settings.js';
import { deleteCheckFrames, deleteDocuments, idDocumentOf, readCheckFrames, saveCheckFrames, saveDocument } from '../supply/files.js';
import { needsSetup } from '../setup.js';
import { phoneState, provisionPersonal, reserveRandomNumber, stageOf } from '../phone/account.js';
import { adjustBalance, balanceOf, envoNumberSql, envoPrefixes } from '../phone/balance.js';
import { checkIdentity } from '../phone/check.js';
import { PROBLEM_TEXT, checkLiveness, type Liveness } from '../phone/identity.js';
import { getPhoneSettings, updatePhoneSettings } from '../phone/settings.js';
import { scheduleApply } from '../asterisk/apply.js';
import { groupedCallsSql } from '../services/calls.js';
import { closeRequest, detailsSchema, uploadDocuments } from './numberRequests.js';
import { guard } from './signup.js';
import { webphoneCredentials } from './misc.js';

/*
 * Envo Phone: the API of the phone app and of the website's personal side. A person signs up,
 * confirms their email with a code, sends the BTRC registration and gets a random number from
 * Enfinito's pool, activates it with a first recharge, and calls from their balance. Support does
 * the operator's part in /admin (Number requests), as for business customers.
 */

const bdt = (n: number) => `BDT ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------------------- email codes
const CODE_TTL_MS = 30 * 60_000;
const codeHash = (userId: number, code: string) => crypto.createHmac('sha256', config.jwtSecret).update(`email-code:${userId}:${code}`).digest('hex');

/** A fresh six-digit code by email (only the newest works). In development it shows in the server log. */
async function sendCode(userId: number, email: string, name: string): Promise<void> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  await exec(
    `INSERT INTO email_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [userId, codeHash(userId, code), new Date(Date.now() + CODE_TTL_MS)],
  );
  await sendMail(emails.phoneCode(email, name, code));
}

/** Signed in: the app gets a token to send as a Bearer header, the website a session cookie. */
async function signedIn(res: Response, userId: number, accountId: number, client: 'app' | 'web'): Promise<Record<string, unknown>> {
  const me = await phoneState(accountId);
  if (client === 'app') return { token: issueAppToken(userId), me };
  issueSession(res, userId);
  return { me };
}

// ------------------------------------------------------------------------------------ public
export const phonePublicRouter = Router();

/*
 * The Android app is downloaded from the website: deploy.sh uploads the APK and its details
 * (envo-phone.json: version) to downloads/ next to the app, outside the releases, so they stay.
 */
const DOWNLOADS = process.env.ENVO_DOWNLOADS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'downloads');
const APK_FILE = path.join(DOWNLOADS, 'envo-phone.apk');
const APK_PATH = '/api/public/phone/app/envo-phone.apk';

/** The APK on offer, or null when none was uploaded. */
async function androidApp(): Promise<{ version: string; size: number; updated_at: string; url: string } | null> {
  try {
    const [info, st] = await Promise.all([fs.readFile(path.join(DOWNLOADS, 'envo-phone.json'), 'utf8'), fs.stat(APK_FILE)]);
    const version = String((JSON.parse(info) as { version?: unknown }).version ?? '');
    // The upload time in the link, so Cloudflare and browsers never hand out an older APK.
    return { version, size: st.size, updated_at: st.mtime.toISOString(), url: `${APK_PATH}?v=${Math.floor(st.mtimeMs / 1000)}` };
  } catch {
    return null;
  }
}

phonePublicRouter.get('/app/envo-phone.apk', async (_req, res) => {
  const app = await androidApp();
  if (!app) throw notFound('The Android app');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="Envo-Phone-${app.version.replace(/[^\w.-]/g, '') || 'android'}.apk"`);
  res.sendFile(APK_FILE);
});

/** What the app needs before anyone signs in: sign-ups open, prices, payment ways, support, the oldest app that works. */
phonePublicRouter.get('/config', async (_req, res) => {
  const [s, supply, pay, setup, android] = await Promise.all([getPhoneSettings(), getSupplySettings(), publicPaymentOptions(), needsSetup(), androidApp()]);
  const provider = supply.providers.find((p) => p.id === s.provider);
  res.json({
    signups: s.signups && !setup,
    activation_min: s.activation_min,
    recharge: s.recharge,
    rate_per_min: s.rate_per_min,
    free_onnet: s.free_onnet,
    selfie_check: s.selfie_check,
    support: s.support,
    min_app_version: s.min_app_version,
    // Where an old app gets the new one: the admin's link, or the APK on the website.
    update_url: s.update_url || (android ? `${config.publicUrl}${android.url}` : ''),
    android,
    operator: provider?.name ?? '',
    prefix: provider?.prefix ?? '',
    // Enfinito Pay is the only way to pay (bKash, Nagad, cards and the rest are on its page).
    payment: { online: pay.online },
  });
});

const client = z.enum(['app', 'web']).default('web');

const signupSchema = z.object({
  name: z.string().trim().min(2, 'enter your full name').max(60),
  mobile: z
    .string()
    .transform((v) => bdMobile(v) ?? '')
    .refine((v) => v !== '', 'enter your mobile number, like 01712345678'),
  email: z.email('enter a valid email').transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
  client,
  /** Honeypot: people never see this field; bots fill it in. */
  website: z.string().max(200).optional(),
});

phonePublicRouter.post('/signup', async (req, res) => {
  // Mobile networks put many people behind one address, so this allows more than the business sign-up.
  guard(req, 'phone-signup', 20, 3600_000);
  if (!(await getPhoneSettings()).signups || (await needsSetup())) throw new HttpError(403, 'Sign-ups for Envo Phone are closed right now.');
  const d = signupSchema.parse(req.body);
  if (d.website) {
    res.status(201).json({ ok: true });
    return;
  }
  if (await one('SELECT 1 FROM users WHERE email = $1', [d.email])) throw conflict('An account with this email already exists. Sign in, or reset your password.');
  const passwordHash = await hashPassword(d.password);
  const { userId, accountId } = await tx(async (db) => {
    const account = (
      await db.query<{ id: number }>(`INSERT INTO accounts (name, email, phone, status, kind) VALUES ($1, $2, $3, 'pending', 'personal') RETURNING id`, [d.name, d.email, d.mobile])
    ).rows[0]!;
    const user = (
      await db.query<{ id: number }>(`INSERT INTO users (email, name, password_hash, role, account_id, is_owner) VALUES ($1, $2, $3, 'admin', $4, true) RETURNING id`, [
        d.email,
        d.name,
        passwordHash,
        account.id,
      ])
    ).rows[0]!;
    return { userId: user.id, accountId: account.id };
  });
  await sendCode(userId, d.email, d.name);
  console.log(`[phone] sign-up ${d.email} (account ${accountId})`);
  res.status(201).json(await signedIn(res, userId, accountId, d.client));
});

// Compared against when the email is unknown, so both cases take the same time.
const dummyHash = hashPassword(crypto.randomUUID());

/** Signing in to Envo Phone. Business logins are sent to the website. */
phonePublicRouter.post('/login', async (req, res) => {
  const d = z.object({ email: z.string().trim().toLowerCase().min(3).max(200), password: z.string().min(1).max(200), client }).parse(req.body);
  const key = `${req.ip}|${d.email}`;
  if (loginRateLimited(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = await one<{ id: number; password_hash: string; enabled: boolean; account_id: number | null; kind: string | null; status: string | null }>(
    'SELECT u.id, u.password_hash, u.enabled, u.account_id, a.kind, a.status FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = $1',
    [d.email],
  );
  const ok = await verifyPassword(d.password, user?.password_hash ?? (await dummyHash));
  if (!user || !ok || !user.enabled || user.status === 'closed') throw new HttpError(401, 'Wrong email or password');
  if (user.kind !== 'personal' || !user.account_id) {
    throw new HttpError(403, 'This is a business login. Sign in on the Envo website to use your phone system.', { code: 'business_account' });
  }
  clearLoginAttempts(key);
  await exec('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  res.json(await signedIn(res, user.id, user.account_id, d.client));
});

// --------------------------------------------------------------------------------- signed in
/** The signed-in person's own phone service. Mounted before the active-account check: pending accounts need it. */
export const phoneRouter = Router();
phoneRouter.use((req, _res, next) => next(req.user!.accountKind === 'personal' ? undefined : forbidden('This is for Envo Phone accounts')));

const accountOf = (req: Request) => req.user!.accountId!;

phoneRouter.get('/me', async (req, res) => {
  res.json(await phoneState(accountOf(req)));
});

phoneRouter.post('/email/verify', async (req, res) => {
  const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'enter the 6-digit code') }).parse(req.body);
  const userId = req.user!.id;
  // Each try is counted before the code is compared, in one statement, so tries sent at once can't share a count.
  const row = await one<{ code_hash: string }>('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = $1 AND attempts < 5 AND expires_at > now() RETURNING code_hash', [userId]);
  if (!row) throw badRequest('This code has expired or had too many wrong tries. Ask for a new one.');
  const given = Buffer.from(codeHash(userId, code));
  if (!crypto.timingSafeEqual(given, Buffer.from(row.code_hash))) throw badRequest("That code isn't right. Check the email and try again.");
  await exec('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1', [userId]);
  await exec('DELETE FROM email_codes WHERE user_id = $1', [userId]);
  res.json(await phoneState(accountOf(req)));
});

phoneRouter.post('/email/resend', async (req, res) => {
  guard(req, `phone-code-${req.user!.id}`, 4, 15 * 60_000);
  const u = await one<{ email: string; name: string; verified: boolean }>('SELECT email, name, email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1', [req.user!.id]);
  if (!u || u.verified) throw badRequest('Your email is already confirmed');
  await sendCode(req.user!.id, u.email, u.name);
  res.json({ ok: true });
});

/** A typo in the email: change it while it is not confirmed yet, and send the code there. */
phoneRouter.put('/email', async (req, res) => {
  guard(req, `phone-email-${req.user!.id}`, 5, 3600_000);
  const { email } = z.object({ email: z.email('enter a valid email').transform((v) => v.toLowerCase()) }).parse(req.body);
  const u = await one<{ name: string; verified: boolean }>('SELECT name, email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1', [req.user!.id]);
  if (!u || u.verified) throw badRequest('Your email is already confirmed');
  if (await one('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [email, req.user!.id])) throw conflict('Another account already uses this email');
  await exec('UPDATE users SET email = $1, updated_at = now() WHERE id = $2', [email, req.user!.id]);
  await exec('UPDATE accounts SET email = $1, updated_at = now() WHERE id = $2', [email, accountOf(req)]);
  await sendCode(req.user!.id, email, u.name);
  res.json(await phoneState(accountOf(req)));
});

const frames = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 2 } }).fields([
  { name: 'straight', maxCount: 1 },
  { name: 'turn_1', maxCount: 1 },
  { name: 'turn_2', maxCount: 1 },
]);
const uploadFrames: RequestHandler = (req, res, next) =>
  frames(req, res, (err: unknown) => next((err as { code?: string } | undefined)?.code === 'LIMIT_FILE_SIZE' ? badRequest('Each picture can be at most 5 MB') : err));

/**
 * The live selfie: three pictures, looking straight and then turning the head one way and the other.
 * Checked right away (one face, the same person, a real head turn), so a retake can be asked for on
 * the spot; a passed check is kept for the registration, which matches it with the NID photo.
 */
phoneRouter.post('/selfie', uploadFrames, async (req, res) => {
  guard(req, `phone-selfie-${req.user!.id}`, 15, 15 * 60_000);
  const accountId = accountOf(req);
  if ((await phoneState(accountId)).stage !== 'kyc') throw badRequest('Your registration is already with us');
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const list = ['straight', 'turn_1', 'turn_2'].map((k) => files?.[k]?.[0]?.buffer);
  if (list.some((b) => !b)) throw badRequest('Send all three pictures');
  const { result, descriptor } = await checkLiveness(list as [Buffer, Buffer, Buffer]).catch((err: Error) => {
    console.warn('[phone] selfie check failed:', err.message);
    throw new HttpError(503, 'The selfie check is not available right now. Please try again in a few minutes.');
  });
  if (!result.ok || !descriptor) throw new HttpError(422, PROBLEM_TEXT[result.problem ?? 'no_face'], { code: result.problem, result });
  // Only the newest selfie waits for the registration.
  for (const old of await many<{ id: string }>('DELETE FROM selfie_checks WHERE account_id = $1 RETURNING id', [accountId])) await deleteCheckFrames(old.id);
  const checkId = crypto.randomUUID();
  await saveCheckFrames(checkId, list as Buffer[]);
  await exec('INSERT INTO selfie_checks (id, account_id, result, descriptor) VALUES ($1, $2, $3, $4)', [checkId, accountId, JSON.stringify(result), JSON.stringify(descriptor)]);
  res.status(201).json({ id: checkId });
});

/**
 * The registration (KYC): the details as JSON, the live selfie (a passed check) or a photo, the NID's
 * two sides (or one file with both), and the consent. Name, mobile and email come from the account.
 * Makes the person's SIP server, reserves a random number from the pool (when none is left, support
 * picks one when connecting) and matches the selfie with the NID photo for support.
 */
phoneRouter.post('/kyc', uploadDocuments, async (req, res) => {
  const accountId = accountOf(req);
  const state = await phoneState(accountId);
  if (state.stage === 'verify') throw badRequest('Confirm your email first');
  if (state.stage !== 'kyc') throw badRequest('Your registration is already with us');
  const body = z
    .object({
      details: z.string().max(20_000),
      consent: z.string().refine((v) => v === 'true', 'agree to share these details with the operator'),
      selfie_check: z.uuid().optional(),
    })
    .parse(req.body);
  let raw: unknown;
  try {
    raw = JSON.parse(body.details);
  } catch {
    throw badRequest('The details could not be read');
  }
  const details = detailsSchema.parse({ ...(raw as object), subscriber_type: 'individual', authorized_person: '', name: state.name, phone: state.mobile, email: state.email });
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const settings = await getPhoneSettings();
  // The selfie: a live one checked moments ago, or (with the check off) any photo.
  let photo: Buffer;
  let turns: Buffer[] = [];
  let liveness: Liveness | null = null;
  let selfie: Buffer | number[];
  if (body.selfie_check) {
    const check = await one<{ result: Liveness; descriptor: number[] }>(
      "SELECT result, descriptor FROM selfie_checks WHERE id = $1 AND account_id = $2 AND created_at > now() - interval '1 hour'",
      [body.selfie_check, accountId],
    );
    if (!check) throw badRequest('Your selfie is too old. Please take it again.');
    [photo, ...turns] = (await readCheckFrames(body.selfie_check)) as [Buffer, ...Buffer[]];
    liveness = check.result;
    selfie = check.descriptor;
  } else {
    if (settings.selfie_check) throw badRequest('Take your selfie with the camera: look at it, then turn your head when asked');
    const p = files?.photo?.[0];
    if (!p) throw badRequest('Add a photo of yourself');
    photo = p.buffer;
    selfie = p.buffer;
  }
  // The two sides become one page, the way the operator wants it.
  const idDoc = await idDocumentOf(files);
  if (!idDoc) throw badRequest('Add photos of the front and back of your NID');
  const check = await checkIdentity(liveness, selfie, files?.id_front?.[0]?.buffer ?? idDoc);
  const fallbackProvider = settings.provider;

  let requestId = 0;
  try {
    const created = await tx(async (db) => {
      // One registration at a time: a second one sent at the same moment waits here, then finds the first.
      await db.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if ((await db.query("SELECT 1 FROM number_requests WHERE account_id = $1 AND status IN ('submitted', 'in_review', 'connected')", [accountId])).rowCount) {
        throw badRequest('Your registration is already with us');
      }
      // The selfie is used once; its face data goes with it (the result stays on the request for support).
      if (body.selfie_check && !(await db.query('DELETE FROM selfie_checks WHERE id = $1 AND account_id = $2', [body.selfie_check, accountId])).rowCount) {
        throw badRequest('Your selfie is too old. Please take it again.');
      }
      const tenantId = await provisionPersonal(db, accountId);
      const picked = await reserveRandomNumber(db);
      const row = (
        await db.query<{ id: number }>(
          `INSERT INTO number_requests (account_id, tenant_id, provider, pool_id, requested_number, details, consent_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
          [accountId, tenantId, picked?.provider ?? fallbackProvider, picked?.id ?? null, picked?.number ?? '', JSON.stringify(details), req.user!.id],
        )
      ).rows[0]!;
      requestId = row.id;
      const photoFile = await saveDocument(row.id, 'photo', photo, false);
      const idFile = await saveDocument(row.id, 'id', idDoc, true);
      for (const [i, turn] of turns.entries()) await saveDocument(row.id, i === 0 ? 'turn-1' : 'turn-2', turn, false);
      await db.query('UPDATE number_requests SET photo_file = $1, id_file = $2, identity = $3 WHERE id = $4', [photoFile, idFile, JSON.stringify(check), row.id]);
      return { id: row.id, number: picked?.number ?? null, tenantId };
    });
    if (body.selfie_check) await deleteCheckFrames(body.selfie_check).catch(() => undefined);
    await audit(req, 'create', 'number_request', created.id, `Envo Phone: ${created.number ?? 'number to be chosen'}`, created.tenantId);
    res.status(201).json(await phoneState(accountId));
  } catch (err) {
    if (requestId) await deleteDocuments(requestId).catch(() => undefined);
    throw err;
  }
});

/** Starts a recharge: the first one (at least the activation amount) activates the number. Pay it next. */
phoneRouter.post('/recharges', async (req, res) => {
  const accountId = accountOf(req);
  const s = await getPhoneSettings();
  const { amount: raw } = z.object({ amount: z.number().positive().max(10_000_000) }).parse(req.body);
  const state = await phoneState(accountId);
  if (state.stage === 'suspended') throw badRequest('Your account is paused. Please contact support.');
  if (state.stage === 'verify' || state.stage === 'kyc') throw badRequest('Send your registration first');
  const first = state.stage === 'activate';
  const amount = round2(raw);
  const min = first ? s.activation_min : s.recharge.min;
  if (amount < min) throw badRequest(first ? `The first recharge is at least ${bdt(min)}` : `Recharge at least ${bdt(min)}`);
  if (amount > s.recharge.max) throw badRequest(`Recharge at most ${bdt(s.recharge.max)} at a time`);
  if (state.payment_in_review) throw badRequest("We're still checking your last payment. You can recharge again once it's confirmed.");
  // Pressing Pay again (or after closing the payment page) carries on with the same recharge.
  const open = await one<{ id: number; invoice_id: number; invoice_number: string; amount: string }>(
    `SELECT t.id, t.invoice_id, i.number AS invoice_number, t.amount FROM topups t JOIN invoices i ON i.id = t.invoice_id
      WHERE t.account_id = $1 AND t.status = 'awaiting_payment' AND i.status = 'unpaid' AND t.amount = $2 ORDER BY t.id DESC LIMIT 1`,
    [accountId, amount],
  );
  if (open) return void res.json({ id: open.id, invoice_id: open.invoice_id, invoice_number: open.invoice_number, amount: Number(open.amount) });
  const connected = await one<{ id: number; number: string }>('SELECT n.id, n.number FROM numbers n JOIN number_requests r ON r.number_id = n.id WHERE r.id = $1', [state.request!.id]);
  const number = connected?.number ?? state.number ?? '';
  const created = await tx(async (db) => {
    const inv = await createInvoice(db, {
      accountId,
      kind: 'topup',
      amount,
      description: first ? `Activation and first recharge${number ? ` for ${number}` : ''}` : `Recharge for ${number}`,
      createdBy: req.user!.id,
    });
    const t = (
      await db.query<{ id: number }>('INSERT INTO topups (account_id, number_id, number, amount, invoice_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
        accountId,
        connected?.id ?? null,
        number,
        inv.amount,
        inv.id,
      ])
    ).rows[0]!;
    return { id: t.id, invoice_id: inv.id, invoice_number: inv.number, amount: Number(inv.amount) };
  });
  await audit(req, 'create', 'topup', created.invoice_id, `${number || 'Envo Phone'} ${bdt(amount)}`, null);
  res.status(201).json(created);
});

/** The person's recharges, newest first, with what is happening to each. */
phoneRouter.get('/recharges', async (req, res) => {
  res.json(
    await many(
      `SELECT t.id, t.amount, t.status, t.created_at, i.id AS invoice_id, i.number AS invoice_number, i.status AS invoice_status,
              EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'pending_review') AS in_review
         FROM topups t JOIN invoices i ON i.id = t.invoice_id WHERE t.account_id = $1 ORDER BY t.id DESC LIMIT 50`,
      [accountOf(req)],
    ),
  );
});

async function ownRecharge(req: Request): Promise<{ id: number; invoice_id: number; status: string }> {
  const t = await one<{ id: number; invoice_id: number; status: string }>('SELECT id, invoice_id, status FROM topups WHERE id = $1 AND account_id = $2', [
    intParam(req.params.id),
    accountOf(req),
  ]);
  if (!t) throw notFound('Recharge');
  if (t.status !== 'awaiting_payment') throw badRequest('This recharge is already paid or cancelled');
  return t;
}

/** Pays on Enfinito Pay's page (bKash, Nagad, cards and more). From the app, the page leads back into the app. */
phoneRouter.post('/recharges/:id/pay-online', async (req, res) => {
  const { from } = z.object({ from: z.enum(['app', 'web']).default('web') }).parse(req.body ?? {});
  const t = await ownRecharge(req);
  res.json(await startOnlinePayment(t.invoice_id, accountOf(req), { from }));
});

/** Drops an unpaid recharge (and its invoice). */
phoneRouter.post('/recharges/:id/cancel', async (req, res) => {
  const t = await ownRecharge(req);
  const done = await tx(async (db) => {
    const inv = (await db.query<{ status: string }>('SELECT status FROM invoices WHERE id = $1 FOR UPDATE', [t.invoice_id])).rows[0];
    if (inv?.status !== 'unpaid') return false;
    if ((await db.query("SELECT 1 FROM payments WHERE invoice_id = $1 AND status = 'pending_review'", [t.invoice_id])).rowCount) return false;
    await db.query("UPDATE topups SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'", [t.id]);
    await db.query("UPDATE invoices SET status = 'void', updated_at = now() WHERE id = $1", [t.invoice_id]);
    return true;
  });
  if (!done) throw badRequest('This recharge is being paid, so it stays');
  res.json({ ok: true });
});

phoneRouter.get('/balance', async (req, res) => {
  const accountId = accountOf(req);
  const [balance, entries] = await Promise.all([
    balanceOf(accountId),
    many('SELECT id, kind, amount, note, created_at FROM balance_ledger WHERE account_id = $1 ORDER BY id DESC LIMIT 50', [accountId]),
  ]);
  res.json({ balance, entries });
});

/** Calls made and received, newest first: who, how long, and what each cost. */
phoneRouter.get('/calls', async (req, res) => {
  const accountId = accountOf(req);
  const tenant = await one<{ id: number }>('SELECT id FROM tenants WHERE account_id = $1 ORDER BY id LIMIT 1', [accountId]);
  if (!tenant) return void res.json([]);
  const s = await getPhoneSettings();
  // One row per call: a call that rang several devices has a CDR row for each.
  const rows = await many<{ linkedid: string; calldate: string; direction: string; src: string; dst: string; answered: boolean; billsec: number; cost: string | null; onnet: boolean }>(
    `SELECT g.linkedid, g.calldate, g.direction, g.src, g.dst, g.answered, g.billsec,
            (SELECT -sum(l.amount) FROM balance_ledger l JOIN cdr x ON x.id = l.cdr_id WHERE x.linkedid = g.linkedid) AS cost,
            ${envoNumberSql('g.dst', '$2')} AS onnet
       FROM (${groupedCallsSql("accountcode = $1 AND channel NOT LIKE 'Local/%'", "HAVING bool_or(direction IN ('inbound', 'outbound'))")}) g
      ORDER BY g.calldate DESC LIMIT 100`,
    [`t${tenant.id}`, await envoPrefixes()],
  );
  res.json(
    rows.map((c) => {
      const out = c.direction === 'outbound';
      const cost = out && c.cost !== null ? Number(c.cost) : null;
      return {
        id: c.linkedid,
        at: c.calldate,
        direction: out ? 'out' : c.answered ? 'in' : 'missed',
        number: (out ? c.dst : c.src).replace(/^\+?880/, '0'),
        duration: c.answered ? c.billsec : 0,
        // What the call cost; null while it isn't charged yet (and for calls in).
        cost,
        free: out && c.answered && (cost !== null ? cost === 0 : s.free_onnet && c.onnet),
      };
    }),
  );
});

/**
 * Is this number on Envo (calls to it are free while that is on)? Asked before a call with no balance
 * left, when only those calls go out.
 */
phoneRouter.get('/envo-number', async (req, res) => {
  guard(req, `phone-envo-number-${req.user!.id}`, 120, 60_000);
  const { number } = z.object({ number: z.string().trim().max(24) }).parse(req.query);
  const digits = number.replace(/[^\d+]/g, '');
  const r = digits ? await one<{ envo: boolean }>(`SELECT ${envoNumberSql('$1::text', '$2')} AS envo`, [digits, await envoPrefixes()]) : null;
  res.json({ envo: !!r?.envo });
});

/** What the app's phone registers with (SIP over WebSocket), once the number works. */
phoneRouter.get('/sip', async (req, res) => {
  res.json(await webphoneCredentials(req.user!));
});

phoneRouter.post('/password', async (req, res) => {
  if (req.user!.impersonator) throw badRequest("The customer's password can't be changed from support access");
  const d = z.object({ current: z.string().min(1), next: z.string().min(8, 'must be at least 8 characters').max(128), client }).parse(req.body);
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!row || !(await verifyPassword(d.current, row.password_hash))) throw badRequest('Your current password is wrong');
  // Signs out every other phone and browser; this one gets a fresh sign-in.
  await exec('UPDATE users SET password_hash = $1, sessions_valid_after = $2, updated_at = now() WHERE id = $3', [await hashPassword(d.next), new Date(), req.user!.id]);
  if (d.client === 'app') return void res.json({ token: issueAppToken(req.user!.id) });
  issueSession(res, req.user!.id);
  res.json({ ok: true });
});

/**
 * Closing the account. Before anything was sent or paid it is deleted right away; otherwise support
 * closes it (the number is released at the operator, any balance is settled).
 */
phoneRouter.post('/close', async (req, res) => {
  if (req.user!.impersonator) throw badRequest("Close the customer's account from the admin instead");
  const accountId = accountOf(req);
  const state = await phoneState(accountId);
  const started = state.request !== null || (await one('SELECT 1 FROM invoices WHERE account_id = $1 LIMIT 1', [accountId])) !== null;
  if (!started) {
    // The live selfie's pictures are files: they go too.
    const checks = await many<{ id: string }>('SELECT id FROM selfie_checks WHERE account_id = $1', [accountId]);
    await exec("DELETE FROM accounts WHERE id = $1 AND kind = 'personal'", [accountId]);
    for (const c of checks) await deleteCheckFrames(c.id).catch(() => undefined);
    console.log(`[phone] account ${accountId} (${state.email}) deleted by its owner`);
    clearSession(res);
    return void res.json({ closed: true });
  }
  await exec('UPDATE accounts SET close_requested_at = COALESCE(close_requested_at, now()), updated_at = now() WHERE id = $1', [accountId]);
  // Nothing paid yet: the reserved number goes back to the pool now, with the ID documents.
  const open = state.request && (state.request.status === 'submitted' || state.request.status === 'in_review');
  if (open && !(await one("SELECT 1 FROM topups WHERE account_id = $1 AND status IN ('paid', 'applied')", [accountId]))) {
    await closeRequest(state.request!.id, 'AND account_id = $5', [accountId], { status: 'cancelled', reason: 'The account is being closed' });
  }
  await audit(req, 'close_request', 'account', accountId, state.email, null);
  res.json({ closed: false, requested: true });
});

// ------------------------------------------------------------------------------------- admin
/** Platform admins: the phone app's settings and the people using it. */
export const adminPhoneRouter = Router();

const settingsSchema = z
  .object({
    signups: z.boolean(),
    provider: z.string().trim().min(1).max(40),
    activation_min: z.number().min(0).max(100_000),
    recharge: z.object({ min: z.number().min(1).max(100_000), max: z.number().min(1).max(1_000_000), presets: z.array(z.number().positive().max(1_000_000)).max(6) }),
    rate_per_min: z.number().min(0).max(1000),
    free_onnet: z.boolean(),
    selfie_check: z.boolean().default(true),
    support: z.object({ phone: z.string().trim().max(30), email: z.union([z.literal(''), z.email('enter a valid email')]) }),
    min_app_version: z.string().trim().regex(/^\d+\.\d+\.\d+$/, 'a version like 1.0.0'),
    update_url: z.union([z.literal(''), z.url('enter a full link, like https://…')]),
  })
  .refine((s) => s.recharge.max >= s.recharge.min, { message: 'the largest recharge must be at least the smallest', path: ['recharge'] })
  .refine((s) => s.recharge.max >= s.activation_min, { message: 'the largest recharge must cover the first one', path: ['activation_min'] });

adminPhoneRouter.get('/settings', async (_req, res) => {
  res.json(await getPhoneSettings());
});

adminPhoneRouter.put('/settings', async (req, res) => {
  const d = settingsSchema.parse(req.body);
  if (!(await getSupplySettings()).providers.some((p) => p.id === d.provider)) throw badRequest('Choose one of the number providers');
  const saved = await updatePhoneSettings(d);
  // Whether Envo calls are free decides what a server with no balance left may still call.
  scheduleApply();
  await audit(req, 'update', 'phone_app', '', `${saved.signups ? 'sign-ups open' : 'sign-ups closed'}, first recharge ${bdt(saved.activation_min)}, ${bdt(saved.rate_per_min)}/min`, null);
  res.json(saved);
});

/** Everyone with a personal account, newest first, with their stage, number and balance. */
adminPhoneRouter.get('/people', async (_req, res) => {
  const rows = await many<{
    id: number;
    name: string;
    email: string;
    mobile: string;
    status: string;
    verified: boolean;
    request_status: string | null;
    paid: boolean;
    number: string | null;
    balance: string;
    created_at: string;
    close_requested_at: string | null;
  }>(
    `SELECT a.id, u.name, u.email, a.phone AS mobile, a.status, u.email_verified_at IS NOT NULL AS verified, a.created_at, a.close_requested_at,
            r.status AS request_status, COALESCE(n.number, NULLIF(r.requested_number, '')) AS number,
            EXISTS (SELECT 1 FROM topups t WHERE t.account_id = a.id AND t.status IN ('paid', 'applied')) AS paid,
            COALESCE((SELECT sum(l.amount) FROM balance_ledger l WHERE l.account_id = a.id), 0) AS balance
       FROM accounts a
       JOIN users u ON u.account_id = a.id AND u.is_owner
       LEFT JOIN LATERAL (SELECT * FROM number_requests x WHERE x.account_id = a.id ORDER BY x.id DESC LIMIT 1) r ON true
       LEFT JOIN numbers n ON n.id = r.number_id
      WHERE a.kind = 'personal'
      ORDER BY a.id DESC LIMIT 1000`,
  );
  res.json(rows.map(({ request_status, paid, verified, ...r }) => ({ ...r, verified, balance: Number(r.balance), stage: stageOf({ status: r.status, verified, request_status, paid }) })));
});

adminPhoneRouter.get('/people/:id', async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await one("SELECT 1 FROM accounts WHERE id = $1 AND kind = 'personal'", [id]))) throw notFound('Person');
  const [state, ledger, recharges, requests] = await Promise.all([
    phoneState(id),
    many('SELECT l.id, l.kind, l.amount, l.note, l.created_at, u.name AS created_by_name FROM balance_ledger l LEFT JOIN users u ON u.id = l.created_by WHERE l.account_id = $1 ORDER BY l.id DESC LIMIT 100', [id]),
    many('SELECT t.id, t.amount, t.status, t.created_at, i.number AS invoice_number, i.status AS invoice_status FROM topups t JOIN invoices i ON i.id = t.invoice_id WHERE t.account_id = $1 ORDER BY t.id DESC LIMIT 50', [id]),
    many('SELECT id, status, requested_number, reason, created_at FROM number_requests WHERE account_id = $1 ORDER BY id DESC LIMIT 20', [id]),
  ]);
  res.json({ ...state, ledger, recharges, requests });
});

/** Support corrects a balance: a refund, a goodwill credit, a charge the system missed. */
adminPhoneRouter.post('/people/:id/adjust', async (req, res) => {
  const id = intParam(req.params.id);
  const d = z
    .object({
      amount: z.number().refine((v) => v !== 0 && Math.abs(v) <= 100_000, 'enter an amount, minus to take from the balance'),
      note: z.string().trim().min(3, 'say why, for the record').max(200),
    })
    .parse(req.body);
  if (!(await one("SELECT 1 FROM accounts WHERE id = $1 AND kind = 'personal'", [id]))) throw notFound('Person');
  await adjustBalance(id, d.amount, d.note, req.user!.id);
  await audit(req, 'adjust', 'balance', id, `${d.amount > 0 ? '+' : ''}${bdt(d.amount)} ${d.note}`, null);
  res.json({ balance: await balanceOf(id) });
});
