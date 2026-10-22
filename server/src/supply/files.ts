import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { badRequest } from '../lib/http.js';

/**
 * Subscribers' ID documents (photo, NID or passport scan) for number requests. Kept outside anything
 * the web server serves, readable by this process only, and handed out only to platform admins.
 */

type Kind = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
const EXT: Record<Kind, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export const FILE_TYPES: Record<string, Kind> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

const root = () => path.join(config.paths.dataDir, 'kyc');

/** What a file really is, from its first bytes (the browser's claimed type is not trusted). */
function sniff(buf: Buffer): Kind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Stores one document of a request; returns its path relative to the KYC folder. */
export async function saveDocument(requestId: number, which: 'photo' | 'id', buf: Buffer, allowPdf: boolean): Promise<string> {
  const kind = sniff(buf);
  if (!kind || (kind === 'application/pdf' && !allowPdf)) {
    throw badRequest(which === 'photo' ? 'The photo must be a JPG, PNG or WebP image' : 'The ID document must be a JPG, PNG, WebP image or a PDF');
  }
  const dir = path.join(root(), String(requestId));
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const rel = `${requestId}/${which}.${EXT[kind]}`;
  await fs.writeFile(path.join(root(), rel), buf, { mode: 0o600 });
  return rel;
}

/** Absolute path of a stored document; only names this module created are accepted. */
export function documentPath(rel: string): { file: string; type: Kind } | null {
  const m = /^(\d+)\/(photo|id)\.(jpg|png|webp|pdf)$/.exec(rel);
  if (!m) return null;
  return { file: path.join(root(), rel), type: FILE_TYPES[m[3]!]! };
}

export async function deleteDocuments(requestId: number): Promise<void> {
  await fs.rm(path.join(root(), String(requestId)), { recursive: true, force: true });
}
