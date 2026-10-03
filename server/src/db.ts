import pg from 'pg';
import { config } from './config.js';

// COUNT(*) and bigserial come back as int8 strings; our values always fit in a JS number.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export async function many<T = any>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const res = await db.query(sql, params as any[]);
  return res.rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const rows = await many<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function exec(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<number> {
  const res = await db.query(sql, params as any[]);
  return res.rowCount ?? 0;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Builds "col1 = $n, col2 = $n+1" for an UPDATE from a plain object. */
export function updateSet(data: Record<string, unknown>, startIndex = 1): { clause: string; values: unknown[] } {
  const keys = Object.keys(data);
  const clause = keys.map((k, i) => `"${k}" = $${startIndex + i}`).join(', ');
  return { clause, values: keys.map((k) => data[k]) };
}

export function insertParts(data: Record<string, unknown>): { cols: string; placeholders: string; values: unknown[] } {
  const keys = Object.keys(data);
  return {
    cols: keys.map((k) => `"${k}"`).join(', '),
    placeholders: keys.map((_, i) => `$${i + 1}`).join(', '),
    values: keys.map((k) => data[k]),
  };
}
