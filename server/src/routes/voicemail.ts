import { Router, type Request } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { one, many } from '../db.js';
import { tenantOf } from '../auth.js';
import { badRequest, forbidden, notFound } from '../lib/http.js';
import { config } from '../config.js';

const FOLDERS = ['INBOX', 'Old', 'Urgent'] as const;

interface VoicemailMessage {
  mailbox: string;
  folder: string;
  id: string;
  callerid: string;
  origtime: number;
  duration: number;
}

function parseInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0 && !line.startsWith(';')) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Mailboxes the user may read within the tenant. */
async function mailboxes(req: Request, tenantId: number): Promise<string[]> {
  const user = req.user!;
  if (user.role === 'agent') {
    const ext = user.extensionId
      ? await one<{ number: string; tenant_id: number }>('SELECT number, tenant_id FROM extensions WHERE id = $1', [user.extensionId])
      : null;
    return ext && ext.tenant_id === tenantId ? [ext.number] : [];
  }
  const rows = await many<{ number: string }>('SELECT number FROM extensions WHERE tenant_id = $1 AND voicemail', [tenantId]);
  return rows.map((r) => r.number);
}

function messagePath(tenantId: number, box: string, folder: string, msg: string): string {
  if (!/^[0-9]{2,8}$/.test(box) || !(FOLDERS as readonly string[]).includes(folder) || !/^msg\d{4}$/.test(msg)) {
    throw badRequest('Invalid voicemail reference');
  }
  return path.join(config.paths.voicemailDir, `t${tenantId}`, box, folder, msg);
}

export const voicemailRouter = Router();

voicemailRouter.get('/', async (req, res) => {
  const tenantId = tenantOf(req)!;
  const boxes = await mailboxes(req, tenantId);
  const messages: VoicemailMessage[] = [];
  for (const box of boxes) {
    for (const folder of FOLDERS) {
      const dir = path.join(config.paths.voicemailDir, `t${tenantId}`, box, folder);
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      for (const file of files.filter((f) => /^msg\d{4}\.txt$/.test(f))) {
        const info = parseInfo(await fs.readFile(path.join(dir, file), 'utf8').catch(() => ''));
        messages.push({
          mailbox: box,
          folder,
          id: file.slice(0, 7),
          callerid: info.callerid ?? '',
          origtime: Number(info.origtime ?? 0),
          duration: Number(info.duration ?? 0),
        });
      }
    }
  }
  messages.sort((a, b) => b.origtime - a.origtime);
  res.json(messages);
});

voicemailRouter.get('/:box/:folder/:msg/audio', async (req, res) => {
  const tenantId = tenantOf(req)!;
  if (!(await mailboxes(req, tenantId)).includes(String(req.params.box))) throw forbidden();
  const base = messagePath(tenantId, String(req.params.box), String(req.params.folder), String(req.params.msg));
  const file = `${base}.wav`;
  await fs.access(file).catch(() => {
    throw notFound('Voicemail');
  });
  res.sendFile(file);
});

voicemailRouter.delete('/:box/:folder/:msg', async (req, res) => {
  const tenantId = tenantOf(req)!;
  if (!(await mailboxes(req, tenantId)).includes(String(req.params.box))) throw forbidden();
  const base = messagePath(tenantId, String(req.params.box), String(req.params.folder), String(req.params.msg));
  const dir = path.dirname(base);
  const prefix = path.basename(base);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const victims = files.filter((f) => f.startsWith(`${prefix}.`));
  if (!victims.length) throw notFound('Voicemail');
  await Promise.all(victims.map((f) => fs.rm(path.join(dir, f), { force: true })));
  res.json({ ok: true });
});
