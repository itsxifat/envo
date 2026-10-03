import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ChevronDown,
  Delete,
  Grid3x3,
  Headphones,
  History,
  Maximize2,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Search,
  Settings2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { api, scoped } from '../lib/api';
import type { Extension } from '../lib/types';
import { formatDateTime, formatDuration } from '../lib/format';
import { useExtStates } from '../state/live';
import { usePhone, type CallQuality, type RegState } from './PhoneProvider';

const KEYS: [string, string][] = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

const REG_LABEL: Record<RegState, string> = {
  off: 'Unavailable',
  connecting: 'Connecting…',
  registered: 'Online',
  unregistered: 'Offline',
  failed: 'Registration failed',
};

const QUALITY_LABEL = ['Measuring…', 'Poor', 'Fair', 'Good', 'Excellent'] as const;

function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

function Keypad({ onKey, compact }: { onKey: (k: string) => void; compact?: boolean }) {
  return (
    <div className={clsx('grid grid-cols-3', compact ? 'gap-2' : 'gap-2.5')}>
      {KEYS.map(([k, sub]) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className={clsx(
            'flex flex-col items-center justify-center rounded-2xl bg-white/[0.06] text-white transition hover:bg-white/[0.12] active:scale-95',
            compact ? 'h-11' : 'h-13',
          )}
        >
          <span className="text-xl leading-none font-medium">{k}</span>
          <span className="mt-0.5 h-3 text-[9px] tracking-[0.18em] text-slate-400">{sub}</span>
        </button>
      ))}
    </div>
  );
}

function RoundButton({
  onClick,
  label,
  active,
  children,
  tone = 'default',
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
  tone?: 'default' | 'green' | 'red';
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={clsx(
          'flex items-center justify-center rounded-full transition active:scale-95',
          tone === 'default' && 'size-13 text-white',
          tone === 'default' && (active ? 'bg-white text-ink-950' : 'bg-white/[0.08] hover:bg-white/[0.15]'),
          tone === 'green' && 'size-15 bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400',
          tone === 'red' && 'size-15 bg-rose-500 text-white shadow-lg shadow-rose-500/30 hover:bg-rose-400',
        )}
      >
        {children}
      </button>
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  );
}

/** Four bars that fill according to measured loss, jitter and round-trip time. */
function QualityMeter({ quality }: { quality: CallQuality }) {
  const detail =
    quality.score === 0
      ? 'Waiting for audio statistics'
      : `${quality.lossPct}% packet loss · ${quality.jitterMs} ms jitter${quality.rttMs ? ` · ${quality.rttMs} ms round trip` : ''}${quality.codec ? ` · ${quality.codec}` : ''}`;
  const color = quality.score >= 3 ? 'bg-emerald-400' : quality.score === 2 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-2" title={detail}>
      <span className="flex h-3.5 items-end gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={clsx('w-[3px] rounded-full transition-colors', i <= quality.score ? color : 'bg-white/15')}
            style={{ height: `${40 + i * 20}%` }}
          />
        ))}
      </span>
      <span className="truncate text-[11px] text-slate-400">
        {QUALITY_LABEL[quality.score]}
        {quality.score > 0 && quality.lossPct > 0 && ` · ${quality.lossPct}% loss`}
      </span>
    </div>
  );
}

