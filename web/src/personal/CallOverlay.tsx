import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play } from 'lucide-react';
import { usePhone } from '../phone/PhoneProvider';
import { formatDuration } from '../lib/format';
import { formatNumber } from './api';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** The call in progress and calls coming in: full screen, like the phone app. */
export function CallOverlay() {
  const phone = usePhone();
  const call = phone.call;
  const [pad, setPad] = useState(false);
  const [typed, setTyped] = useState('');
  const now = useNow(call?.state === 'active');
  useEffect(() => {
    if (!call) {
      setPad(false);
      setTyped('');
    }
  }, [call]);
  if (!call) return null;

  const incoming = call.state === 'ringing' && call.direction === 'incoming';
  const label = call.name && call.name !== call.number ? call.name : formatNumber(call.number) || 'Unknown';
  const status =
    call.state === 'ended'
      ? (call.endReason ?? 'Call ended')
      : incoming
        ? 'Incoming call'
        : call.state === 'active'
          ? `${call.held ? 'On hold · ' : ''}${formatDuration((now - (call.answeredAt ?? now)) / 1000)}`
          : call.state === 'progress'
            ? 'Ringing…'
            : 'Calling…';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#14306f] via-ink-950 to-ink-950 text-white" role="dialog" aria-label={incoming ? 'Incoming call' : 'Call'}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-6 pt-[12vh] pb-10">
        <p className="text-[13px] font-medium tracking-wide text-white/55 uppercase">{incoming ? 'Envo Phone' : status}</p>
        <h2 className="mt-3 text-center text-[34px] leading-tight font-semibold tracking-tight">{label}</h2>
        {label !== formatNumber(call.number) && <p className="mt-1 text-[15px] text-white/60 tabular-nums">{formatNumber(call.number)}</p>}
        {incoming && <p className="mt-2 text-[15px] text-white/70">{status}</p>}

        <div className="flex flex-1 items-center justify-center py-8">
          {pad ? (
            <div className="w-full max-w-[280px]">
              <p className="mb-4 h-8 text-center text-[24px] font-medium tracking-[0.2em] tabular-nums">{typed}</p>
              <div className="grid grid-cols-3 gap-3">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      phone.dtmf(k);
                      setTyped((t) => (t + k).slice(-16));
                    }}
                    className="h-16 rounded-full bg-white/[0.08] text-[26px] font-medium transition hover:bg-white/[0.14] active:bg-white/25"
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className={clsx('relative flex size-32 items-center justify-center rounded-full bg-white/[0.08] text-[44px] font-semibold', incoming && 'ring-pulse')}>
              {(label.match(/[A-Za-z]/) ? label.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('') : '') || <Phone className="size-12 text-white/70" />}
            </span>
          )}
        </div>

        {incoming ? (
          <div className="grid w-full grid-cols-2 gap-10 px-6">
            <RoundButton label="Decline" tone="red" onClick={phone.hangup} icon={<PhoneOff className="size-7" />} />
            <RoundButton label="Answer" tone="green" onClick={phone.answer} icon={<Phone className="size-7" />} />
          </div>
        ) : (
          <>
            <div className="grid w-full grid-cols-3 gap-4">
              <Control on={call.muted} onClick={phone.toggleMute} label={call.muted ? 'Unmute' : 'Mute'} icon={call.muted ? <MicOff className="size-6" /> : <Mic className="size-6" />} />
              <Control on={pad} onClick={() => setPad(!pad)} label="Keypad" icon={<Grid3x3 className="size-6" />} disabled={call.state !== 'active'} />
              <Control on={call.held} onClick={phone.toggleHold} label={call.held ? 'Resume' : 'Hold'} icon={call.held ? <Play className="size-6" /> : <Pause className="size-6" />} disabled={call.state !== 'active'} />
            </div>
            <div className="mt-8">
              <RoundButton label="End call" tone="red" onClick={phone.hangup} icon={<PhoneOff className="size-7" />} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Control({ on, onClick, label, icon, disabled }: { on: boolean; onClick: () => void; label: string; icon: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-2 disabled:opacity-35" aria-pressed={on}>
      <span className={clsx('flex size-16 items-center justify-center rounded-full transition', on ? 'bg-white text-ink-950' : 'bg-white/[0.1] hover:bg-white/[0.16]')}>{icon}</span>
      <span className="text-[12.5px] text-white/75">{label}</span>
    </button>
  );
}

function RoundButton({ label, tone, onClick, icon }: { label: string; tone: 'red' | 'green'; onClick: () => void; icon: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-2" aria-label={label}>
      <span className={clsx('flex size-[72px] items-center justify-center rounded-full shadow-lg transition active:scale-95', tone === 'red' ? 'bg-rose-500 hover:bg-rose-400' : 'bg-emerald-500 hover:bg-emerald-400')}>
        {icon}
      </span>
      <span className="text-[12.5px] text-white/75">{label}</span>
    </button>
  );
}
