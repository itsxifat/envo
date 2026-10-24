import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
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

/** The documents of a request: the photo, the ID, and the two head turns of a live selfie. */
export type DocumentKind = 'photo' | 'id' | 'turn-1' | 'turn-2';

/** Stores one document of a request; returns its path relative to the KYC folder. */
export async function saveDocument(requestId: number, which: DocumentKind, buf: Buffer, allowPdf: boolean): Promise<string> {
  const kind = sniff(buf);
  if (!kind || (kind === 'application/pdf' && !allowPdf)) {
    throw badRequest(which === 'id' ? 'The ID document must be a JPG, PNG, WebP image or a PDF' : 'The photo must be a JPG, PNG or WebP image');
  }
  const dir = path.join(root(), String(requestId));
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const rel = `${requestId}/${which}.${EXT[kind]}`;
  await fs.writeFile(path.join(root(), rel), buf, { mode: 0o600 });
  return rel;
}

/** Absolute path of a stored document; only names this module created are accepted. */
export function documentPath(rel: string): { file: string; type: Kind } | null {
  const m = /^(\d+)\/(photo|id|turn-1|turn-2)\.(jpg|png|webp|pdf)$/.exec(rel);
  if (!m) return null;
  return { file: path.join(root(), rel), type: FILE_TYPES[m[3]!]! };
}

// A4 portrait, in PDF points.
const PAGE = { width: 595.28, height: 841.89, margin: 36, gap: 24 };
/** A PNG is decoded to be embedded; its size (in the first chunk) is checked first. */
const MAX_PNG_PIXELS = 40_000_000;

/**
 * The operator wants the NID's front and back on one page, like a photocopy: front on the top half,
 * back on the bottom half, each as large as fits. A side can be a JPG or PNG photo, or a PDF (its
 * first page). Returns the one-page PDF.
 */
export async function combineIdSides(front: Buffer, back: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const boxW = PAGE.width - 2 * PAGE.margin;
  const boxH = (PAGE.height - 2 * PAGE.margin - PAGE.gap) / 2;
  for (const [i, buf] of [front, back].entries()) {
    const kind = sniff(buf);
    const side = i === 0 ? 'front' : 'back';
    // pdf-lib reads the whole underlying memory, so give it a copy that starts at the file's first byte.
    const bytes = new Uint8Array(buf);
    let size: { width: number; height: number };
    let draw: (o: { x: number; y: number; width: number; height: number }) => void;
    if (kind === 'image/jpeg' || kind === 'image/png') {
      if (kind === 'image/png' && (buf.length < 24 || buf.readUInt32BE(16) * buf.readUInt32BE(20) > MAX_PNG_PIXELS)) {
        throw badRequest(`The photo of the ${side} of the NID is too large. Send a smaller one`);
      }
      const img = await (kind === 'image/jpeg' ? doc.embedJpg(bytes) : doc.embedPng(bytes)).catch(() => {
        throw badRequest(`The photo of the ${side} of the NID could not be read. Take it again`);
      });
      size = img;
      draw = (o) => page.drawImage(img, o);
    } else if (kind === 'application/pdf') {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true }).catch(() => null);
      if (!src || !src.getPageCount()) throw badRequest(`The PDF for the ${side} of the NID could not be read`);
      if (src.isEncrypted) throw badRequest(`The PDF for the ${side} of the NID is protected. Send a photo of it instead`);
      const [embedded] = await doc.embedPdf(src, [0]).catch(() => {
        throw badRequest(`The PDF for the ${side} of the NID could not be read. Send a photo of it instead`);
      });
      size = embedded!;
      draw = (o) => page.drawPage(embedded!, o);
    } else {
      throw badRequest(`The ${side} of the NID must be a JPG or PNG photo, or a PDF`);
    }
    const scale = Math.min(boxW / size.width, boxH / size.height);
    const width = size.width * scale;
    const height = size.height * scale;
    const top = PAGE.height - PAGE.margin - i * (boxH + PAGE.gap);
    draw({ x: PAGE.margin + (boxW - width) / 2, y: top - boxH + (boxH - height) / 2, width, height });
  }
  doc.setTitle('NID, front and back');
  doc.setCreator('Envo');
  const saved = await doc.save().catch(() => {
    throw badRequest('The NID could not be read. Send photos of its front and back instead');
  });
  return Buffer.from(saved);
}

/**
 * The ID document of an upload: the NID's two sides made into one page, or one file that already has
 * both (a scan, or a passport). Null when neither was sent.
 */
export async function idDocumentOf(files: Record<string, Express.Multer.File[]> | undefined): Promise<Buffer | null> {
  const front = files?.id_front?.[0];
  const back = files?.id_back?.[0];
  if (front && back) return combineIdSides(front.buffer, back.buffer);
  if (front || back) throw badRequest(`Add the ${front ? 'back' : 'front'} of the NID too`);
  return files?.id_document?.[0]?.buffer ?? null;
}

// ------------------------------------------------------------------------------- selfie checks
/** A live selfie's three pictures (straight, then the two head turns) until a registration takes them. */
const checkDir = (id: string) => path.join(root(), 'checks', id);
const FRAMES = ['straight', 'turn-1', 'turn-2'] as const;

export async function saveCheckFrames(id: string, frames: Buffer[]): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad check id');
  await fs.mkdir(checkDir(id), { recursive: true, mode: 0o700 });
  await Promise.all(frames.map((f, i) => fs.writeFile(path.join(checkDir(id), `${FRAMES[i]}.jpg`), f, { mode: 0o600 })));
}

/** The pictures of a selfie check, straight first. */
export async function readCheckFrames(id: string): Promise<Buffer[]> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad check id');
  return Promise.all(FRAMES.map((f) => fs.readFile(path.join(checkDir(id), `${f}.jpg`))));
}

export async function deleteCheckFrames(id: string): Promise<void> {
  if (/^[0-9a-f-]{36}$/.test(id)) await fs.rm(checkDir(id), { recursive: true, force: true });
}

export async function deleteDocuments(requestId: number): Promise<void> {
  await fs.rm(path.join(root(), String(requestId)), { recursive: true, force: true });
}
