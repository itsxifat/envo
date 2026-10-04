import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { one } from './db.js';
import { config } from './config.js';

/**
 * First run. Envo creates no users or demo data. While there is no platform admin, the server makes a
 * one-time setup link (a 256-bit secret, kept here only as a hash) and writes it to its log and to
 * `<data dir>/setup-url.txt` (owner-only). Only that link can create the first platform admin, so
 * nobody can claim the platform by signing up first. Once a platform admin exists the setup path is
 * closed for good; a restart while setup is still open makes a new link and voids the old one.
 */

let tokenHash: string | null = null;
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const urlFile = () => path.join(config.paths.dataDir, 'setup-url.txt');

export async function needsSetup(): Promise<boolean> {
  return !(await one("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1"));
}

export async function prepareSetup(): Promise<void> {
  if (!(await needsSetup())) {
    await closeSetup();
    return;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  tokenHash = sha256(token);
  const url = `${config.publicUrl}/setup?token=${token}`;
  await fs.writeFile(urlFile(), `${url}\n`, { mode: 0o600 }).catch(() => undefined);
  console.log(`[setup] No platform admin yet. Create it with this one-time link (it changes when the server restarts):\n[setup] ${url}`);
}

/** Constant-time check of a setup link's secret. */
export function setupTokenValid(token: string): boolean {
  if (!tokenHash || !token) return false;
  const a = Buffer.from(sha256(token), 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function closeSetup(): Promise<void> {
  tokenHash = null;
  await fs.rm(urlFile(), { force: true }).catch(() => undefined);
}
