import { pool } from './db.js';
import m001 from '../migrations/001_init.sql';
import m002 from '../migrations/002_cdr_dialed.sql';
import m003 from '../migrations/003_blocklist_conferences.sql';
import m004 from '../migrations/004_api_integrations.sql';
import m005 from '../migrations/005_accounts_packages.sql';
import m006 from '../migrations/006_billing.sql';
import m007 from '../migrations/007_signup_email.sql';

// Ordered list; append new migrations, never edit applied ones.
const migrations: Array<[string, string]> = [
  ['001_init', m001],
  ['002_cdr_dialed', m002],
  ['003_blocklist_conferences', m003],
  ['004_api_integrations', m004],
  ['005_accounts_packages', m005],
  ['006_billing', m006],
  ['007_signup_email', m007],
];

/** Applies pending migrations; returns the versions applied in this run. */
export async function migrate(): Promise<string[]> {
  const appliedNow: string[] = [];
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Serialize concurrent starts.
    await client.query('SELECT pg_advisory_lock(424242)');
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    for (const [version, sql] of migrations) {
      if (applied.has(version)) continue;
      console.log(`[migrate] applying ${version}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        appliedNow.push(version);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined);
    client.release();
  }
  return appliedNow;
}
