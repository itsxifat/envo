import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/** Recording files as Asterisk writes them (envo-record): t<tenant>/YYYY/MM/DD/<uniqueid>.wav */
export const RECORDING_RE = /^t\d+\/\d{4}\/\d{2}\/\d{2}\/[0-9A-Za-z._-]+\.wav$/;

/**
 * While a call is recorded its audio goes to <uniqueid>.sln16 next to the final file, and to
 * <uniqueid>.part.wav while that is converted after hangup (envo-record in envo-lib.conf).
 */
export const CAPTURE_EXT = '.sln16';
export const PART_EXT = '.part.wav';
/** A WAV of this size holds no audio (calls recorded before 2026-10-14 that never connected). */
export const WAV_HEADER_BYTES = 44;

/** A finished recording, as opposed to the work files of a call that is still being recorded. */
export function isFinishedRecording(name: string): boolean {
  return name.endsWith('.wav') && !name.endsWith(PART_EXT);
}

export function isWorkFile(name: string): boolean {
  return name.endsWith(CAPTURE_EXT) || name.endsWith(PART_EXT);
}

export interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Files below dir whose name passes keep - by default the finished recordings. */
export async function listFiles(dir: string, keep: (name: string) => boolean = isFinishedRecording): Promise<FileInfo[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FileInfo[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, keep)));
    else if (e.isFile() && keep(e.name)) {
      const st = await fs.stat(p).catch(() => null);
      if (st) out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/**
 * The recording of a call record can be played: its WAV exists, or the call has just ended and its
 * capture is still being converted. Calls that were answered but never connected to anyone (e.g. a
 * ring group that ends in voicemail) have neither.
 */
export async function recordingAvailable(recordingfile: string): Promise<boolean> {
  if (!RECORDING_RE.test(recordingfile)) return false;
  const file = path.join(config.paths.monitorDir, recordingfile);
  const wav = await fs.stat(file).catch(() => null);
  if (wav) return wav.size > WAV_HEADER_BYTES;
  const capture = await fs.stat(`${file.slice(0, -'.wav'.length)}${CAPTURE_EXT}`).catch(() => null);
  return !!capture && capture.size > 0;
}
