import { Router } from 'express';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { one } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest } from '../lib/http.js';
import { audit } from '../lib/validate.js';
import { ami } from '../asterisk/pbx.js';
import { live } from '../asterisk/live.js';
import { applyNow, getApplyStatus, scheduleApply } from '../asterisk/apply.js';
import { getSettings, updateSettings } from '../settings.js';

export const systemRouter = Router();

systemRouter.get('/status', requireRole('superadmin'), async (_req, res) => {
  const counts = await one(
    `SELECT (SELECT count(*) FROM tenants) AS tenants, (SELECT count(*) FROM extensions) AS extensions,
            (SELECT count(*) FROM trunks) AS trunks, (SELECT count(*) FROM numbers) AS numbers,
            (SELECT count(*) FROM cdr) AS cdr_rows`,
  );
  res.json({
    asterisk: live.asterisk,
    amiConnected: ami.connected,
    apply: getApplyStatus(),
    counts,
    app: { version: process.env.ENVO_VERSION ?? 'dev', uptimeSec: Math.round(process.uptime()), node: process.version },
  });
});

systemRouter.post('/apply', requireRole('superadmin'), async (req, res) => {
  await audit(req, 'apply', 'system', '', 'manual apply');
  res.json(await applyNow(true));
});

// Read-only diagnostics only; anything that changes state goes through the dashboard.
const CLI_ALLOWED = [
  /^core show (version|uptime|channels?( concise| verbose)?|calls|settings|translation( recalc \d+)?|codecs?( audio)?|hints|taskprocessors)$/,
  /^pjsip show (endpoints?|aors?|auths?|contacts|registrations|transports?|identif(y|ies)|channels|channelstats|settings|history)( [\w@.\-]+)?$/,
  /^pjsip list (endpoints|aors|auths|contacts|registrations|transports|channels|identifies)$/,
  /^dialplan show( [\w@\-]+)?$/,
  /^queue show( [\w\-]+)?$/,
  /^voicemail show users( for [\w\-]+)?$/,
  /^database show envo( [\w/\-]+)?$/,
  /^module show( like \w+)?$/,
  /^group show channels( \w+)?$/,
  /^rtp (show )?settings$/,
  /^cdr show status$/,
  /^moh show classes$/,
];

systemRouter.post('/cli', requireRole('superadmin'), async (req, res) => {
  const { command } = z.object({ command: z.string().trim().min(3).max(120) }).parse(req.body);
  const normalized = command.replace(/\s+/g, ' ');
  if (!CLI_ALLOWED.some((re) => re.test(normalized))) {
    throw badRequest('Only read-only "show" commands are allowed here');
  }
  const output = await ami.command(normalized, 15_000);
  res.json({ output });
});

systemRouter.get('/logs', requireRole('superadmin'), async (req, res) => {
  const lines = Math.min(Number(req.query.lines ?? 200) || 200, 2000);
  const text = await fs.readFile('/var/log/asterisk/messages.log', 'utf8').catch(() => '');
  res.json({ lines: text.split('\n').slice(-lines - 1).join('\n') });
});

systemRouter.get('/settings', requireRole('superadmin', 'admin'), async (_req, res) => {
  res.json(await getSettings());
});

const settingsSchema = z.object({
  sip_domain: z.string().trim().min(3).max(253).regex(/^[a-zA-Z0-9.\-]+$/),
  public_ip: z.string().trim().regex(/^\d{1,3}(\.\d{1,3}){3}$/),
  country_code: z.string().trim().regex(/^[0-9]{0,4}$/),
  national_prefix: z.string().trim().regex(/^[0-9]{0,3}$/),
  stun_server: z.string().trim().regex(/^(stun|turn)s?:[a-zA-Z0-9.\-]+(:\d+)?$/).or(z.literal('')),
  company_name: z.string().trim().min(1).max(60),
});

systemRouter.put('/settings', requireRole('superadmin'), async (req, res) => {
  const data = settingsSchema.partial().parse(req.body);
  const settings = await updateSettings(data);
  await audit(req, 'update', 'settings', '', Object.keys(data).join(','));
  scheduleApply();
  res.json(settings);
});
