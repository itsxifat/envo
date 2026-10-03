import { EventEmitter } from 'node:events';
import { ami } from './pbx.js';
import type { AmiMessage } from './ami.js';
import { endpointDirectory, registrationDirectory } from './apply.js';

export interface LiveContact {
  endpoint: string;
  uri: string;
  status: string;
  rttMs: number | null;
  userAgent: string;
  via: string;
  expiresAt: number | null;
}

export interface LiveRegistration {
  name: string;
  status: string;
  serverUri: string;
  clientUri: string;
  nextRegSec: number | null;
}

export interface LiveChannel {
  name: string;
  uniqueid: string;
  linkedid: string;
  state: string;
  callerNum: string;
  callerName: string;
  connectedNum: string;
  connectedName: string;
  accountcode: string;
  context: string;
  exten: string;
  application: string;
  appData: string;
  startedAt: number;
  bridgeId: string;
  endpoint: string;
  tenantId: number | null;
}

export interface LiveExtState {
  exten: string;
  context: string;
  status: string;
  tenantId: number | null;
}

export interface AsteriskInfo {
  connected: boolean;
  version: string;
  startedAt: string | null;
  reloadedAt: string | null;
  currentCalls: number;
}

export type LiveKind = 'contacts' | 'registrations' | 'channels' | 'extstates' | 'asterisk' | 'groups';

const EXT_STATUS: Record<string, string> = {
  '-2': 'removed',
  '-1': 'unknown',
  '0': 'idle',
  '1': 'inuse',
  '2': 'busy',
  '4': 'unavailable',
  '8': 'ringing',
  '9': 'ringing',
  '16': 'onhold',
  '17': 'onhold',
};

