import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UA, WebSocketInterface, debug } from 'jssip';
import type { RTCSession } from 'jssip/lib/RTCSession';
import type { RTCSessionEvent } from 'jssip/lib/UA';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../state/auth';
import { Tones } from './tones';

export interface PhoneConfig {
  enabled: boolean;
  reason?: string;
  wsUrl: string;
  domain: string;
  username: string;
  password: string;
  displayName: string;
  extension: string;
  extensionId: number;
  tenantId: number;
  tenantName: string;
  iceServers: RTCIceServer[];
}

export type RegState = 'off' | 'connecting' | 'registered' | 'unregistered' | 'failed';

export interface ActiveCall {
  id: string;
  direction: 'incoming' | 'outgoing';
  number: string;
  name: string;
  state: 'ringing' | 'dialing' | 'progress' | 'active' | 'ended';
  answeredAt: number | null;
  muted: boolean;
  held: boolean;
  endReason?: string;
}

export interface CallLogEntry {
  id: string;
  direction: 'incoming' | 'outgoing';
  number: string;
  name: string;
  at: number;
  duration: number;
  status: 'answered' | 'missed' | 'failed' | 'rejected' | 'cancelled';
}

/** Live media health for the call in progress. */
export interface CallQuality {
  /** 0 = no data, 1 = poor … 4 = excellent. */
  score: 0 | 1 | 2 | 3 | 4;
  lossPct: number;
  jitterMs: number;
  rttMs: number;
  codec: string;
  /** Microphone loudness, 0-1, so the user can see their mic is live. */
  micLevel: number;
}

export interface AudioDevices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

interface PhoneApi {
  config: PhoneConfig | null;
  reg: RegState;
  regError: string;
  call: ActiveCall | null;
  quality: CallQuality | null;
  history: CallLogEntry[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  dial: (target: string) => void;
  answer: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  dtmf: (digit: string) => void;
  transfer: (target: string) => void;
  clearHistory: () => void;
  devices: AudioDevices;
  micId: string;
  speakerId: string;
  setMicId: (id: string) => void;
  setSpeakerId: (id: string) => void;
  refreshDevices: () => Promise<void>;
  canChooseSpeaker: boolean;
  /** Plays a short tone through the selected speaker. No-op during a call. */
  testSpeaker: () => void;
}

const PhoneContext = createContext<PhoneApi | null>(null);
const HISTORY_KEY = 'envo.phone.history';
const MIC_KEY = 'envo.phone.mic';
const SPEAKER_KEY = 'envo.phone.speaker';

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string): void {
  try {
    value ? localStorage.setItem(key, value) : localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function qualityScore(lossPct: number, jitterMs: number, rttMs: number): CallQuality['score'] {
  if (lossPct >= 8 || jitterMs >= 60 || rttMs >= 500) return 1;
  if (lossPct >= 3 || jitterMs >= 30 || rttMs >= 300) return 2;
  if (lossPct >= 1 || jitterMs >= 15 || rttMs >= 180) return 3;
  return 4;
}

function loadHistory(): CallLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as CallLogEntry[];
  } catch {
    return [];
  }
}

function saveHistory(list: CallLogEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* storage unavailable */
  }
}

function friendlyCause(cause: string): string {
  const map: Record<string, string> = {
    Busy: 'Busy',
    Rejected: 'Declined',
    'Not Found': 'Number not found',
    Unavailable: 'Unavailable',
    'No Answer': 'No answer',
    Canceled: 'Cancelled',
    'Request Timeout': 'Timed out',
    'User Denied Media Access': 'Microphone access was blocked',
    'Connection Error': 'Connection lost',
    'Authentication Error': 'Authentication failed',
    'Address Incomplete': 'Incomplete number',
    'Incompatible SDP': 'Audio negotiation failed',
    Terminated: 'Call ended',
    'WebRTC Error': 'Audio device error',
  };
  return map[cause] ?? cause;
}

