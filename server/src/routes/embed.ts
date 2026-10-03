import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { one } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { applyCors } from '../lib/apikey.js';
import { webPassword } from '../lib/secrets.js';
import { webEndpoint, type Extension } from '../asterisk/model.js';
import { getSettings } from '../settings.js';
import { EMBED_AUDIENCE } from './v1.js';

export const embedRouter = Router();

/**
 * The embedded phone exchanges the short-lived token from your backend for SIP credentials.
 * Called from the browser, so CORS follows the origins configured on the API key.
 */
embedRouter.options('/session', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.status(204).end();
});

embedRouter.post('/session', async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(4096) }).parse(req.body);
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(token, config.jwtSecret, { audience: EMBED_AUDIENCE }) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, 'The web phone token is invalid or has expired');
  }
  const key = await one<{ id: number; tenant_id: number; allowed_origins: string; enabled: boolean }>(
    'SELECT id, tenant_id, allowed_origins, enabled FROM api_keys WHERE id = $1',
    [Number(claims.kid)],
  );
  if (!key || !key.enabled) throw new HttpError(401, 'The API key behind this token is no longer active');
  if (!applyCors(res, req.headers.origin, key.allowed_origins)) {
    throw new HttpError(403, 'This origin is not allowed for the API key that issued the token');
  }

  const ext = await one<Extension & { tenant_name: string; tenant_enabled: boolean }>(
    `SELECT e.*, t.name AS tenant_name, t.enabled AS tenant_enabled
       FROM extensions e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = $1 AND e.tenant_id = $2`,
    [Number(claims.sub), key.tenant_id],
  );
  if (!ext || !ext.enabled || !ext.tenant_enabled || !ext.webrtc) {
    throw new HttpError(403, 'This extension cannot use the web phone');
  }
  const settings = await getSettings();
  res.json({
    wsUrl: `wss://${settings.sip_domain}/ws`,
    domain: settings.sip_domain,
    username: webEndpoint(ext),
    password: webPassword(ext.sip_username),
    displayName: ext.name,
    extension: ext.number,
    sipServer: ext.tenant_name,
    iceServers: settings.stun_server ? [{ urls: settings.stun_server }] : [],
  });
});
