import fs from 'node:fs/promises';
import path from 'node:path';
import { many } from '../db.js';
import { config } from '../config.js';
import { getAccountPlan } from './plan.js';

/** Recordings left over from a package that no longer includes recording are kept this long. */
const GRACE_DAYS_WITHOUT_RECORDING = 7;
const EVERY_MS = 6 * 3600_000;

interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

async function listFiles(dir: string): Promise<FileInfo[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FileInfo[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else if (e.isFile()) {
      const st = await fs.stat(p).catch(() => null);
      if (st) out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/** Removes date folders left empty after cleaning (t1/2026/10/03 -> t1/2026/10 -> t1/2026). */
async function pruneEmptyDirs(dir: string, keep: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const e of entries) if (e.isDirectory()) await pruneEmptyDirs(path.join(dir, e.name), keep);
  if (dir !== keep && (await fs.readdir(dir).catch(() => ['x'])).length === 0) await fs.rmdir(dir).catch(() => undefined);
}

/**
 * Applies every customer's package to their call recordings: older than the package's retention
 * period goes, then the oldest recordings until the account fits its storage quota.
 */
export async function enforceRecordingRetention(now = Date.now()): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const accounts = await many<{ id: number }>("SELECT id FROM accounts WHERE NOT internal AND status <> 'closed'");
  for (const { id } of accounts) {
    const plan = await getAccountPlan(id);
    const days = plan.limits.recording_days > 0 ? plan.limits.recording_days : GRACE_DAYS_WITHOUT_RECORDING;
    const quota = plan.limits.recording_mb === null ? null : plan.limits.recording_mb * 1048576;
    const tenants = await many<{ id: number }>('SELECT id FROM tenants WHERE account_id = $1', [id]);
    const all: FileInfo[] = [];
    for (const t of tenants) all.push(...(await listFiles(path.join(config.paths.monitorDir, `t${t.id}`))));
    const cutoff = now - days * 86400_000;
    const victims = new Set(all.filter((f) => f.mtimeMs < cutoff));
    if (quota !== null) {
      let total = all.filter((f) => !victims.has(f)).reduce((sum, f) => sum + f.size, 0);
      for (const f of all.filter((x) => !victims.has(x)).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (total <= quota) break;
        victims.add(f);
        total -= f.size;
      }
    }
    for (const f of victims) {
      try {
        await fs.unlink(f.path);
        files++;
        bytes += f.size;
      } catch {
        /* already gone or not ours to delete */
      }
    }
    if (victims.size) for (const t of tenants) await pruneEmptyDirs(path.join(config.paths.monitorDir, `t${t.id}`), path.join(config.paths.monitorDir, `t${t.id}`));
  }
  return { files, bytes };
}

export function startRetention(): void {
  const run = () =>
    void enforceRecordingRetention()
      .then((r) => r.files && console.log(`[retention] removed ${r.files} recording(s), ${Math.round(r.bytes / 1048576)} MB`))
      .catch((err) => console.warn('[retention] failed:', err));
  setTimeout(run, 60_000).unref();
  setInterval(run, EVERY_MS).unref();
}