function MicMeter({ level, muted }: { level: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {muted ? <MicOff className="size-3.5 shrink-0 text-rose-400" /> : <Mic className="size-3.5 shrink-0 text-slate-400" />}
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={clsx('h-full rounded-full transition-[width] duration-100', muted ? 'bg-rose-400/60' : 'bg-brand-400')}
          style={{ width: `${muted ? 0 : Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}

function DeviceSettings({ onClose }: { onClose: () => void }) {
  const phone = usePhone();
  const { devices, micId, speakerId, setMicId, setSpeakerId, canChooseSpeaker, testSpeaker, quality, call } = phone;
  const selectClass =
    'w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white focus:border-brand-400 focus:outline-none [&>option]:bg-ink-950';
  return (
    <div className="px-5 pb-5">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            <Mic className="size-3.5" /> Microphone
          </label>
          <select className={selectClass} value={micId} onChange={(e) => setMicId(e.target.value)}>
            <option value="">System default</option>
            {devices.inputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          {!devices.inputs.some((d) => d.label) && <p className="mt-1.5 text-[11px] text-slate-500">Device names appear after your first call allows microphone access.</p>}
          {call?.state === 'active' && quality && <div className="mt-2.5">
            <MicMeter level={quality.micLevel} muted={call.muted} />
            <p className="mt-1 text-[11px] text-slate-500">Speak — the bar should move.</p>
          </div>}
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            <Headphones className="size-3.5" /> Speaker
          </label>
          {canChooseSpeaker ? (
            <select className={selectClass} value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
              <option value="">System default</option>
              {devices.outputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Speaker ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[12px] text-slate-500">This browser always uses the system default output.</p>
          )}
          <button
            type="button"
            onClick={testSpeaker}
            disabled={!!call}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-2.5 py-1.5 text-[12px] text-white transition hover:bg-white/[0.14] disabled:opacity-40"
          >
            <Volume2 className="size-3.5" /> Play a test tone
          </button>
        </div>

        {quality && call?.state === 'active' && (
          <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Call quality</div>
            <div className="mt-2">
              <QualityMeter quality={quality} />
            </div>
            <dl className="mt-2.5 grid grid-cols-3 gap-2 text-center">
              {[
                ['Loss', `${quality.lossPct}%`],
                ['Jitter', `${quality.jitterMs} ms`],
                ['Round trip', quality.rttMs ? `${quality.rttMs} ms` : '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dd className="text-sm font-semibold tabular-nums text-white">{v}</dd>
                  <dt className="text-[10px] text-slate-500">{k}</dt>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-white/[0.08] py-2 text-sm text-white transition hover:bg-white/[0.14]">
        Done
      </button>
    </div>
  );
}

export function Softphone() {
  const phone = usePhone();
  const { config, reg, call, quality, panelOpen, setPanelOpen } = phone;
  const [tab, setTab] = useState<'keypad' | 'recent' | 'contacts'>('keypad');
  const [number, setNumber] = useState('');
  const [inCallPad, setInCallPad] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const now = useTicker(!!call && call.state === 'active');

  useEffect(() => {
    if (!call) {
      setInCallPad(false);
      setTransferOpen(false);
      setTransferTo('');
      setMinimized(false);
    }
  }, [call]);

  if (!config) return null;

  const dot = reg === 'registered' ? 'bg-emerald-400' : reg === 'connecting' ? 'bg-amber-400' : reg === 'off' ? 'bg-slate-500' : 'bg-rose-500';
  const ringing = call?.state === 'ringing';
  const elapsed = call?.state === 'active' ? formatDuration(((now || Date.now()) - (call.answeredAt ?? Date.now())) / 1000) : '';

  // Compact bar so an in-progress call never blocks the page behind it.
  if (call && minimized && !ringing) {
    return (
      <div className="animate-slide-up fixed z-40 flex items-center gap-3 rounded-2xl bg-ink-950 py-2.5 pr-2.5 pl-4 text-white shadow-2xl ring-1 ring-white/10 max-lg:inset-x-3 max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:right-5 lg:bottom-5">
        <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-semibold">
          {(call.name || call.number || '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="max-w-[9rem] truncate text-[13px] font-medium max-lg:max-w-none max-lg:flex-1">{call.name || call.number || 'Unknown'}</div>
          <div className="text-[11px] tabular-nums text-brand-300">{call.state === 'active' ? `${call.held ? 'On hold · ' : ''}${elapsed}` : 'Connecting…'}</div>
        </div>
        <button
          type="button"
          onClick={phone.toggleMute}
          aria-label={call.muted ? 'Unmute' : 'Mute'}
          className={clsx('flex size-9 items-center justify-center rounded-full transition', call.muted ? 'bg-white text-ink-950' : 'bg-white/[0.08] hover:bg-white/[0.16]')}
        >
          {call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        <button type="button" onClick={phone.hangup} aria-label="End call" className="flex size-9 items-center justify-center rounded-full bg-rose-500 transition hover:bg-rose-400">
          <PhoneOff className="size-4" />
        </button>
        <button type="button" onClick={() => setMinimized(false)} aria-label="Expand phone" className="flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white">
          <Maximize2 className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed z-40 flex flex-col gap-3 max-lg:inset-x-3 max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:right-5 lg:bottom-5 lg:items-end">
      {panelOpen && (
        <div className="animate-slide-up w-full overflow-hidden overflow-y-auto rounded-3xl bg-ink-950 text-white shadow-2xl ring-1 ring-white/10 max-lg:max-h-[calc(100dvh-9rem)] lg:w-[21rem]">
          <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className={clsx('size-2 rounded-full', dot)} />
                {config.enabled ? `Ext ${config.extension}` : 'Web phone'}
              </div>
              <div className="truncate text-xs text-slate-400">{config.enabled ? `${config.displayName} · ${REG_LABEL[reg]}` : config.reason}</div>
              {reg === 'failed' && phone.regError && <div className="text-xs text-rose-400">{phone.regError}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                className={clsx('rounded-full p-1.5 transition hover:bg-white/10 hover:text-white', settingsOpen ? 'bg-white/10 text-white' : 'text-slate-400')}
                aria-label="Audio settings"
                aria-pressed={settingsOpen}
              >
                <Settings2 className="size-4" />
              </button>
              {call && !ringing && (
                <button type="button" onClick={() => setMinimized(true)} className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Minimize phone">
                  <ChevronDown className="size-4" />
                </button>
              )}
              {!call && (
                <button type="button" onClick={() => setPanelOpen(false)} className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Close phone">
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>

          {settingsOpen ? (
            <DeviceSettings onClose={() => setSettingsOpen(false)} />
          ) : call ? (
            <div className="px-5 pt-4 pb-6">
              <div className="flex flex-col items-center text-center">
                <div
                  className={clsx(
                    'mb-3 flex size-18 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-2xl font-semibold',
                    ringing && 'ring-pulse',
                  )}
                >
                  {(call.name || call.number || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="max-w-full truncate text-lg font-semibold">{call.name || call.number || 'Unknown'}</div>
                {call.name && <div className="text-sm text-slate-400">{call.number}</div>}
                <div className="mt-1.5 text-sm text-brand-300 tabular-nums">
                  {call.state === 'ringing' && 'Incoming call…'}
                  {call.state === 'dialing' && 'Calling…'}
                  {call.state === 'progress' && 'Ringing…'}
                  {call.state === 'active' && `${call.held ? 'On hold · ' : ''}${elapsed}`}
                  {call.state === 'ended' && (call.endReason || 'Call ended')}
                </div>
              </div>

              {call.state === 'active' && quality && (
                <div className="mt-4 space-y-2 rounded-xl bg-white/[0.04] px-3 py-2.5">
                  <QualityMeter quality={quality} />
                  <MicMeter level={quality.micLevel} muted={call.muted} />
                </div>
              )}

              {ringing ? (
                <div className="mt-8 flex justify-center gap-14">
                  <RoundButton tone="red" label="Decline" onClick={phone.hangup}>
                    <PhoneOff className="size-6" />
                  </RoundButton>
                  <RoundButton tone="green" label="Answer" onClick={phone.answer}>
                    <Phone className="size-6" />
                  </RoundButton>
                </div>
              ) : call.state === 'ended' ? null : (
                <>
                  {inCallPad ? (
                    <div className="mt-5">
                      <Keypad onKey={phone.dtmf} compact />
                    </div>
                  ) : transferOpen ? (
                    <form
                      className="mt-6 space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        phone.transfer(transferTo);
                        setTransferOpen(false);
                      }}
                    >
                      <input
                        autoFocus
                        value={transferTo}
                        onChange={(e) => setTransferTo(e.target.value)}
                        placeholder="Transfer to extension or number"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 rounded-xl bg-white/[0.08] py-2 text-sm hover:bg-white/[0.14]" onClick={() => setTransferOpen(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="flex-1 rounded-xl bg-brand-500 py-2 text-sm font-medium hover:bg-brand-400 disabled:opacity-40" disabled={!transferTo}>
                          Transfer
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-6 grid grid-cols-4 gap-2">
                      <RoundButton label={call.muted ? 'Unmute' : 'Mute'} active={call.muted} onClick={phone.toggleMute}>
                        {call.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
                      </RoundButton>
                      <RoundButton label={call.held ? 'Resume' : 'Hold'} active={call.held} onClick={phone.toggleHold}>
                        {call.held ? <Play className="size-5" /> : <Pause className="size-5" />}
                      </RoundButton>
                      <RoundButton label="Keypad" onClick={() => setInCallPad(true)}>
                        <Grid3x3 className="size-5" />
                      </RoundButton>
                      <RoundButton label="Transfer" onClick={() => setTransferOpen(true)}>
                        <ArrowRightLeft className="size-5" />
                      </RoundButton>
                    </div>
                  )}
                  <div className="mt-6 flex items-center justify-center gap-8">
                    {inCallPad && (
                      <button type="button" className="text-sm text-slate-400 transition hover:text-white" onClick={() => setInCallPad(false)}>
                        Hide keypad
                      </button>
                    )}
                    <RoundButton tone="red" label="End" onClick={phone.hangup}>
                      <PhoneOff className="size-6" />
                    </RoundButton>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="mx-5 mt-2 mb-3 grid grid-cols-3 rounded-xl bg-white/[0.06] p-1 text-xs">
                {(
                  [
                    ['keypad', 'Keypad', Grid3x3],
                    ['recent', 'Recent', History],
                    ['contacts', 'Contacts', Users],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    aria-selected={tab === key}
                    className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition', tab === key ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white')}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'keypad' && (
                <form
                  className="px-5 pb-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    phone.dial(number);
                  }}
                >
                  <div className="mb-4 flex h-12 items-center gap-2">
                    <input
                      value={number}
                      onChange={(e) => setNumber(e.target.value.replace(/[^\d+*#]/g, ''))}
                      placeholder="Enter number"
                      aria-label="Number to call"
                      className="min-w-0 flex-1 bg-transparent text-center text-2xl font-light tracking-wide text-white placeholder:text-base placeholder:text-slate-500 focus:outline-none"
                      autoFocus
                    />
                    {number && (
                      <button type="button" className="rounded-full p-2 text-slate-400 transition hover:text-white" onClick={() => setNumber(number.slice(0, -1))} aria-label="Delete last digit">
                        <Delete className="size-5" />
                      </button>
                    )}
                  </div>
                  <Keypad onKey={(k) => setNumber((n) => n + k)} />
                  <div className="mt-5 flex justify-center">
                    <button
                      type="submit"
                      disabled={!number || reg !== 'registered'}
                      className="flex size-15 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-40"
                      aria-label="Call"
                    >
                      <Phone className="size-6" />
                    </button>
                  </div>
                  <p className="mt-4 text-center text-[11px] text-slate-500">
                    <button type="button" className="font-mono transition hover:text-slate-300" onClick={() => phone.dial('*43')}>
                      *43
                    </button>{' '}
                    echo test ·{' '}
                    <button type="button" className="font-mono transition hover:text-slate-300" onClick={() => phone.dial('*97')}>
                      *97
                    </button>{' '}
                    voicemail
                  </p>
                </form>
              )}

              {tab === 'recent' && (
                <Recent
                  onDial={(n) => {
                    setNumber(n);
                    phone.dial(n);
                  }}
                />
              )}
              {tab === 'contacts' && <Contacts tenantId={config.tenantId} self={config.extension} onDial={phone.dial} />}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        className={clsx(
          'relative hidden size-14 items-center justify-center rounded-full text-white shadow-xl transition hover:scale-105 active:scale-95 lg:flex',
          ringing ? 'ring-pulse bg-emerald-500' : call ? 'bg-rose-500' : 'bg-gradient-to-br from-brand-500 to-brand-700 shadow-[0_10px_24px_-8px_rgb(31_87_235/0.7)]',
        )}
        aria-label={panelOpen ? 'Hide web phone' : 'Show web phone'}
        aria-expanded={panelOpen}
      >
        {ringing ? <PhoneIncoming className="size-6 animate-bounce" /> : <Phone className="size-6" />}
        <span className={clsx('absolute top-1 right-1 size-3 rounded-full ring-2 ring-white', dot)} />
      </button>
    </div>
  );
}

function Recent({ onDial }: { onDial: (n: string) => void }) {
  const { history, clearHistory } = usePhone();
  if (!history.length)
    return (
      <div className="px-5 pt-4 pb-10 text-center">
        <History className="mx-auto mb-2 size-7 text-slate-600" />
        <p className="text-sm text-slate-400">No calls yet</p>
        <p className="mt-1 text-[11px] text-slate-500">Calls you make or take in this browser show up here.</p>
      </div>
    );
  return (
    <div className="pb-3">
      <div className="dark-scroll max-h-[360px] overflow-y-auto px-2">
        {history.map((h) => {
          const Icon = h.direction === 'incoming' ? (h.status === 'missed' || h.status === 'rejected' ? PhoneMissed : PhoneIncoming) : PhoneOutgoing;
          return (
            <button key={h.id} type="button" onClick={() => onDial(h.number)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06]">
              <Icon className={clsx('size-4 shrink-0', h.status === 'missed' || h.status === 'rejected' ? 'text-rose-400' : 'text-slate-400')} />
              <div className="min-w-0 flex-1">
                <div className={clsx('truncate text-sm', h.status === 'missed' ? 'text-rose-300' : 'text-white')}>{h.name || h.number}</div>
                <div className="text-[11px] text-slate-500">
                  {formatDateTime(h.at)} {h.duration > 0 && `· ${formatDuration(h.duration)}`}
                </div>
              </div>
              <Phone className="size-4 text-slate-500" />
            </button>
          );
        })}
      </div>
      <button type="button" onClick={clearHistory} className="mx-auto mt-2 block text-xs text-slate-500 transition hover:text-slate-300">
        Clear history
      </button>
    </div>
  );
}

const STATE_DOT: Record<string, string> = {
  idle: 'bg-emerald-400',
  inuse: 'bg-rose-400',
  busy: 'bg-rose-400',
  ringing: 'bg-amber-400 animate-pulse',
  onhold: 'bg-violet-400',
  unavailable: 'bg-slate-600',
};

function Contacts({ tenantId, self, onDial }: { tenantId: number; self: string; onDial: (n: string) => void }) {
  const [q, setQ] = useState('');
  const { data = [] } = useQuery({
    queryKey: ['list', 'extensions', tenantId],
    queryFn: () => api.get<Extension[]>(scoped('/api/extensions', tenantId)),
  });
  const states = useExtStates(tenantId);
  const list = useMemo(
    () => data.filter((e) => e.number !== self && (!q || `${e.number} ${e.name}`.toLowerCase().includes(q.toLowerCase()))),
    [data, q, self],
  );
  return (
    <div className="pb-3">
      <div className="relative mx-5 mb-2">
        <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search extensions"
          aria-label="Search extensions"
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pr-3 pl-8 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
        />
      </div>
      <div className="dark-scroll max-h-[340px] overflow-y-auto px-2">
        {list.map((e) => {
          const st = states.get(e.number) ?? 'unavailable';
          return (
            <button key={e.id} type="button" onClick={() => onDial(e.number)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06]">
              <div className="relative">
                <div className="flex size-8 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold">{e.name.slice(0, 1).toUpperCase()}</div>
                <span className={clsx('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-ink-950', STATE_DOT[st] ?? 'bg-slate-600')} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{e.name}</div>
                <div className="text-[11px] text-slate-500">{e.number}</div>
              </div>
              <Phone className="size-4 text-slate-500" />
            </button>
          );
        })}
        {!list.length && <p className="py-6 text-center text-sm text-slate-500">No extensions{q && ' match that search'}</p>}
      </div>
    </div>
  );
}
