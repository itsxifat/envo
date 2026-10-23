import type pg from 'pg';
import { randomPassword, randomPin } from '../lib/secrets.js';

/**
 * A customer's first package goes live: give them a SIP server named after the company, an extension
 * for each person they said would use phones (three when they did not say; within the package) and
 * link the owner's web phone to the first one, so they can make a test call straight away. Does
 * nothing when the account already has a SIP server.
 */
export async function provisionFirstServer(db: pg.PoolClient, accountId: number, packageId: number): Promise<number | null> {
  if ((await db.query('SELECT 1 FROM tenants WHERE account_id = $1 LIMIT 1', [accountId])).rowCount) return null;
  const account = (
    await db.query<{ name: string; people: number | null }>(
      `SELECT name, CASE WHEN onboarding->>'people' ~ '^[0-9]{1,4}$' THEN (onboarding->>'people')::int END AS people FROM accounts WHERE id = $1`,
      [accountId],
    )
  ).rows[0];
  const pkg = (await db.query<{ max_extensions: number | null }>('SELECT max_extensions FROM packages WHERE id = $1', [packageId])).rows[0];
  if (!account) return null;

  const base = account.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 14) || 'office';
  let slug = base.length >= 2 ? base : `${base}pbx`;
  for (let i = 2; (await db.query('SELECT 1 FROM tenants WHERE slug = $1', [slug])).rowCount; i++) slug = `${base.slice(0, 14)}${i}`;
  const tenant = (
    await db.query<{ id: number }>(
      `INSERT INTO tenants (name, slug, description, account_id) VALUES ($1, $2, 'Created with your first package', $3) RETURNING id`,
      [account.name.slice(0, 60), slug, accountId],
    )
  ).rows[0]!;

  const wanted = account.people ?? 3;
  const count = Math.max(1, Math.min(wanted, pkg?.max_extensions ?? wanted, 50));
  const owner = (await db.query<{ id: number; name: string }>('SELECT id, name FROM users WHERE account_id = $1 AND is_owner ORDER BY id LIMIT 1', [accountId])).rows[0];
  let first: number | null = null;
  for (let i = 0; i < count; i++) {
    const number = String(101 + i);
    const name = i === 0 && owner ? owner.name.slice(0, 60) : `Extension ${number}`;
    const ext = (
      await db.query<{ id: number }>(
        `INSERT INTO extensions (tenant_id, number, name, sip_username, sip_password, voicemail_pin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenant.id, number, name, `${number}_${slug}`, randomPassword(), randomPin()],
      )
    ).rows[0]!;
    first ??= ext.id;
  }
  if (owner) await db.query('UPDATE users SET tenant_id = $1, extension_id = COALESCE(extension_id, $2), updated_at = now() WHERE id = $3', [tenant.id, first, owner.id]);
  return tenant.id;
}
