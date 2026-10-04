import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * The hero of the website: what Envo does, as a call you can steer. A customer rings the company's
 * 09-number, the menu answers, the visitor presses 1 or 2, the right team rings and someone answers.
 * Example data only; it says so.
 */

type Branch = 'sales' | 'support';
type Phase = 'dialing' | 'menu' | 'ringing' | 'answered' | 'ended';

const BRANCH: Record<Branch, { team: string; detail: string; who: string; how: string }> = {
  sales: { team: 'Sales', detail: 'Rings 3 phones at once', who: 'Nadia', how: 'answered in the browser' },
  support: { team: 'Support', detail: 'Queue · you are number 1', who: 'Rafi', how: 'answered on a desk phone' },
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function CallDemo() {
  const [phase, setPhase] = useState<Phase>('dialing');
  const [branch, setBranch] = useState<Branch | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const reduced = useReducedMotion();
  const timer = useRef<number | undefined>(undefined);

  const after = (ms: number, fn: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };

  useEffect(() => {
    if (phase === 'dialing') after(1600, () => setPhase('menu'));
    // Nobody pressed anything: the demo picks sales so it keeps telling its story.
    if (phase === 'menu') after(4200, () => choose('1'));
    if (phase === 'ringing') after(2200, () => setPhase('answered'));
    if (phase === 'ended')
      after(2600, () => {
        setBranch(null);
        setPressed(null);
        setSeconds(0);
        setPhase('dialing');
      });
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== 'answered') return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    const end = window.setTimeout(() => setPhase('ended'), 6500);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(end);
    };
  }, [phase]);

  function choose(key: string) {
    if (phase !== 'menu' || (key !== '1' && key !== '2')) {
      setPressed(key);
      window.setTimeout(() => setPressed((p) => (p === key ? null : p)), 220);
      return;
    }
    setPressed(key);
    setBranch(key === '1' ? 'sales' : 'support');
    setPhase('ringing');
  }

  const order: Phase[] = ['dialing', 'menu', 'ringing', 'answered', 'ended'];
  const at = order.indexOf(phase);
  const b = branch ? BRANCH[branch] : null;
  const steps = [
    { label: 'Incoming', title: '+880 1811 234 567', note: 'A customer calls your number', done: at >= 1, live: phase === 'dialing' },
    { label: 'Your number', title: '09612 345 678', note: 'The IP number you already have', done: at >= 1, live: false },
    {
      label: 'Menu',
      title: '“Press 1 for sales, 2 for support”',
      note: phase === 'menu' ? 'Try it: press 1 or 2 on the keypad' : b ? `Caller pressed ${branch === 'sales' ? '1' : '2'}` : 'Plays your greeting',
      done: at >= 2,
      live: phase === 'menu',
    },
    { label: 'Team', title: b?.team ?? 'Sales or Support', note: b?.detail ?? 'Ring groups and queues', done: at >= 3, live: phase === 'ringing' },
    {
      label: phase === 'ended' ? 'Call ended' : 'Answered',
      title: b && at >= 3 ? `${b.who} · ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}` : '—',
      note: b && at >= 3 ? b.how : 'In a browser, an app or a desk phone',
      done: at >= 3,
      live: phase === 'answered',
    },
  ];

  return (
    <div className="relative rounded-[22px] bg-[#0e1016] p-2 shadow-[0_30px_80px_-30px_rgb(11_13_18/0.55)]">
      <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
        <span className="font-gmono text-[11px] tracking-[0.08em] whitespace-nowrap text-[#7d8494] uppercase">
          Live demo<span className="hidden sm:inline"> · example call</span>
        </span>
        <span className="flex items-center gap-1.5 font-gmono text-[11px] whitespace-nowrap text-[#7d8494]">
          <span className={clsx('size-1.5 rounded-full', phase === 'answered' ? 'bg-[#17b26a]' : phase === 'ended' ? 'bg-[#4b5160]' : 'bg-[#f5a524]', !reduced && phase !== 'ended' && 'animate-pulse')} />
          {phase === 'answered' ? 'Connected' : phase === 'ended' ? 'Finished' : phase === 'menu' ? 'Waiting for a key' : 'Ringing'}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <ol className="rounded-[16px] bg-[#161922] px-4 py-3 sm:px-5" aria-live="polite">
          {steps.map((s, i) => (
            <li key={s.label} className="relative flex gap-4 pb-4 last:pb-1">
              {i < steps.length - 1 && (
                <span className="absolute top-5 bottom-0 left-[7px] w-px bg-[#2a2e3a]" aria-hidden>
                  <span className={clsx('block w-px bg-[#3b6df6] transition-[height] duration-700 ease-out', steps[i + 1]!.done || steps[i + 1]!.live ? 'h-full' : 'h-0')} />
                </span>
              )}
              <span
                className={clsx(
                  'relative mt-1 flex size-[15px] shrink-0 items-center justify-center rounded-full border transition-colors duration-500',
                  s.live ? 'border-[#3b6df6] bg-[#3b6df6]' : s.done ? 'border-[#3b6df6] bg-[#0e1016]' : 'border-[#363b48] bg-[#0e1016]',
                )}
                aria-hidden
              >
                {s.live && !reduced && <span className="absolute inset-0 animate-ping rounded-full bg-[#3b6df6] opacity-50" />}
              </span>
              <div className="min-w-0">
                <div className="font-gmono text-[10.5px] tracking-[0.08em] text-[#6b7282] uppercase">{s.label}</div>
                <div className={clsx('font-display mt-0.5 truncate text-[16px] leading-snug tracking-[-0.01em] transition-colors', s.done || s.live ? 'text-white' : 'text-[#5c6372]')}>{s.title}</div>
                <div className={clsx('font-geist text-[12.5px] transition-colors', s.live ? 'text-[#9fb6ff]' : 'text-[#7d8494]')}>{s.note}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-col rounded-[16px] bg-[#161922] p-3">
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Keypad: press 1 or 2 to route the call">
            {KEYS.map((k) => {
              const useful = phase === 'menu' && (k === '1' || k === '2');
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => choose(k)}
                  className={clsx(
                    'font-display flex h-11 w-full items-center justify-center rounded-xl text-[18px] transition sm:h-12 sm:w-14',
                    pressed === k ? 'scale-95 bg-[#3b6df6] text-white' : useful ? 'bg-[#232837] text-white ring-1 ring-[#3b6df6]/70 hover:bg-[#2a3042]' : 'bg-[#1c202b] text-[#8a91a1] hover:bg-[#222735]',
                  )}
                  aria-label={k === '1' ? '1, sales' : k === '2' ? '2, support' : k}
                >
                  {k}
                </button>
              );
            })}
          </div>
          <div className="font-gmono mt-3 text-center text-[10.5px] text-[#6b7282] sm:mt-auto sm:pb-1">{phase === 'menu' ? '1 sales · 2 support' : 'You are the caller'}</div>
        </div>
      </div>
    </div>
  );
}
