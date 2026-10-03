import { one, tx } from './db.js';
import { config } from './config.js';
import { hashPassword } from './auth.js';
import { randomPassword, randomPin } from './lib/secrets.js';

/**
 * First start: Enfinito's internal account with one SIP server, a web-phone extension for the
 * platform admin and two extensions for IP phones.
 */
export async function seed(): Promise<void> {
  const existing = await one<{ count: number }>('SELECT count(*) AS count FROM users');
  if ((existing?.count ?? 0) > 0) return;

  const password = config.admin.password || randomPassword(16);
  await tx(async (db) => {
    const account = (
      await db.query(`INSERT INTO accounts (name, email, status, internal) VALUES ('Enfinito', $1, 'active', true) RETURNING id`, [
        config.admin.email.toLowerCase(),
      ])
    ).rows[0] as { id: number };
    const tenant = (
      await db.query(
        `INSERT INTO tenants (name, slug, description, recording, account_id) VALUES ('Main', 'main', 'Default SIP server', 'off', $1) RETURNING id`,
        [account.id],
      )
    ).rows[0] as { id: number };

    const ext = async (number: string, name: string) =>
      (
        await db.query(
          `INSERT INTO extensions (tenant_id, number, name, sip_username, sip_password, voicemail_pin)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenant.id, number, name, `${number}_main`, randomPassword(), randomPin()],
        )
      ).rows[0] as { id: number };

    const admin = await ext('1000', 'Admin');
    await ext('1001', 'IP Phone 1001');
    await ext('1002', 'IP Phone 1002');

    await db.query(
      `INSERT INTO users (email, name, password_hash, role, tenant_id, extension_id, email_verified_at)
       VALUES ($1, 'Administrator', $2, 'superadmin', NULL, $3, now())`,
      [config.admin.email.toLowerCase(), await hashPassword(password), admin.id],
    );
  });

  console.log(`[seed] created admin user ${config.admin.email}`);
  if (!config.admin.password) console.log(`[seed] generated admin password: ${password}`);
}
