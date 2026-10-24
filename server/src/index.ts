import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { pool, exec, one } from './db.js';
import { migrate } from './migrate.js';
import { prepareSetup } from './setup.js';
import { checkEmailOnStart } from './lib/mailer.js';
import { authenticate, requireActiveAccount, requireRole } from './auth.js';
import { errorHandler, forbidden } from './lib/http.js';
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
import { recordingRouter } from './routes/recordings.js';
import { voicemailRouter } from './routes/voicemail.js';
import { liveRouter } from './routes/live.js';
import { systemRouter } from './routes/system.js';
import { webphoneRouter, dashboardRouter, destinationRouter } from './routes/misc.js';
import { v1Router } from './routes/v1.js';
import { embedRouter } from './routes/embed.js';
import { integrationRouter } from './routes/integrations.js';
import { startWebhooks } from './webhooks.js';
import { accountRouter } from './routes/account.js';
import { adminRouter, publicRouter } from './routes/admin.js';
import { adminConsoleRouter } from './routes/adminConsole.js';
import { setupRouter } from './routes/setup.js';
import { adminSupplyRouter, numberRequestsRouter } from './routes/numberRequests.js';
import { startRetention } from './billing/retention.js';
import { startBillingClock } from './billing/jobs.js';
import { adminBillingRouter, billingRouter, enfinitoPayRouter, gatewayRouter } from './routes/billing.js';
import { signupRouter } from './routes/signup.js';
import { adminPhoneRouter, phonePublicRouter, phoneRouter } from './routes/phone.js';
import { startPhoneJobs } from './phone/jobs.js';

/** Envo Phone accounts use their phone (the app or the Phone page), not the PBX's settings. */
const PERSONAL_PATHS = ['/webphone'];

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
  await prepareSetup();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  // Before the JSON parser: Enfinito Pay signs the raw body of its webhooks.
  app.use('/api/public/enfinito-pay', enfinitoPayRouter);
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
  app.use('/api/public/sslcommerz', gatewayRouter);
  app.use('/api/public/phone', phonePublicRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/public', signupRouter);
  app.use('/api', authenticate);
  // Envo Phone works for pending accounts too: signing up, the registration and the first recharge.
  app.use('/api/phone', phoneRouter);
  // Plan, usage and billing stay reachable while an account is pending or suspended.
  app.use('/api/account/billing', billingRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/admin/billing', requireRole('superadmin'), adminBillingRouter);
  app.use('/api/admin/number-supply', requireRole('superadmin'), adminSupplyRouter);
  app.use('/api/admin/phone', requireRole('superadmin'), adminPhoneRouter);
  app.use('/api/admin', requireRole('superadmin'), adminConsoleRouter);
  app.use('/api/admin', requireRole('superadmin'), adminRouter);
  app.use('/api', requireActiveAccount);
  app.use('/api', (req, _res, next) =>
    next(req.user!.accountKind === 'personal' && !PERSONAL_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`)) ? forbidden('Envo Phone accounts use the Phone page') : undefined),
  );
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
  app.use('/api/recordings', recordingRouter);
  app.use('/api/voicemail', voicemailRouter);
  app.use('/api/live', liveRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/webphone', webphoneRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/destinations', destinationRouter);
  app.use('/api/integrations', integrationRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/number-requests', numberRequestsRouter);
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
  startRetention();
  startBillingClock();
  startPhoneJobs();
  void checkEmailOnStart();
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
