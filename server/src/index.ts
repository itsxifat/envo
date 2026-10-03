import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { pool, exec, one } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { authenticate } from './auth.js';
import { errorHandler } from './lib/http.js';
import { ami } from './asterisk/pbx.js';
import { live } from './asterisk/live.js';
import type { AmiMessage } from './asterisk/ami.js';
import { applyNow, queueReload, runPendingReloads, syncAllExtensionState, verifyEndpoints } from './asterisk/apply.js';
import { attachWebSocket, notifyChanged } from './ws.js';
import { authRouter } from './routes/auth.js';
import { tenantRouter } from './routes/tenants.js';
import { extensionRouter } from './routes/extensions.js';
import { trunkRouter } from './routes/trunks.js';
import { numberRouter } from './routes/numbers.js';
import {
  ivrRouter,
  ringGroupRouter,
  queueRouter,
  timeConditionRouter,
  outboundRouteRouter,
  blockedRouter,
  conferenceRouter,
} from './routes/pbx.js';
import { soundRouter } from './routes/sounds.js';
import { userRouter } from './routes/users.js';
import { callRouter } from './routes/calls.js';
import { voicemailRouter } from './routes/voicemail.js';
import { liveRouter } from './routes/live.js';
import { systemRouter } from './routes/system.js';
import { webphoneRouter, dashboardRouter, destinationRouter } from './routes/misc.js';
import { v1Router } from './routes/v1.js';
import { embedRouter } from './routes/embed.js';
import { integrationRouter } from './routes/integrations.js';
import { startWebhooks } from './webhooks.js';

/** Keeps Postgres in sync when a phone changes DND / call forwarding with a feature code. */
async function onFeatureEvent(e: AmiMessage): Promise<void> {
  const tenantId = Number(e.Tenant);
  const ext = String(e.Ext ?? '');
  if (!Number.isInteger(tenantId) || !/^[0-9]{2,8}$/.test(ext)) return;
  const value = String(e.Value ?? '');
  if (e.Key === 'dnd') {
    await exec('UPDATE extensions SET dnd = $1, updated_at = now() WHERE tenant_id = $2 AND number = $3', [
      value === '1',
      tenantId,
      ext,
    ]);
  } else if (e.Key === 'cfu') {
    await exec('UPDATE extensions SET forward_always = $1, updated_at = now() WHERE tenant_id = $2 AND number = $3', [
      /^\+?[0-9*#]{1,32}$/.test(value) ? value : '',
      tenantId,
      ext,
    ]);
  } else {
    return;
  }
  notifyChanged('extensions', tenantId);
}

async function main(): Promise<void> {
  const applied = await migrate();
  // cdr_pgsql reads the table's columns only when it loads (a reload with an unchanged config
  // file is a no-op), so load it afresh after schema changes.
  const CDR_SCHEMA_MIGRATIONS = ['002_cdr_dialed'];
  if (!applied.includes('001_init') && applied.some((m) => CDR_SCHEMA_MIGRATIONS.includes(m))) {
    queueReload('module unload cdr_pgsql.so');
    queueReload('module load cdr_pgsql.so');
  }
  await seed();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const db = await one('SELECT 1 AS ok').catch(() => null);
    res.json({ ok: !!db, asterisk: ami.connected });
  });
  app.use('/api/auth', authRouter);
  // Machine-to-machine API (API key) and the embedded phone's token exchange: no dashboard session.
  app.use('/api/v1', v1Router);
  app.use('/api/embed', embedRouter);
  app.use('/api', authenticate);
  app.use('/api/tenants', tenantRouter);
  app.use('/api/extensions', extensionRouter);
  app.use('/api/trunks', trunkRouter);
  app.use('/api/numbers', numberRouter);
  app.use('/api/routes', outboundRouteRouter);
  app.use('/api/ivrs', ivrRouter);
  app.use('/api/ring-groups', ringGroupRouter);
  app.use('/api/queues', queueRouter);
  app.use('/api/time-conditions', timeConditionRouter);
  app.use('/api/blocked', blockedRouter);
  app.use('/api/conferences', conferenceRouter);
  app.use('/api/sounds', soundRouter);
  app.use('/api/users', userRouter);
  app.use('/api/calls', callRouter);
  app.use('/api/voicemail', voicemailRouter);
  app.use('/api/live', liveRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/webphone', webphoneRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/destinations', destinationRouter);
  app.use('/api/integrations', integrationRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);

  const server = http.createServer(app);
  attachWebSocket(server);

  ami.on('connected', () => {
    console.log('[ami] connected');
    void (async () => {
      try {
        await applyNow();
        await runPendingReloads();
        await verifyEndpoints();
        await syncAllExtensionState();
      } catch (err) {
        console.warn('[ami] post-connect sync failed:', err);
      }
    })();
  });
  ami.on('disconnected', () => console.warn('[ami] disconnected, retrying'));
  ami.on('socketError', (err: Error) => console.warn(`[ami] ${err.message}`));
  ami.on('event', (e: AmiMessage) => {
    if (e.Event === 'UserEvent' && e.UserEvent === 'EnvoFeature') void onFeatureEvent(e).catch(console.error);
  });

  live.start();
  startWebhooks();
  ami.start();
  // Write the Asterisk config right away, even if Asterisk is not reachable yet.
  await applyNow();

  server.listen(config.port, config.host, () => {
    console.log(`[envo] listening on http://${config.host}:${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[envo] ${signal}, shutting down`);
    live.stop();
    ami.stop();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[envo] fatal:', err);
  process.exit(1);
});
