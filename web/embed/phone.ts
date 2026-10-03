/**
 * Envo embeddable web phone.
 *
 *   <script src="https://envo.enfinito.cloud/embed/phone.js"></script>
 *   <script>
 *     const phone = Envo.phone({ tokenUrl: '/my-backend/envo-token' });
 *     document.querySelector('#call').onclick = () => phone.call('01712345678');
 *   </script>
 *
 * Your backend mints the token with POST /api/v1/webphone/token using its API key, so the key
 * never reaches the browser. The widget renders inside a shadow root, so it cannot clash with
 * the host page's CSS.
 */
import { UA, WebSocketInterface, debug } from 'jssip';
import type { RTCSession } from 'jssip/lib/RTCSession';
import type { RTCSessionEvent } from 'jssip/lib/UA';
import { Tones } from '../src/phone/tones';

export interface PhoneOptions {
  /** Token from POST /api/v1/webphone/token (either this or tokenUrl). */
  token?: string;
  /** Endpoint on your own site that returns { token }. Called again if the phone needs to reconnect. */
  tokenUrl?: string;
  /** Envo base URL; defaults to the origin that served this script. */
  baseUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
  /** Show the panel immediately instead of just the floating button. */
  open?: boolean;
  /** Hide the floating button and drive the phone entirely from your own UI. */
  headless?: boolean;
  onEvent?: (event: PhoneEvent) => void;
}

export interface PhoneEvent {
  type: 'ready' | 'registered' | 'offline' | 'incoming' | 'accepted' | 'ended' | 'failed' | 'error';
  detail?: Record<string, unknown>;
}

interface Session {
  wsUrl: string;
  domain: string;
  username: string;
  password: string;
  displayName: string;
  extension: string;
  sipServer: string;
  iceServers: RTCIceServer[];
}

