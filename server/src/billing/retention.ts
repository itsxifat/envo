import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exec, many } from '../db.js';
import { config } from '../config.js';
import { getAccountPlan, type AccountPlan } from './plan.js';
import { CAPTURE_EXT, isWorkFile, listFiles, RECORDING_RE, WAV_HEADER_BYTES, type FileInfo } from '../lib/recordingFiles.js';

export { listFiles, RECORDING_RE, type FileInfo };

const run = promisify(execFile);

/** Recordings left over from a package that no longer includes recording are kept this long. */
const GRACE_DAYS_WITHOUT_RECORDING = 7;
const EVERY_MS = 6 * 3600_000;
/** A capture nobody has written to for this long belongs to no call any more. */
const ORPHAN_AFTER_MS = 6 * 3600_000;

export interface RecordingRetention {
  /** Days a recording is kept after the call; null = until someone deletes it. */
  days: number | null;
  /** Storage quota of the whole account; null = unlimited. */
  quotaBytes: number | null;
  /** The package includes call recording. */
  included: boolean;
}

/** How long an account's recordings stay on the server (Enfinito's own account: until deleted). */
export function recordingRetention(plan: AccountPlan): RecordingRetention {
  if (plan.internal) return { days: null, quotaBytes: null, included: true };
  const included = plan.limits.recording_days > 0;
  return {
    days: included ? plan.limits.recording_days : GRACE_DAYS_WITHOUT_RECORDING,
    quotaBytes: plan.limits.recording_mb === null ? null : plan.limits.recording_mb * 1048576,
    included,
  };
}

/** Path of a recording below the monitor directory, as stored in cdr.recordingfile. */
export function recordingRelPath(file: string): string {
  return path.relative(config.paths.monitorDir, file).split(path.sep).join('/');
}

/** Call records stop offering recordings whose files were removed. */
export async function forgetRecordings(relPaths: string[]): Promise<void> {
  for (let i = 0; i < relPaths.length; i += 1000) {
    await exec("UPDATE cdr SET recordingfile = '' WHERE recordingfile = ANY($1::text[])", [relPaths.slice(i, i + 1000)]);
  }
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
    const { days, quotaBytes: quota } = recordingRetention(await getAccountPlan(id));
    if (days === null) continue;
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
    const removed: string[] = [];
    for (const f of victims) {
      try {
        await fs.unlink(f.path);
        files++;
        bytes += f.size;
        removed.push(recordingRelPath(f.path));
      } catch {
        /* already gone or not ours to delete */
      }
    }
    await forgetRecordings(removed);
    if (victims.size) for (const t of tenants) await pruneEmptyDirs(path.join(config.paths.monitorDir, `t${t.id}`), path.join(config.paths.monitorDir, `t${t.id}`));
  }
  return { files, bytes };
}

/**
 * Captures whose conversion never ran (Asterisk stopped mid-call, or sox failed) become the WAV their
 * call record points to; leftovers of an interrupted conversion are removed.
 */
export async function recoverOrphanedCaptures(now = Date.now()): Promise<number> {
  const stale = (await listFiles(config.paths.monitorDir, isWorkFile)).filter((f) => f.mtimeMs < now - ORPHAN_AFTER_MS);
  let recovered = 0;
  for (const f of stale) {
    if (!f.path.endsWith(CAPTURE_EXT)) {
      // <uniqueid>.part.wav: its capture, if still there, is converted again.
      await fs.unlink(f.path).catch(() => undefined);
      continue;
    }
    const base = f.path.slice(0, -CAPTURE_EXT.length);
    try {
      if (f.size > 0 && !(await fs.access(`${base}.wav`).then(() => true, () => false))) {
        const part = `${base}.part.wav`;
        await run(
          config.paths.ffmpeg,
          ['-nostdin', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', f.path, '-ar', '8000', '-acodec', 'pcm_s16le', part],
          { timeout: 300_000 },
        );
        // Retention and "recorded at" go by the file time: keep the time the call ended.
        await fs.utimes(part, new Date(f.mtimeMs), new Date(f.mtimeMs));
        await fs.rename(part, `${base}.wav`);
        recovered++;
      }
      await fs.unlink(f.path);
    } catch (err) {
      console.warn(`[retention] could not convert ${recordingRelPath(f.path)}:`, err);
    }
  }
  return recovered;
}

/**
 * Call records keep pointing at recordings that never got a file (MixMonitor writes only once the
 * call is bridged, so unanswered calls have none) or whose file is gone; they stop offering them.
 * A capture still waiting for conversion counts as present; a header-only WAV (left by unanswered
 * calls before captures were converted) is removed. Nothing is touched while the recordings folder
 * itself cannot be read.
 */
export async function forgetMissingRecordings(): Promise<number> {
  if (!(await fs.access(config.paths.monitorDir).then(() => true, () => false))) return 0;
  const rows = await many<{ recordingfile: string }>(
    "SELECT DISTINCT recordingfile FROM cdr WHERE recordingfile <> '' AND calldate < now() - interval '1 hour'",
  );
  // null = no such file; undefined = could not tell (left alone)
  const stat = (p: string) => fs.stat(p).catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? null : undefined));
  const missing: string[] = [];
  for (const { recordingfile } of rows) {
    if (!RECORDING_RE.test(recordingfile)) continue;
    const file = path.join(config.paths.monitorDir, recordingfile);
    const wav = await stat(file);
    if (wav === undefined || (wav && wav.size > WAV_HEADER_BYTES)) continue;
    if (wav) {
      if (await fs.unlink(file).then(() => true, () => false)) missing.push(recordingfile);
    } else if ((await stat(`${file.slice(0, -'.wav'.length)}${CAPTURE_EXT}`)) === null) {
      missing.push(recordingfile);
    }
  }
  await forgetRecordings(missing);
  return missing.length;
}

export function startRetention(): void {
  const tick = () =>
    void recoverOrphanedCaptures()
      .then((n) => n && console.log(`[retention] converted ${n} recording(s) left unfinished by Asterisk`))
      .then(() => enforceRecordingRetention())
      .then((r) => r.files && console.log(`[retention] removed ${r.files} recording(s), ${Math.round(r.bytes / 1048576)} MB`))
      .then(() => forgetMissingRecordings())
      .then((n) => n && console.log(`[retention] ${n} call record(s) had no recording file`))
      .catch((err) => console.warn('[retention] failed:', err));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, EVERY_MS).unref();
}
