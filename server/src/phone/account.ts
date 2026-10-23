import type pg from 'pg';
import { one } from '../db.js';
import { emails } from '../lib/emails.js';
import { sendMail } from '../lib/mailer.js';
import { randomPassword, randomPin } from '../lib/secrets.js';
import { getSupplySettings } from '../supply/settings.js';
import { balanceOf } from './balance.js';
import { getPhoneSettings } from './settings.js';

/*
 * A personal account (Envo Phone) is one person: one SIP server ("ph<account id>", so their name is
 * not in any SIP address) with one extension, and one number from Enfinito's pool. It moves through
 * these stages; the app and the website show the screen for each.
 */

export type PhoneStage =
  /** Signed up; the email address is not confirmed yet. */
  | 'verify'
  /** The registration (KYC) is next, or has to be sent again after support turned it down. */
  | 'kyc'
  /** Registration sent and a number reserved: the first recharge activates it. */
  | 'activate'
  /** Paid: support is registering the number with the operator. */
  | 'registering'
  /** The number works. */
  | 'active'
  /** Enfinito stopped the account. */
  | 'suspended';

export interface PhoneState {
  stage: PhoneStage;
  name: string;
  email: string;
  mobile: string;
  /** The number: reserved from the pool, or connected once it works. Null while none is chosen. */
  number: string | null;
  /** The latest registration, with support's reason when it was turned down. */
  request: { id: number; status: string; reason: string; created_at: string } | null;
  balance: number;
  activation_min: number;
  close_requested: boolean;
}

/**
 * The person's SIP server and extension, made when they send their registration (the number request
 * needs a server). It stays switched off until the first recharge makes the account active.
 */
export async function provisionPersonal(db: pg.PoolClient, accountId: number): Promise<number> {
  const existing = (await db.query<{ id: number }>('SELECT id FROM tenants WHERE account_id = $1 ORDER BY id LIMIT 1', [accountId])).rows[0];
  if (existing) return existing.id;
  const owner = (await db.query<{ id: number; name: string }>('SELECT id, name FROM users WHERE account_id = $1 AND is_owner ORDER BY id LIMIT 1', [accountId])).rows[0];
  const slug = `ph${accountId}`;
  const tenant = (
    await db.query<{ id: number }>(
      // Calls to the number ring the person's phone (numbers connected later ring there too).
      `INSERT INTO tenants (name, slug, description, account_id, default_dest_type, default_dest_target)
       VALUES ($1, $2, 'Envo Phone', $3, 'extension', '101') RETURNING id`,
      [(owner?.name ?? 'Envo Phone').slice(0, 60), slug, accountId],
    )
  ).rows[0]!;
  const ext = (
    await db.query<{ id: number }>(
      `INSERT INTO extensions (tenant_id, number, name, sip_username, sip_password, voicemail_pin) VALUES ($1, '101', $2, $3, $4, $5) RETURNING id`,
      [tenant.id, (owner?.name ?? 'Phone').slice(0, 60), `101_${slug}`, randomPassword(), randomPin()],
    )
  ).rows[0]!;
  if (owner) await db.query('UPDATE users SET tenant_id = $1, extension_id = $2, updated_at = now() WHERE id = $3', [tenant.id, ext.id, owner.id]);
  return tenant.id;
}

/** Reserves a random free number of the provider personal numbers come from; null when none is left. */
export async function reserveRandomNumber(db: pg.PoolClient): Promise<{ id: number; number: string; provider: string } | null> {
  const [phone, supply] = await Promise.all([getPhoneSettings(), getSupplySettings()]);
  const provider = supply.providers.find((p) => p.id === phone.provider) ?? supply.providers[0];
  if (!provider) return null;
  const row = (
    await db.query<{ id: number; number: string }>(
      `UPDATE number_pool SET status = 'reserved', updated_at = now()
        WHERE id = (SELECT id FROM number_pool WHERE status = 'available' AND number LIKE $1 || '%' ORDER BY random() LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, number`,
      [provider.prefix],
    )
  ).rows[0];
  return row ? { ...row, provider: provider.id } : null;
}

/** The stage from the account's status, its email, its latest registration and whether it paid. */
export function stageOf(a: { status: string; verified: boolean; request_status: string | null; paid: boolean }): PhoneStage {
  const open = a.request_status === 'submitted' || a.request_status === 'in_review';
  if (a.status === 'suspended' || a.status === 'closed') return 'suspended';
  if (!a.verified) return 'verify';
  if (a.request_status === 'connected' && a.status === 'active') return 'active';
  // Nothing sent yet, or support turned it down (or it was withdrawn): send it (again).
  if (!open && a.request_status !== 'connected') return 'kyc';
  return a.paid ? 'registering' : 'activate';
}

export async function phoneState(accountId: number): Promise<PhoneState> {
  const a = await one<{
    status: string;
    name: string;
    email: string;
    mobile: string;
    verified: boolean;
    close_requested: boolean;
    request_id: number | null;
    request_status: string | null;
    reason: string | null;
    requested_number: string | null;
    request_at: string | null;
    connected_number: string | null;
    paid: boolean;
  }>(
    `SELECT a.status, u.name, u.email, a.phone AS mobile, u.email_verified_at IS NOT NULL AS verified, a.close_requested_at IS NOT NULL AS close_requested,
            r.id AS request_id, r.status AS request_status, r.reason, r.requested_number, r.created_at AS request_at, n.number AS connected_number,
            EXISTS (SELECT 1 FROM topups t WHERE t.account_id = a.id AND t.status IN ('paid', 'applied')) AS paid
       FROM accounts a
       JOIN users u ON u.account_id = a.id AND u.is_owner
       LEFT JOIN LATERAL (SELECT * FROM number_requests x WHERE x.account_id = a.id ORDER BY x.id DESC LIMIT 1) r ON true
       LEFT JOIN numbers n ON n.id = r.number_id
      WHERE a.id = $1
      ORDER BY u.id LIMIT 1`,
    [accountId],
  );
  if (!a) throw new Error(`Account ${accountId} has no owner`);
  const open = a.request_status === 'submitted' || a.request_status === 'in_review';
  return {
    stage: stageOf(a),
    name: a.name,
    email: a.email,
    mobile: a.mobile,
    number: a.connected_number ?? (open && a.requested_number ? a.requested_number : null),
    request: a.request_id ? { id: a.request_id, status: a.request_status!, reason: a.reason ?? '', created_at: a.request_at! } : null,
    balance: await balanceOf(accountId),
    activation_min: (await getPhoneSettings()).activation_min,
    close_requested: a.close_requested,
  };
}

/** Support connected a personal account's number: tell the person it works. Never blocks support. */
export function notifyNumberReady(accountId: number, number: string): void {
  void (async () => {
    const r = await one<{ email: string; name: string }>("SELECT u.email, u.name FROM users u JOIN accounts a ON a.id = u.account_id WHERE a.id = $1 AND a.kind = 'personal' AND u.is_owner", [accountId]);
    if (r) await sendMail(emails.phoneReady(r.email, r.name, number));
  })().catch((err) => console.warn('[phone] number-ready email failed:', (err as Error).message));
}