export function PhoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: config = null } = useQuery({
    queryKey: ['webphone', user?.id],
    queryFn: () => api.get<PhoneConfig>('/api/webphone'),
    enabled: !!user,
    staleTime: Infinity,
  });

  const ua = useRef<UA | null>(null);
  const session = useRef<RTCSession | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tones = useRef(new Tones());
  const [reg, setReg] = useState<RegState>('off');
  const [regError, setRegError] = useState('');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [history, setHistory] = useState<CallLogEntry[]>(loadHistory);
  const [panelOpen, setPanelOpen] = useState(false);
  const [quality, setQuality] = useState<CallQuality | null>(null);
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const [micId, setMicIdState] = useState(() => readStored(MIC_KEY));
  const [speakerId, setSpeakerIdState] = useState(() => readStored(SPEAKER_KEY));
  const micIdRef = useRef(micId);
  micIdRef.current = micId;

  const pcConfig = useMemo<RTCConfiguration>(
    () => ({ iceServers: config?.iceServers ?? [], rtcpMuxPolicy: 'require', bundlePolicy: 'max-bundle' }),
    [config],
  );
  /** Honour the chosen microphone; `true` lets the browser pick its default. */
  const mediaConstraints = useMemo<MediaStreamConstraints>(
    () => ({ audio: micId ? { deviceId: { exact: micId } } : true, video: false }),
    [micId],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        inputs: all.filter((d) => d.kind === 'audioinput'),
        outputs: all.filter((d) => d.kind === 'audiooutput'),
      });
    } catch {
      /* permission not granted yet */
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  // Route call audio to the chosen speaker where the browser supports it.
  const canChooseSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  useEffect(() => {
    const el = audio.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el?.setSinkId || !speakerId) return;
    void el.setSinkId(speakerId).catch(() => undefined);
  }, [speakerId, call]);

  const addHistory = useCallback((entry: CallLogEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 50);
      saveHistory(next);
      return next;
    });
  }, []);

  const attachSession = useCallback(
    (s: RTCSession, originator: 'local' | 'remote') => {
      if (originator === 'remote' && session.current) {
        s.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
        return;
      }
      session.current = s;
      const id = crypto.randomUUID();
      const incoming = originator === 'remote';
      const number = s.remote_identity?.uri?.user ?? '';
      const name = s.remote_identity?.display_name ?? '';
      let answeredAt: number | null = null;
      setCall({ id, direction: incoming ? 'incoming' : 'outgoing', number, name, state: incoming ? 'ringing' : 'dialing', answeredAt: null, muted: false, held: false });

      if (incoming) {
        tones.current.startRingtone();
        setPanelOpen(true);
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification('Incoming call', { body: name ? `${name} (${number})` : number, tag: 'envo-call' });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        }
      }

      const attachAudio = (pc: RTCPeerConnection) => {
        pcRef.current = pc;
        pc.addEventListener('track', (ev) => {
          const el = audio.current;
          if (el && ev.streams[0]) {
            el.srcObject = ev.streams[0];
            void el.play().catch(() => undefined);
          }
        });
      };
      s.on('peerconnection', (e) => attachAudio(e.peerconnection));
      if (s.connection) attachAudio(s.connection);

      // JsSIP waits for ICE gathering to finish; stop early once a public candidate is known.
      let iceTimer: number | undefined;
      s.on('icecandidate', (e) => {
        const type = (e.candidate as RTCIceCandidate).type;
        if (type === 'srflx' || type === 'relay') {
          window.clearTimeout(iceTimer);
          e.ready();
          return;
        }
        window.clearTimeout(iceTimer);
        iceTimer = window.setTimeout(() => e.ready(), 1200);
      });

      s.on('progress', (e: unknown) => {
        if (incoming) return;
        setCall((c) => (c && c.id === id ? { ...c, state: 'progress' } : c));
        const code = (e as { response?: { status_code?: number } }).response?.status_code;
        if (code === 180) tones.current.startRingback();
        else tones.current.stop();
      });
      const onAnswered = () => {
        tones.current.stop();
        if (answeredAt === null) answeredAt = Date.now();
        setCall((c) => (c && c.id === id ? { ...c, state: 'active', answeredAt } : c));
      };
      s.on('accepted', onAnswered);
      s.on('confirmed', onAnswered);
      s.on('hold', (e) => e.originator === 'local' && setCall((c) => (c && c.id === id ? { ...c, held: true } : c)));
      s.on('unhold', (e) => e.originator === 'local' && setCall((c) => (c && c.id === id ? { ...c, held: false } : c)));
      s.on('muted', () => setCall((c) => (c && c.id === id ? { ...c, muted: true } : c)));
      s.on('unmuted', () => setCall((c) => (c && c.id === id ? { ...c, muted: false } : c)));

      const finish = (cause: string, failed: boolean) => {
        window.clearTimeout(iceTimer);
        if (session.current === s) session.current = null;
        if (pcRef.current === s.connection) pcRef.current = null;
        const wasAnswered = answeredAt !== null;
        wasAnswered ? tones.current.hangup() : tones.current.stop();
        const status: CallLogEntry['status'] = wasAnswered
          ? 'answered'
          : incoming
            ? cause === 'Rejected' ? 'rejected' : 'missed'
            : cause === 'Canceled' ? 'cancelled' : 'failed';
        addHistory({ id, direction: incoming ? 'incoming' : 'outgoing', number, name, at: Date.now(), duration: wasAnswered ? Math.round((Date.now() - answeredAt!) / 1000) : 0, status });
        if (failed && !incoming && cause !== 'Canceled') toast.error(`Call failed: ${friendlyCause(cause)}`);
        setCall((c) => (c && c.id === id ? { ...c, state: 'ended', endReason: friendlyCause(cause) } : c));
        window.setTimeout(() => setCall((c) => (c && c.id === id ? null : c)), 1600);
        if (audio.current) audio.current.srcObject = null;
      };
      s.on('ended', (e) => finish(e.cause, false));
      s.on('failed', (e) => finish(e.cause, true));
    },
    [addHistory],
  );

  useEffect(() => {
    if (!config?.enabled) {
      setReg('off');
      return;
    }
    debug.disable();
    const socket = new WebSocketInterface(config.wsUrl);
    const agent = new UA({
      sockets: [socket],
      uri: `sip:${config.username}@${config.domain}`,
      password: config.password,
      display_name: config.displayName,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'Envo WebPhone',
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
    });
    agent.on('connecting', () => setReg((r) => (r === 'registered' ? r : 'connecting')));
    agent.on('disconnected', () => setReg('connecting'));
    agent.on('registered', () => {
      setReg('registered');
      setRegError('');
    });
    agent.on('unregistered', () => setReg('unregistered'));
    agent.on('registrationFailed', (e) => {
      setReg('failed');
      setRegError(friendlyCause(e.cause ?? 'Registration failed'));
    });
    agent.on('newRTCSession', (e: RTCSessionEvent) => attachSession(e.session, e.originator as 'local' | 'remote'));
    agent.start();
    ua.current = agent;
    setReg('connecting');
    return () => {
      session.current?.terminate();
      agent.stop();
      ua.current = null;
      tones.current.stop();
    };
  }, [config, attachSession]);

  // Media health while a call is up: RTP loss/jitter/RTT from getStats, plus a live mic meter.
  const active = call?.state === 'active';
  useEffect(() => {
    if (!active) {
      setQuality(null);
      return;
    }
    let cancelled = false;
    let prev: { lost: number; received: number } | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let buffer: Float32Array<ArrayBuffer> | null = null;
    let level = 0;

    const setupMeter = () => {
      const track = pcRef.current?.getSenders().find((sn) => sn.track?.kind === 'audio')?.track;
      if (!track || ctx) return;
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        const src = ctx.createMediaStreamSource(new MediaStream([track]));
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        buffer = new Float32Array(analyser.fftSize);
        src.connect(analyser);
      } catch {
        ctx = null;
      }
    };

    const sampleMic = () => {
      if (!analyser || !buffer) return;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const v of buffer) sum += v * v;
      const rms = Math.sqrt(sum / buffer.length);
      // Smooth and scale so normal speech lands around 0.5-0.8.
      level = Math.max(level * 0.6, Math.min(1, rms * 6));
    };

    const tick = async () => {
      const pc = pcRef.current;
      if (!pc || cancelled) return;
      setupMeter();
      sampleMic();
      let lossPct = 0;
      let jitterMs = 0;
      let rttMs = 0;
      let codec = '';
      try {
        const report = await pc.getStats();
        const codecs = new Map<string, string>();
        report.forEach((st) => {
          if (st.type === 'codec') codecs.set(st.id as string, String((st as { mimeType?: string }).mimeType ?? '').replace('audio/', ''));
        });
        report.forEach((st) => {
          if (st.type === 'inbound-rtp' && (st as { kind?: string }).kind !== 'video') {
            const s2 = st as { packetsLost?: number; packetsReceived?: number; jitter?: number; codecId?: string };
            const lost = s2.packetsLost ?? 0;
            const received = s2.packetsReceived ?? 0;
            if (prev) {
              const dLost = Math.max(0, lost - prev.lost);
              const dRecv = Math.max(0, received - prev.received);
              lossPct = dLost + dRecv > 0 ? (dLost / (dLost + dRecv)) * 100 : 0;
            }
            prev = { lost, received };
            jitterMs = Math.round((s2.jitter ?? 0) * 1000);
            if (s2.codecId) codec = codecs.get(s2.codecId) ?? '';
          }
          if (st.type === 'remote-inbound-rtp') {
            const rtt = (st as { roundTripTime?: number }).roundTripTime;
            if (rtt) rttMs = Math.round(rtt * 1000);
          }
          if (st.type === 'candidate-pair' && (st as { state?: string }).state === 'succeeded') {
            const rtt = (st as { currentRoundTripTime?: number }).currentRoundTripTime;
            if (rtt && !rttMs) rttMs = Math.round(rtt * 1000);
          }
        });
      } catch {
        /* stats unavailable */
      }
      if (cancelled) return;
      setQuality({ score: prev ? qualityScore(lossPct, jitterMs, rttMs) : 0, lossPct: Math.round(lossPct * 10) / 10, jitterMs, rttMs, codec, micLevel: level });
    };

    void tick();
    const statsTimer = window.setInterval(() => void tick(), 2000);
    const meterTimer = window.setInterval(() => {
      sampleMic();
      setQuality((q) => (q ? { ...q, micLevel: level } : q));
    }, 120);
    return () => {
      cancelled = true;
      window.clearInterval(statsTimer);
      window.clearInterval(meterTimer);
      void ctx?.close().catch(() => undefined);
    };
  }, [active]);

  const testSpeaker = useCallback(() => {
    const el = audio.current;
    if (!el || session.current) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const dest = ctx.createMediaStreamDestination();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.55);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      gain.connect(dest);
      for (const f of [523.25, 659.25]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }
      el.srcObject = dest.stream;
      void el.play().catch(() => undefined);
      window.setTimeout(() => {
        if (!session.current && el.srcObject === dest.stream) el.srcObject = null;
        void ctx.close().catch(() => undefined);
      }, 900);
    } catch {
      toast.error('Could not play a test tone');
    }
  }, []);

  const dial = useCallback(
    (target: string) => {
      const clean = target.replace(/[^\d+*#]/g, '');
      if (!clean) return;
      if (!ua.current || !config?.enabled) {
        toast.error(config?.reason ?? 'The web phone is not available');
        return;
      }
      if (reg !== 'registered') {
        toast.error('The web phone is not connected yet');
        return;
      }
      if (session.current) {
        toast.error('Finish the current call first');
        return;
      }
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
      setPanelOpen(true);
      ua.current.call(`sip:${clean}@${config.domain}`, {
        mediaConstraints,
        pcConfig,
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });
      // Device labels are only exposed once microphone permission has been granted.
      void refreshDevices();
    },
    [config, reg, pcConfig, mediaConstraints, refreshDevices],
  );

  const answer = useCallback(() => {
    const s = session.current;
    if (!s) return;
    tones.current.stop();
    s.answer({ mediaConstraints, pcConfig });
    void refreshDevices();
  }, [pcConfig, mediaConstraints, refreshDevices]);

  const hangup = useCallback(() => {
    const s = session.current;
    if (!s) return;
    try {
      if (s.isInProgress() && s.direction === 'incoming') s.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      else s.terminate();
    } catch {
      session.current = null;
      setCall(null);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.isMuted().audio) s.unmute({ audio: true });
    else s.mute({ audio: true });
  }, []);

  const toggleHold = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.isOnHold().local) s.unhold();
    else s.hold();
  }, []);

  const dtmf = useCallback((digit: string) => {
    tones.current.dtmf(digit);
    const s = session.current;
    if (s && s.isEstablished()) s.sendDTMF(digit, { transportType: 'RFC2833' as never, duration: 120, interToneGap: 70 });
  }, []);

  const transfer = useCallback(
    (target: string) => {
      const s = session.current;
      const clean = target.replace(/[^\d+*#]/g, '');
      if (!s || !clean || !config) return;
      s.refer(`sip:${clean}@${config.domain}`, {
        eventHandlers: {
          accepted: () => toast.success(`Transferred to ${clean}`),
          failed: () => toast.error('Transfer failed'),
        },
      });
    },
    [config],
  );

  const value: PhoneApi = {
    config,
    reg,
    regError,
    call,
    quality,
    history,
    panelOpen,
    setPanelOpen,
    dial,
    answer,
    hangup,
    toggleMute,
    toggleHold,
    dtmf,
    transfer,
    clearHistory: () => {
      setHistory([]);
      saveHistory([]);
    },
    devices,
    micId,
    speakerId,
    setMicId: (id) => {
      setMicIdState(id);
      store(MIC_KEY, id);
    },
    setSpeakerId: (id) => {
      setSpeakerIdState(id);
      store(SPEAKER_KEY, id);
    },
    refreshDevices,
    canChooseSpeaker,
    testSpeaker,
  };

  return (
    <PhoneContext.Provider value={value}>
      {children}
      <audio ref={audio} autoPlay playsInline className="hidden" />
    </PhoneContext.Provider>
  );
}

export function usePhone(): PhoneApi {
  const ctx = useContext(PhoneContext);
  if (!ctx) throw new Error('usePhone outside PhoneProvider');
  return ctx;
}
