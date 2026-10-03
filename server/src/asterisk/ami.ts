import net from 'node:net';
import { EventEmitter } from 'node:events';

/** One AMI packet. Repeated keys (e.g. "Output") are collected in `multi`. */
export interface AmiMessage {
  [key: string]: any;
  multi: Record<string, string[]>;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  list: boolean;
  events: AmiMessage[];
  response?: AmiMessage;
  timer: NodeJS.Timeout;
}

export interface AmiOptions {
  host: string;
  port: number;
  user: string;
  secret: string;
}

type ActionFields = Record<string, string | number | boolean | string[] | undefined>;

function parseMessage(raw: string): AmiMessage {
  const msg: AmiMessage = { multi: {} };
  for (const line of raw.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).replace(/^ /, '');
    if (key in msg && key !== 'multi') {
      (msg.multi[key] ??= [msg[key]]).push(value);
    } else {
      msg[key] = value;
    }
  }
  return msg;
}

function clean(value: string): string {
  // AMI is line based; a CR/LF inside a value would let it inject extra headers.
  return value.replace(/[\r\n]+/g, ' ');
}

/**
 * Minimal, dependency-free Asterisk Manager Interface client with auto-reconnect,
 * ActionID correlation and EventList collection.
 */
export class Ami extends EventEmitter {
  connected = false;
  private socket?: net.Socket;
  private buffer = '';
  private greeted = false;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private retryDelay = 1000;
  private stopped = false;

  constructor(private opts: AmiOptions) {
    super();
    this.setMaxListeners(50);
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.destroy();
  }

  private open(): void {
    this.buffer = '';
    this.greeted = false;
    const socket = net.createConnection({ host: this.opts.host, port: this.opts.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setKeepAlive(true, 30_000);
    socket.setNoDelay(true);

    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (!this.greeted) {
        const idx = this.buffer.indexOf('\r\n');
        if (idx === -1) return;
        this.buffer = this.buffer.slice(idx + 2);
        this.greeted = true;
        void this.login();
      }
      let end: number;
      while ((end = this.buffer.indexOf('\r\n\r\n')) !== -1) {
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 4);
        if (raw.trim()) this.dispatch(parseMessage(raw));
      }
    });

    socket.on('error', (err) => {
      if (!this.stopped) this.emit('socketError', err);
    });

    socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('AMI connection closed'));
        this.pending.delete(id);
      }
      if (wasConnected) this.emit('disconnected');
      if (!this.stopped) {
        setTimeout(() => this.open(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
      }
    });
  }

  private async login(): Promise<void> {
    try {
      const res = await this.send({ Action: 'Login', Username: this.opts.user, Secret: this.opts.secret, Events: 'on' });
      if (res.Response !== 'Success') throw new Error(res.Message || 'AMI login failed');
      this.connected = true;
      this.retryDelay = 1000;
      this.emit('connected');
    } catch (err) {
      this.emit('socketError', err);
      this.socket?.destroy();
    }
  }

  private dispatch(msg: AmiMessage): void {
    const id = msg.ActionID as string | undefined;
    const pending = id ? this.pending.get(id) : undefined;

    if (pending && msg.Response !== undefined) {
      if (!pending.list || msg.Response !== 'Success' || msg.EventList !== 'start') {
        // Plain action, an error, or a list action that returned no list.
        if (pending.list && msg.Response === 'Success') {
          this.finish(id!, { response: msg, events: [] });
        } else if (msg.Response === 'Error' && pending.list) {
          // Asterisk reports an empty list as an error ("No Contacts found").
          if (/^no .*found/i.test(msg.Message ?? '')) this.finish(id!, { response: msg, events: [] });
          else this.fail(id!, new Error(msg.Message || 'AMI error'));
        } else {
          this.finish(id!, msg);
        }
        return;
      }
      pending.response = msg;
      return;
    }

    if (pending && msg.Event !== undefined) {
      if (msg.EventList === 'Complete' || /Complete$/.test(msg.Event)) {
        this.finish(id!, { response: pending.response ?? msg, events: pending.events });
      } else {
        pending.events.push(msg);
      }
      return;
    }

    if (msg.Event !== undefined) this.emit('event', msg);
  }

  private finish(id: string, value: any): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(value);
  }

  private fail(id: string, err: Error): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(err);
  }

  private send(fields: ActionFields, list = false, timeoutMs = 10_000): Promise<any> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error('AMI not connected'));
    const id = `envo-${++this.seq}`;
    let packet = '';
    for (const [key, value] of Object.entries({ ...fields, ActionID: id })) {
      if (value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) packet += `${key}: ${clean(String(v))}\r\n`;
    }
    packet += '\r\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, new Error(`AMI action ${fields.Action} timed out`)), timeoutMs);
      this.pending.set(id, { resolve, reject, list, events: [], timer });
      socket.write(packet);
    });
  }

  /** Sends an action and resolves with its response packet. */
  async action(fields: ActionFields, timeoutMs?: number): Promise<AmiMessage> {
    if (!this.connected) throw new Error('Asterisk is not connected');
    return this.send(fields, false, timeoutMs);
  }

  /** Sends an action that answers with an EventList and resolves with all list events. */
  async list(fields: ActionFields, timeoutMs = 20_000): Promise<AmiMessage[]> {
    if (!this.connected) throw new Error('Asterisk is not connected');
    const res = await this.send(fields, true, timeoutMs);
    return res.events ?? [];
  }

  /** Runs a CLI command and returns its output. */
  async command(cmd: string, timeoutMs?: number): Promise<string> {
    const res = await this.action({ Action: 'Command', Command: cmd }, timeoutMs);
    if (res.Response === 'Error') throw new Error(res.Message || `Command failed: ${cmd}`);
    const out = res.multi.Output ?? (res.Output !== undefined ? [res.Output] : []);
    return out.join('\n');
  }
}
