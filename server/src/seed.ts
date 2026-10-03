import { one, tx } from './db.js';
import { config } from './config.js';
import { hashPassword } from './auth.js';
import { randomPassword, randomPin } from './lib/secrets.js';

/** First start: one SIP server, a web-phone extension for the admin and two extensions for IP phones. */
export async function seed(): Promise<void> {
  const existing = await one<{ count: number }>('SELECT count(*) AS count FROM users');
  if ((existing?.count ?? 0) > 0) return;

  const password = config.admin.password || randomPassword(16);
  await tx(async (db) => {
    const tenant = (
      await db.query(
        `INSERT INTO tenants (name, slug, description, recording) VALUES ('Main', 'main', 'Default SIP server', 'off') RETURNING id`,
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
      `INSERT INTO users (email, name, password_hash, role, tenant_id, extension_id)
       VALUES ($1, 'Administrator', $2, 'superadmin', NULL, $3)`,
      [config.admin.email.toLowerCase(), await hashPassword(password), admin.id],
    );
  });

  console.log(`[seed] created admin user ${config.admin.email}`);
  if (!config.admin.password) console.log(`[seed] generated admin password: ${password}`);
}
