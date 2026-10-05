import crypto from 'node:crypto';
import type pg from 'pg';
import { exec, one } from '../db.js';

/** One-time email links (confirm email, reset or set a password). Only their sha256 is stored. */

export type TokenKind = 'verify' | 'reset';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export async function issueToken(db: pg.PoolClient | null, userId: number, kind: TokenKind, ttlMs: number): Promise<string> {
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
export async function useToken(token: string, kind: TokenKind): Promise<number | null> {
  const row = await one<{ user_id: number }>(
    `UPDATE email_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(token), kind],
  );
  return row?.user_id ?? null;
}