function durationToSec(value: string | undefined): number {
  if (!value) return 0;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function endpointOfChannel(channel: string): string {
  const m = /^PJSIP\/(.+)-[0-9a-f]{8}$/.exec(channel);
  return m ? m[1]! : '';
}

export function tenantOf(opts: { accountcode?: string; endpoint?: string; context?: string }): number | null {
  const acc = /^t(\d+)$/.exec(opts.accountcode ?? '');
  if (acc) return Number(acc[1]);
  if (opts.endpoint) {
    const info = endpointDirectory.get(opts.endpoint);
    if (info && info.tenantId !== null) return info.tenantId;
  }
  const ctx = /^t(\d+)-/.exec(opts.context ?? '');
  return ctx ? Number(ctx[1]) : null;
}

class LiveState extends EventEmitter {
  contacts: LiveContact[] = [];
  registrations: LiveRegistration[] = [];
  channels: LiveChannel[] = [];
  /** Channel-limit usage from Asterisk GROUP(): "envo_trunk/trunk5" -> channels in use. */
  groups: Record<string, number> = {};
  extStates = new Map<string, LiveExtState>();
  asterisk: AsteriskInfo = { connected: false, version: '', startedAt: null, reloadedAt: null, currentCalls: 0 };

  private timers = new Map<LiveKind, NodeJS.Timeout>();
  private poller: NodeJS.Timeout | null = null;

  start(): void {
    ami.on('connected', () => {
      this.asterisk.connected = true;
      void this.refreshAll();
    });
    ami.on('disconnected', () => {
      this.asterisk.connected = false;
      this.channels = [];
      this.groups = {};
      this.contacts = [];
      this.registrations = [];
      this.emit('update', 'asterisk');
      this.emit('update', 'channels');
      this.emit('update', 'groups');
      this.emit('update', 'contacts');
      this.emit('update', 'registrations');
    });
    ami.on('event', (e: AmiMessage) => this.onEvent(e));
    this.poller = setInterval(() => {
      if (ami.connected) void this.refreshAll();
    }, 15_000);
  }

  stop(): void {
    if (this.poller) clearInterval(this.poller);
  }

  private onEvent(e: AmiMessage): void {
    switch (e.Event) {
      case 'ContactStatus':
        this.debounce('contacts', 300);
        break;
      case 'Registry':
        this.debounce('registrations', 300);
        break;
      case 'Newchannel':
      case 'Hangup':
      case 'Newstate':
      case 'BridgeEnter':
      case 'BridgeLeave':
      case 'NewCallerid':
      case 'NewConnectedLine':
      case 'DialEnd':
      case 'Hold':
      case 'Unhold':
      case 'AttendedTransfer':
      case 'BlindTransfer':
        this.debounce('channels', 250);
        break;
      case 'ExtensionStatus': {
        const key = `${e.Context}:${e.Exten}`;
        const status = EXT_STATUS[String(e.Status)] ?? 'unknown';
        this.extStates.set(key, { exten: e.Exten, context: e.Context, status, tenantId: tenantOf({ context: e.Context }) });
        this.debounce('extstates', 150);
        break;
      }
      case 'FullyBooted':
      case 'Reload':
        this.debounce('asterisk', 500);
        this.debounce('contacts', 800);
        this.debounce('registrations', 800);
        this.debounce('extstates', 800);
        break;
      default:
        break;
    }
  }

  private debounce(kind: LiveKind, ms: number): void {
    if (this.timers.has(kind)) return;
    this.timers.set(
      kind,
      setTimeout(() => {
        this.timers.delete(kind);
        void this.refresh(kind);
      }, ms),
    );
  }

  async refreshAll(): Promise<void> {
    await Promise.all(
      (['asterisk', 'contacts', 'registrations', 'channels', 'extstates'] as LiveKind[]).map((k) => this.refresh(k)),
    );
  }

  private async refresh(kind: LiveKind): Promise<void> {
    if (!ami.connected) return;
    try {
      const before = JSON.stringify(this.snapshotOf(kind));
      switch (kind) {
        case 'contacts':
          await this.loadContacts();
          break;
        case 'registrations':
          await this.loadRegistrations();
          break;
        case 'channels':
        case 'groups': {
          const groupsBefore = JSON.stringify(this.groups);
          await this.loadChannels();
          this.groups = this.channels.length ? await this.loadGroups() : {};
          if (JSON.stringify(this.groups) !== groupsBefore) this.emit('update', 'groups');
          if (kind === 'groups') return;
          break;
        }
        case 'extstates':
          await this.loadExtStates();
          break;
        case 'asterisk':
          await this.loadAsterisk();
          break;
      }
      if (JSON.stringify(this.snapshotOf(kind)) !== before) this.emit('update', kind);
    } catch (err) {
      console.warn(`[live] refresh ${kind} failed:`, err instanceof Error ? err.message : err);
    }
  }

  snapshotOf(kind: LiveKind): unknown {
    switch (kind) {
      case 'contacts':
        return this.contacts;
      case 'registrations':
        return this.registrations;
      case 'channels':
        return this.channels;
      case 'extstates':
        return [...this.extStates.values()];
      case 'asterisk':
        return this.asterisk;
      case 'groups':
        return this.groups;
    }
  }

  private async loadGroups(): Promise<Record<string, number>> {
    const out = await ami.command('group show channels');
    const counts: Record<string, number> = {};
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 3 || !parts[0]!.includes('/') || !parts[2]!.startsWith('envo_')) continue;
      const key = `${parts[2]}/${parts[1]}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  private async loadContacts(): Promise<void> {
    const rows = await ami.list({ Action: 'PJSIPShowContacts' });
    this.contacts = rows
      .filter((r) => r.Event === 'ContactList')
      .map((r) => ({
        endpoint: r.Endpoint ?? '',
        uri: r.Uri ?? '',
        status: r.Status ?? 'Unknown',
        rttMs: r.RoundtripUsec && Number(r.RoundtripUsec) > 0 ? Math.round(Number(r.RoundtripUsec) / 1000) : null,
        userAgent: r.UserAgent ?? '',
        via: r.ViaAddr ? `${r.ViaAddr}${r.ViaPort ? `:${r.ViaPort}` : ''}` : '',
        expiresAt: r.RegExpire ? Number(r.RegExpire) : r.ExpirationTime ? Number(r.ExpirationTime) : null,
      }))
      .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  }

  private async loadRegistrations(): Promise<void> {
    const rows = await ami.list({ Action: 'PJSIPShowRegistrationsOutbound' });
    this.registrations = rows
      .filter((r) => r.Event === 'OutboundRegistrationDetail')
      .map((r) => ({
        name: r.ObjectName ?? '',
        status: r.Status ?? 'Unknown',
        serverUri: r.ServerUri ?? '',
        clientUri: r.ClientUri ?? '',
        nextRegSec: r.NextReg !== undefined ? Number(r.NextReg) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadChannels(): Promise<void> {
    const rows = await ami.list({ Action: 'CoreShowChannels' });
    const now = Date.now();
    const previous = new Map(this.channels.map((c) => [c.uniqueid, c.startedAt]));
    this.channels = rows
      .filter((r) => r.Event === 'CoreShowChannel')
      .map((r) => {
        const endpoint = endpointOfChannel(r.Channel ?? '');
        return {
          name: r.Channel ?? '',
          uniqueid: r.Uniqueid ?? '',
          linkedid: r.Linkedid ?? r.Uniqueid ?? '',
          state: r.ChannelStateDesc ?? '',
          callerNum: r.CallerIDNum ?? '',
          callerName: r.CallerIDName ?? '',
          connectedNum: r.ConnectedLineNum ?? '',
          connectedName: r.ConnectedLineName ?? '',
          accountcode: r.AccountCode ?? '',
          context: r.Context ?? '',
          exten: r.Exten ?? '',
          application: r.Application ?? '',
          appData: r.ApplicationData ?? '',
          startedAt: previous.get(r.Uniqueid) ?? now - durationToSec(r.Duration) * 1000,
          bridgeId: r.BridgeId ?? '',
          endpoint,
          tenantId: tenantOf({ accountcode: r.AccountCode, endpoint, context: r.Context }),
        };
      });
    this.asterisk.currentCalls = new Set(this.channels.map((c) => c.linkedid)).size;
  }

  private async loadExtStates(): Promise<void> {
    const rows = await ami.list({ Action: 'ExtensionStateList' });
    const next = new Map<string, LiveExtState>();
    for (const r of rows) {
      if (r.Event !== 'ExtensionStatus') continue;
      next.set(`${r.Context}:${r.Exten}`, {
        exten: r.Exten,
        context: r.Context,
        status: EXT_STATUS[String(r.Status)] ?? 'unknown',
        tenantId: tenantOf({ context: r.Context }),
      });
    }
    this.extStates = next;
  }

  private async loadAsterisk(): Promise<void> {
    const [settings, core] = await Promise.all([
      ami.action({ Action: 'CoreSettings' }),
      ami.action({ Action: 'CoreStatus' }),
    ]);
    const stamp = (date?: string, time?: string) => (date && time ? new Date(`${date}T${time}`).toISOString() : null);
    this.asterisk = {
      connected: ami.connected,
      version: settings.AsteriskVersion ?? '',
      startedAt: stamp(core.CoreStartupDate, core.CoreStartupTime),
      reloadedAt: stamp(core.CoreReloadDate, core.CoreReloadTime),
      currentCalls: this.asterisk.currentCalls,
    };
  }

  /** Registration state of a trunk endpoint (only registration-mode trunks have one). */
  registrationOf(endpoint: string): LiveRegistration | undefined {
    return this.registrations.find((r) => r.name === endpoint);
  }

  tenantOfRegistration(name: string): number | null {
    return registrationDirectory.get(name)?.tenantId ?? null;
  }
}

export const live = new LiveState();
