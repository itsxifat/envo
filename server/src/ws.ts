import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { userFromCookieHeader, type SessionUser } from './auth.js';
import { config } from './config.js';
import { live, type LiveKind } from './asterisk/live.js';
import { applyEvents, getApplyStatus, type ApplyStatus } from './asterisk/apply.js';
import { livePayload } from './routes/live.js';

interface Client {
  ws: WebSocket;
  user: SessionUser;
  alive: boolean;
}

const clients = new Set<Client>();
const KINDS: LiveKind[] = ['asterisk', 'contacts', 'registrations', 'channels', 'extstates', 'groups'];

function send(client: Client, message: unknown): void {
  if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(message));
}

function sendKind(client: Client, kind: LiveKind): void {
  send(client, { type: kind, data: livePayload(kind, client.user) });
}

/** Tells every client allowed to see `tenantId` that some data changed (they refetch). */
export function notifyChanged(entity: string, tenantId: number | null): void {
  for (const c of clients) {
    if (c.user.role === 'superadmin' || c.user.tenantId === tenantId) send(c, { type: 'changed', entity, tenantId });
  }
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url?.startsWith('/api/live')) {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (config.production && origin && origin !== `https://${config.publicHost}` && origin !== `https://${req.headers.host}`) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const user = await userFromCookieHeader(req.headers.cookie).catch(() => null);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, user, alive: true };
      clients.add(client);
      ws.on('pong', () => (client.alive = true));
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => clients.delete(client));
      ws.on('message', (raw) => {
        // Only "ping" keep-alives are expected from browsers.
        if (raw.toString() === 'ping') send(client, { type: 'pong' });
      });
      for (const kind of KINDS) sendKind(client, kind);
      if (user.role !== 'agent') send(client, { type: 'apply', data: getApplyStatus() });
    });
  });

  live.on('update', (kind: LiveKind) => {
    for (const c of clients) sendKind(c, kind);
  });

  applyEvents.on('status', (status: ApplyStatus) => {
    for (const c of clients) if (c.user.role !== 'agent') send(c, { type: 'apply', data: status });
  });

  setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 30_000).unref();
}