type CallState = 'idle' | 'ringing' | 'dialing' | 'progress' | 'active' | 'ended';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { position: fixed; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
.wrap.bottom-right { right: 20px; bottom: 20px; }
.wrap.bottom-left { left: 20px; bottom: 20px; align-items: flex-start; }
.panel { width: 316px; border-radius: 22px; background: #0b1220; color: #fff; overflow: hidden;
  box-shadow: 0 24px 60px rgba(2, 8, 23, .45); border: 1px solid rgba(255,255,255,.08);
  animation: rise .18s ease-out; }
@keyframes rise { from { transform: translateY(10px); opacity: 0 } to { transform: none; opacity: 1 } }
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; }
.who { min-width: 0 }
.title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.sub { font-size: 11px; color: #94a3b8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 8px; height: 8px; border-radius: 99px; background: #64748b; flex: none }
.dot.on { background: #34d399 } .dot.wait { background: #fbbf24 } .dot.off { background: #f43f5e }
.x { background: none; border: 0; color: #94a3b8; cursor: pointer; border-radius: 99px; padding: 6px; line-height: 0 }
.x:hover { background: rgba(255,255,255,.08); color: #fff }
.body { padding: 0 16px 18px }
.display { display: flex; align-items: center; gap: 8px; height: 46px; }
.display input { flex: 1; min-width: 0; background: none; border: 0; color: #fff; font-size: 22px; font-weight: 300;
  letter-spacing: .5px; text-align: center; outline: none }
.display input::placeholder { font-size: 15px; color: #64748b }
.pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
.key { height: 50px; border: 0; border-radius: 16px; background: rgba(255,255,255,.06); color: #fff; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; transition: background .12s, transform .08s }
.key:hover { background: rgba(255,255,255,.12) } .key:active { transform: scale(.95) }
.key b { font-size: 19px; font-weight: 500; line-height: 1 }
.key span { font-size: 8px; letter-spacing: .18em; color: #94a3b8; height: 10px; margin-top: 2px }
.row { display: flex; justify-content: center; gap: 30px; margin-top: 18px }
.round { width: 58px; height: 58px; border-radius: 99px; border: 0; cursor: pointer; display: grid; place-items: center;
  color: #fff; transition: transform .08s, filter .12s }
.round:active { transform: scale(.94) }
.round.green { background: #10b981; box-shadow: 0 10px 24px rgba(16,185,129,.32) }
.round.red { background: #f43f5e; box-shadow: 0 10px 24px rgba(244,63,94,.32) }
.round:disabled { opacity: .4; cursor: default; box-shadow: none }
.ctl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px }
.ctl button { background: rgba(255,255,255,.06); border: 0; border-radius: 14px; color: #fff; cursor: pointer;
  padding: 10px 4px; font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 6px }
.ctl button.on { background: #fff; color: #0b1220 }
.ctl button:hover { background: rgba(255,255,255,.14) } .ctl button.on:hover { background: #fff }
.call { text-align: center; padding: 6px 0 2px }
.avatar { width: 68px; height: 68px; border-radius: 99px; margin: 0 auto 12px; display: grid; place-items: center;
  font-size: 24px; font-weight: 600; background: linear-gradient(135deg, #2dd4bf, #0891b2) }
.avatar.ring { animation: pulse 1.4s infinite }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(45,212,191,.55) } 70% { box-shadow: 0 0 0 16px rgba(45,212,191,0) } 100% { box-shadow: 0 0 0 0 rgba(45,212,191,0) } }
.name { font-size: 17px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.num { font-size: 13px; color: #94a3b8 }
.state { font-size: 13px; color: #5eead4; margin-top: 6px; font-variant-numeric: tabular-nums }
.hint { margin-top: 14px; text-align: center; font-size: 10px; color: #64748b }
.fab { width: 56px; height: 56px; border-radius: 99px; border: 1px solid rgba(255,255,255,.1); background: #0b1220; color: #fff;
  cursor: pointer; display: grid; place-items: center; box-shadow: 0 14px 34px rgba(2,8,23,.4); position: relative;
  transition: transform .12s }
.fab:hover { transform: scale(1.06) }
.fab.incall { background: #f43f5e; border-color: transparent }
.fab.ringing { background: #10b981; border-color: transparent; animation: pulse 1.4s infinite }
.fab .badge { position: absolute; top: 3px; right: 3px; width: 11px; height: 11px; border-radius: 99px; border: 2px solid #0b1220 }
.xfer { margin-top: 16px; display: flex; flex-direction: column; gap: 8px }
.xfer input { width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06); color: #fff; font-size: 13px; outline: none }
.xfer input:focus { border-color: #2dd4bf }
.xfer .btns { display: flex; gap: 8px }
.xfer .btns button { flex: 1; padding: 9px; border-radius: 12px; border: 0; cursor: pointer; font-size: 13px }
.ghost { background: rgba(255,255,255,.08); color: #fff } .primary { background: #14b8a6; color: #04201d; font-weight: 600 }
`;

const KEYS: [string, string][] = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

const ICONS = {
  phone: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/></svg>',
  hangup: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l.71-.71a2 2 0 0 1 2.12-.45 12.8 12.8 0 0 0 2.34.64 2 2 0 0 1 1.73 2v3a2 2 0 0 1-2.18 2 19 19 0 0 1-8.63-3.07 19 19 0 0 1-3.31-2.66m-2.66-3.31A19 19 0 0 1 2.08 3.18 2 2 0 0 1 4 1h3a2 2 0 0 1 2 1.72 12.8 12.8 0 0 0 .64 2.34 2 2 0 0 1-.45 2.11L8.5 8"/><path d="m2 2 20 20"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pad: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></svg>',
  xfer: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6M12 9l6 6"/></svg>',
};

function scriptOrigin(): string {
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  try {
    return src ? new URL(src).origin : location.origin;
  } catch {
    return location.origin;
  }
}
const DEFAULT_BASE = scriptOrigin();

class EnvoPhone {
  private root: ShadowRoot;
  private host: HTMLDivElement;
  private ua: UA | null = null;
  private session: RTCSession | null = null;
  private audio: HTMLAudioElement;
  private tones = new Tones();
  private creds: Session | null = null;
  private reg: 'connecting' | 'online' | 'offline' = 'connecting';
  private state: CallState = 'idle';
  private remote = { number: '', name: '' };
  private answeredAt: number | null = null;
  private muted = false;
  private held = false;
  private view: 'keypad' | 'pad-in-call' | 'transfer' = 'keypad';
  private panelOpen: boolean;
  private number = '';
  private ticker: number | undefined;

  constructor(private opts: PhoneOptions) {
    this.panelOpen = !!opts.open;
    this.host = document.createElement('div');
    this.host.setAttribute('data-envo-phone', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style, document.createElement('div'));
    document.body.append(this.host);
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.host.append(this.audio);
    this.render();
    void this.connect();
  }

  // ------------------------------------------------------------ public API
  call(target: string): void {
    const clean = String(target).replace(/[^\d+*#]/g, '');
    if (!clean || !this.ua || this.reg !== 'online' || this.session) return;
    this.panelOpen = true;
    this.ua.call(`sip:${clean}@${this.creds!.domain}`, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: this.creds!.iceServers, rtcpMuxPolicy: 'require', bundlePolicy: 'max-bundle' },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    });
    this.render();
  }
  answer(): void {
    this.tones.stop();
    this.session?.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: this.creds?.iceServers ?? [], rtcpMuxPolicy: 'require', bundlePolicy: 'max-bundle' },
    });
  }
  hangup(): void {
    try {
      if (this.session?.isInProgress() && this.session.direction === 'incoming') {
        this.session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      } else this.session?.terminate();
    } catch {
      this.session = null;
      this.state = 'idle';
      this.render();
    }
  }
  open(): void {
    this.panelOpen = true;
    this.render();
  }
  close(): void {
    this.panelOpen = false;
    this.render();
  }
  get status(): { registration: string; call: CallState; extension: string | null } {
    return { registration: this.reg, call: this.state, extension: this.creds?.extension ?? null };
  }
  destroy(): void {
    this.session?.terminate();
    this.ua?.stop();
    this.tones.stop();
    window.clearInterval(this.ticker);
    this.host.remove();
  }

  // ------------------------------------------------------------ internals
  private emit(type: PhoneEvent['type'], detail?: Record<string, unknown>): void {
    this.opts.onEvent?.({ type, detail });
    this.host.dispatchEvent(new CustomEvent('envo', { detail: { type, ...detail }, bubbles: true, composed: true }));
  }

  private async fetchToken(): Promise<string> {
    if (this.opts.token) return this.opts.token;
    if (!this.opts.tokenUrl) throw new Error('Envo.phone needs a token or tokenUrl');
    const res = await fetch(this.opts.tokenUrl, { credentials: 'include' });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('token endpoint did not return a token');
    return data.token;
  }

  private async connect(): Promise<void> {
    try {
      const base = (this.opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
      const token = await this.fetchToken();
      const res = await fetch(`${base}/api/embed/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const msg = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      this.creds = (await res.json()) as Session;
      this.startUa();
      this.emit('ready', { extension: this.creds.extension });
    } catch (err) {
      this.reg = 'offline';
      this.render();
      this.emit('error', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  private startUa(): void {
    const c = this.creds!;
    debug.disable();
    const ua = new UA({
      sockets: [new WebSocketInterface(c.wsUrl)],
      uri: `sip:${c.username}@${c.domain}`,
      password: c.password,
      display_name: c.displayName,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'Envo Embedded Phone',
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
    });
    ua.on('registered', () => {
      this.reg = 'online';
      this.render();
      this.emit('registered', { extension: c.extension });
    });
    ua.on('unregistered', () => {
      this.reg = 'offline';
      this.render();
      this.emit('offline');
    });
    ua.on('registrationFailed', (e) => {
      this.reg = 'offline';
      this.render();
      this.emit('failed', { cause: e.cause });
    });
    ua.on('disconnected', () => {
      this.reg = 'connecting';
      this.render();
    });
    ua.on('newRTCSession', (e: RTCSessionEvent) => this.attach(e.session, e.originator as 'local' | 'remote'));
    ua.start();
    this.ua = ua;
  }

  private attach(s: RTCSession, originator: 'local' | 'remote'): void {
    if (originator === 'remote' && this.session) {
      s.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      return;
    }
    this.session = s;
    const incoming = originator === 'remote';
    this.remote = { number: s.remote_identity?.uri?.user ?? '', name: s.remote_identity?.display_name ?? '' };
    this.state = incoming ? 'ringing' : 'dialing';
    this.answeredAt = null;
    this.muted = false;
    this.held = false;
    this.view = 'keypad';
    if (incoming) {
      this.tones.startRingtone();
      this.panelOpen = true;
      this.emit('incoming', { from: this.remote.number, name: this.remote.name });
    }
    this.render();

    const attachAudio = (pc: RTCPeerConnection) =>
      pc.addEventListener('track', (ev) => {
        if (ev.streams[0]) {
          this.audio.srcObject = ev.streams[0];
          void this.audio.play().catch(() => undefined);
        }
      });
    s.on('peerconnection', (e) => attachAudio(e.peerconnection));
    if (s.connection) attachAudio(s.connection);

    let iceTimer: number | undefined;
    s.on('icecandidate', (e) => {
      const type = (e.candidate as RTCIceCandidate).type;
      window.clearTimeout(iceTimer);
      if (type === 'srflx' || type === 'relay') e.ready();
      else iceTimer = window.setTimeout(() => e.ready(), 1200);
    });

    s.on('progress', (e: unknown) => {
      if (incoming) return;
      this.state = 'progress';
      const code = (e as { response?: { status_code?: number } }).response?.status_code;
      if (code === 180) this.tones.startRingback();
      else this.tones.stop();
      this.render();
    });
    const answered = () => {
      this.tones.stop();
      this.answeredAt ??= Date.now();
      this.state = 'active';
      this.startTicker();
      this.render();
      this.emit('accepted', { number: this.remote.number });
    };
    s.on('accepted', answered);
    s.on('confirmed', answered);
    s.on('hold', () => {
      this.held = true;
      this.render();
    });
    s.on('unhold', () => {
      this.held = false;
      this.render();
    });
    s.on('muted', () => {
      this.muted = true;
      this.render();
    });
    s.on('unmuted', () => {
      this.muted = false;
      this.render();
    });
    const finish = (cause: string) => {
      window.clearTimeout(iceTimer);
      window.clearInterval(this.ticker);
      const talked = this.answeredAt ? Math.round((Date.now() - this.answeredAt) / 1000) : 0;
      this.answeredAt ? this.tones.hangup() : this.tones.stop();
      this.session = null;
      this.state = 'ended';
      this.audio.srcObject = null;
      this.render();
      this.emit('ended', { number: this.remote.number, talkSec: talked, cause });
      window.setTimeout(() => {
        if (this.state === 'ended') {
          this.state = 'idle';
          this.render();
        }
      }, 1600);
    };
    s.on('ended', (e) => finish(e.cause));
    s.on('failed', (e) => finish(e.cause));
  }

  private startTicker(): void {
    window.clearInterval(this.ticker);
    this.ticker = window.setInterval(() => {
      const el = this.root.querySelector('[data-timer]');
      if (el) el.textContent = this.timer();
    }, 1000);
  }

  private timer(): string {
    if (!this.answeredAt) return '';
    const s = Math.round((Date.now() - this.answeredAt) / 1000);
    return `${this.held ? 'On hold · ' : ''}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  private dtmf(digit: string): void {
    this.tones.dtmf(digit);
    if (this.session?.isEstablished()) {
      this.session.sendDTMF(digit, { transportType: 'RFC2833' as never, duration: 120, interToneGap: 70 });
    }
  }

  private transfer(target: string): void {
    const clean = target.replace(/[^\d+*#]/g, '');
    if (!clean || !this.session || !this.creds) return;
    this.session.refer(`sip:${clean}@${this.creds.domain}`);
    this.view = 'keypad';
    this.render();
  }

  // ------------------------------------------------------------ rendering
  private render(): void {
    const container = this.root.lastElementChild as HTMLDivElement;
    const dot = this.reg === 'online' ? 'on' : this.reg === 'connecting' ? 'wait' : 'off';
    const ringing = this.state === 'ringing';
    const inCall = this.state !== 'idle' && this.state !== 'ended';
    const label = this.reg === 'online' ? 'Online' : this.reg === 'connecting' ? 'Connecting…' : 'Offline';
    const initial = (this.remote.name || this.remote.number || '?').slice(0, 1).toUpperCase();

    const pad = (onKey: string) =>
      `<div class="pad">${KEYS.map(([k, s]) => `<button class="key" data-${onKey}="${k}"><b>${k}</b><span>${s}</span></button>`).join('')}</div>`;

    let body = '';
    if (this.state === 'idle' || this.state === 'ended') {
      body = `
        <div class="display">
          <input data-num placeholder="Enter number" value="${this.number.replace(/"/g, '')}" inputmode="tel" />
          ${this.number ? `<button class="x" data-del title="Delete">${ICONS.del}</button>` : ''}
        </div>
        ${pad('digit')}
        <div class="row"><button class="round green" data-call ${this.reg === 'online' && this.number ? '' : 'disabled'}>${ICONS.phone}</button></div>
        <div class="hint">${this.state === 'ended' ? 'Call ended' : `Extension ${this.creds?.extension ?? '—'} · powered by Envo`}</div>`;
    } else {
      const controls =
        this.view === 'pad-in-call'
          ? `${pad('dtmf')}<div class="row"><button class="round red" data-hangup>${ICONS.hangup}</button></div>
             <div class="hint"><button class="x" data-back style="font-size:11px;padding:4px 8px">Hide keypad</button></div>`
          : this.view === 'transfer'
            ? `<div class="xfer">
                 <input data-xfer placeholder="Transfer to extension or number" inputmode="tel" />
                 <div class="btns"><button class="ghost" data-back>Cancel</button><button class="primary" data-do-xfer>Transfer</button></div>
               </div>
               <div class="row"><button class="round red" data-hangup>${ICONS.hangup}</button></div>`
            : ringing
              ? `<div class="row">
                   <button class="round red" data-hangup>${ICONS.hangup}</button>
                   <button class="round green" data-answer>${ICONS.phone}</button>
                 </div>`
              : `<div class="ctl">
                   <button class="${this.muted ? 'on' : ''}" data-mute>${this.muted ? ICONS.micOff : ICONS.mic}Mute</button>
                   <button class="${this.held ? 'on' : ''}" data-hold>${this.held ? ICONS.play : ICONS.pause}${this.held ? 'Resume' : 'Hold'}</button>
                   <button data-open-pad>${ICONS.pad}Keypad</button>
                 </div>
                 <div class="ctl" style="grid-template-columns:1fr">
                   <button data-open-xfer>${ICONS.xfer}Transfer</button>
                 </div>
                 <div class="row"><button class="round red" data-hangup>${ICONS.hangup}</button></div>`;
      body = `
        <div class="call">
          <div class="avatar ${ringing ? 'ring' : ''}">${initial}</div>
          <div class="name">${escapeHtml(this.remote.name || this.remote.number || 'Unknown')}</div>
          ${this.remote.name ? `<div class="num">${escapeHtml(this.remote.number)}</div>` : ''}
          <div class="state" data-timer>${
            ringing ? 'Incoming call…' : this.state === 'dialing' ? 'Calling…' : this.state === 'progress' ? 'Ringing…' : this.timer()
          }</div>
        </div>
        ${controls}`;
    }

    container.className = `wrap ${this.opts.position ?? 'bottom-right'}`;
    container.innerHTML = `
      ${
        this.panelOpen
          ? `<div class="panel">
               <div class="head">
                 <div class="who">
                   <div class="title"><span class="dot ${dot}"></span>${escapeHtml(this.creds?.displayName ?? 'Web phone')}</div>
                   <div class="sub">${escapeHtml(this.creds ? `Ext ${this.creds.extension} · ${label}` : label)}</div>
                 </div>
                 <button class="x" data-close>${ICONS.close}</button>
               </div>
               <div class="body">${body}</div>
             </div>`
          : ''
      }
      ${
        this.opts.headless
          ? ''
          : `<button class="fab ${ringing ? 'ringing' : inCall ? 'incall' : ''}" data-fab>
               ${inCall && !ringing ? ICONS.hangup : ICONS.phone}
               <span class="badge" style="background:${dot === 'on' ? '#34d399' : dot === 'wait' ? '#fbbf24' : '#f43f5e'}"></span>
             </button>`
      }`;

    this.bind(container);
  }

  private bind(container: HTMLElement): void {
    const on = (sel: string, fn: (el: HTMLElement) => void) =>
      container.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));

    on('[data-fab]', () => {
      this.panelOpen = !this.panelOpen;
      this.render();
    });
    on('[data-close]', () => this.close());
    on('[data-digit]', (el) => {
      this.number += el.dataset.digit ?? '';
      this.tones.dtmf(el.dataset.digit ?? '');
      this.render();
      this.focusNumber();
    });
    on('[data-dtmf]', (el) => this.dtmf(el.dataset.dtmf ?? ''));
    on('[data-del]', () => {
      this.number = this.number.slice(0, -1);
      this.render();
      this.focusNumber();
    });
    on('[data-call]', () => this.call(this.number));
    on('[data-answer]', () => this.answer());
    on('[data-hangup]', () => this.hangup());
    on('[data-mute]', () => {
      if (!this.session) return;
      this.session.isMuted().audio ? this.session.unmute({ audio: true }) : this.session.mute({ audio: true });
    });
    on('[data-hold]', () => {
      if (!this.session) return;
      this.session.isOnHold().local ? this.session.unhold() : this.session.hold();
    });
    on('[data-open-pad]', () => {
      this.view = 'pad-in-call';
      this.render();
    });
    on('[data-open-xfer]', () => {
      this.view = 'transfer';
      this.render();
    });
    on('[data-back]', () => {
      this.view = 'keypad';
      this.render();
    });
    on('[data-do-xfer]', () => {
      const input = container.querySelector<HTMLInputElement>('[data-xfer]');
      if (input?.value) this.transfer(input.value);
    });

    const num = container.querySelector<HTMLInputElement>('[data-num]');
    num?.addEventListener('input', () => {
      this.number = num.value.replace(/[^\d+*#]/g, '');
      num.value = this.number;
    });
    num?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.call(this.number);
    });
  }

  private focusNumber(): void {
    const input = this.root.querySelector<HTMLInputElement>('[data-num]');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function phone(options: PhoneOptions): EnvoPhone {
  return new EnvoPhone(options);
}

export const version = '1.0.0';

// Auto-start from script attributes: <script src="…/embed/phone.js" data-token="…"></script>
const el = document.currentScript as HTMLScriptElement | null;
if (el?.dataset.token || el?.dataset.tokenUrl) {
  const auto = phone({
    token: el.dataset.token,
    tokenUrl: el.dataset.tokenUrl,
    position: (el.dataset.position as PhoneOptions['position']) ?? 'bottom-right',
    open: el.dataset.open === 'true',
  });
  (window as unknown as { envoPhone?: EnvoPhone }).envoPhone = auto;
}
