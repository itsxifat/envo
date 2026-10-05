import { useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import clsx from 'clsx';
import {
  ChevronDown,
  Hash,
  History,
  LayoutDashboard,
  ListOrdered,
  ListTree,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Radio,
  Users,
  UsersRound,
  Voicemail,
} from 'lucide-react';

/**
 * The hero picture: Envo's live-calls screen running on its own. Calls arrive, ring the team,
 * get answered, wait in the queue when everyone is busy, end and leave a recording. Example data;
 * nothing to press. Stands still for reduced motion and while off screen.
 */

type Team = 'Sales' | 'Support';
interface Agent {
  ext: string;
  name: string;
  team: Team | 'Reception';
}
const AGENTS: Agent[] = [
  { ext: '101', name: 'Farhana', team: 'Sales' },
  { ext: '102', name: 'Nadia', team: 'Sales' },
  { ext: '103', name: 'Rafi', team: 'Support' },
  { ext: '104', name: 'Tanvir', team: 'Support' },
  { ext: '105', name: 'Front desk', team: 'Reception' },
];
const agentOf = (ext: string | null) => AGENTS.find((a) => a.ext === ext);

const NUMBERS = ['01711 ••• 412', '01819 ••• 087', '01552 ••• 930', '01912 ••• 264', '01675 ••• 518', '01310 ••• 745', '01788 ••• 603', '01403 ••• 129'];

interface Call {
  id: number;
  number: string;
  team: Team;
  dir: 'in' | 'out';
  agent: string | null;
  state: 'ringing' | 'talking' | 'ended';
  start: number;
  answered: number;
  ended: number;
}
interface Board {
  t: number;
  seq: number;
  today: number;
  calls: Call[];
  /** The last call that ended (its recording). */
  last: Call;
}

const START: Board = {
  t: 0,
  seq: 4,
  today: 147,
  calls: [
    { id: 4, number: NUMBERS[3]!, team: 'Support', dir: 'in', agent: null, state: 'ringing', start: -1, answered: 0, ended: 0 },
    { id: 3, number: NUMBERS[2]!, team: 'Sales', dir: 'out', agent: '101', state: 'talking', start: -21, answered: -21, ended: 0 },
    { id: 2, number: NUMBERS[1]!, team: 'Support', dir: 'in', agent: '103', state: 'talking', start: -64, answered: -57, ended: 0 },
    { id: 1, number: NUMBERS[0]!, team: 'Sales', dir: 'in', agent: '102', state: 'talking', start: -142, answered: -134, ended: 0 },
  ],
  last: { id: 0, number: NUMBERS[7]!, team: 'Support', dir: 'in', agent: '104', state: 'ended', start: -300, answered: -294, ended: -160 },
};

function step(b: Board): Board {
  const t = b.t + 1;
  let { seq, today, last } = b;
  let calls = b.calls.filter((c) => c.state !== 'ended' || t - c.ended < 2);
  const busy = new Set(calls.filter((c) => c.state === 'talking').map((c) => c.agent));
  const freeIn = (team: Team) => AGENTS.find((a) => a.team === team && !busy.has(a.ext));

  // A ringing call is picked up after three seconds by whoever on its team is free; else it queues.
  calls = calls.map((c) => {
    if (c.state !== 'ringing' || t - c.start < 3) return c;
    const free = freeIn(c.team);
    if (!free) return c;
    busy.add(free.ext);
    return { ...c, state: 'talking', agent: free.ext, answered: t };
  });

  // Every five seconds: hang up the longest call when the lines are full, otherwise a new call.
  if (t % 5 === 0) {
    const live = calls.filter((c) => c.state !== 'ended');
    const oldest = live.filter((c) => c.state === 'talking').sort((a, b) => a.answered - b.answered)[0];
    if (live.length >= 4 && oldest) {
      last = { ...oldest, state: 'ended', ended: t };
      calls = calls.map((c) => (c.id === oldest.id ? last : c));
    } else if (live.length < 4) {
      seq += 1;
      today += 1;
      const team: Team = seq % 3 === 0 ? 'Support' : 'Sales';
      const caller = seq % 4 === 0 ? freeIn(team) : undefined;
      calls = [
        caller
          ? { id: seq, number: NUMBERS[seq % NUMBERS.length]!, team, dir: 'out', agent: caller.ext, state: 'talking', start: t, answered: t, ended: 0 }
          : { id: seq, number: NUMBERS[seq % NUMBERS.length]!, team, dir: 'in', agent: null, state: 'ringing', start: t, answered: 0, ended: 0 },
        ...calls,
      ];
    }
  }
  return { t, seq, today, calls, last };
}

const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** Runs only while the board is on screen (browsers already slow timers in background tabs). */
function useRunning(ref: RefObject<HTMLElement | null>): boolean {
  const [run, setRun] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setRun(!!e?.isIntersecting), { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref]);
  return run;
}

function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <span className={clsx('flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[10.5px] font-semibold text-[#3a3f4b]', className)}>{initials}</span>;
}

function Talking() {
  return (
    <span className="site-eq flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 0.2, 0.4, 0.1].map((d) => (
        <span key={d} className="h-full w-[2px] rounded-full bg-[#12a15f]" style={{ animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}

const WAVE = [34, 58, 42, 72, 88, 60, 46, 76, 92, 66, 50, 38, 58, 80, 64, 42, 30, 48, 72, 86, 62, 44, 56, 30];

export function LiveBoard() {
  const root = useRef<HTMLDivElement>(null);
  const running = useRunning(root);
  const [b, tick] = useReducer(step, START);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const { t, calls } = b;
  const live = calls.filter((c) => c.state !== 'ended');
  const talking = live.filter((c) => c.state === 'talking');
  const ringing = live.filter((c) => c.state === 'ringing');
  const newest = live[0];
  const status = (a: Agent): { label: string; tone: 'green' | 'amber' | 'gray'; call?: Call } => {
    const on = talking.find((c) => c.agent === a.ext);
    if (on) return { label: `On call · ${clock(t - on.answered)}`, tone: 'green', call: on };
    if (a.team !== 'Reception' && ringing.some((c) => c.team === a.team)) return { label: 'Ringing', tone: 'amber' };
    return { label: 'Available', tone: 'gray' };
  };

  return (
    <div ref={root} className="relative" aria-hidden>
      {/* Wide screens: the web phone and a finished recording float beside the window. */}
      {newest && (
        <div key={`phone-${newest.id}`} className="site-pop-in absolute bottom-[7%] -left-[200px] z-10 hidden w-[256px] rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(11_13_18/0.06),0_24px_48px_-16px_rgb(11_13_18/0.28)] ring-1 ring-[#e7e8ec] min-[1760px]:block">
          <div className="flex items-center justify-between">
            <span className="site-label">{newest.dir === 'out' ? 'Outgoing call' : newest.state === 'ringing' ? 'Incoming call' : 'On call'}</span>
            <span className="font-gmono text-[11px] text-[#8a8f9a]">Web phone</span>
          </div>
          <div className="font-display mt-3 text-[21px] leading-none tracking-[-0.02em]">{newest.number}</div>
          <div className="mt-1.5 text-[12.5px] text-[#5b616e]">
            {newest.dir === 'out' ? `${agentOf(newest.agent)?.name} is calling` : `Hotline → ${newest.team}`}
          </div>
          {newest.state === 'ringing' ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-[13px] font-medium">
              <span className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#fbeceb] text-[#b42318]">
                <PhoneOff className="size-3.5" /> Decline
              </span>
              <span className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#12a15f] text-white">
                <Phone className="size-3.5" /> Answer
              </span>
            </div>
          ) : (
            <div className="mt-4 flex items-center justify-between rounded-full bg-[#f3f5f4] px-3.5 py-2">
              <span className="flex items-center gap-2 text-[12.5px] text-[#2a2e37]">
                <Talking /> {agentOf(newest.agent)?.name}
              </span>
              <span className="font-gmono text-[12px] text-[#5b616e] tabular-nums">{clock(t - newest.answered)}</span>
            </div>
          )}
        </div>
      )}
      <div key={`rec-${b.last.id}`} className="site-pop-in absolute top-[22%] -right-[200px] z-10 hidden w-[256px] rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(11_13_18/0.06),0_24px_48px_-16px_rgb(11_13_18/0.28)] ring-1 ring-[#e7e8ec] min-[1760px]:block">
        <div className="flex items-center justify-between">
          <span className="site-label">Recording saved</span>
          <span className="font-gmono text-[11px] text-[#8a8f9a]">{clock(b.last.ended - b.last.answered)}</span>
        </div>
        <div className="mt-2.5 text-[13.5px] font-medium">
          {b.last.number} · {agentOf(b.last.agent)?.name}
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0b0d12] text-white">
            <Play className="size-3 translate-x-px fill-current" />
          </span>
          <span className="flex h-7 flex-1 items-center gap-[2px]">
            {WAVE.map((h, i) => (
              <span key={i} className={clsx('w-full rounded-full', i < 9 ? 'bg-[#1f57eb]' : 'bg-[#d5d9e0]')} style={{ height: `${h}%` }} />
            ))}
          </span>
        </div>
      </div>

      {/* The window */}
      <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_1px_2px_rgb(11_13_18/0.04),0_50px_100px_-50px_rgb(11_13_18/0.35)] ring-1 ring-[#e3e5ea]">
        <div className="flex h-12 items-center gap-3 border-b border-[#eceef1] bg-[#fbfbfc] px-4">
          <svg viewBox="0 0 24 24" className="size-[22px]">
            <rect width="24" height="24" rx="7" className="fill-[#0b0d12]" />
            <path d="M7 9.5v5M10.3 7v10M13.7 9v6M17 11v2" strokeWidth="2" strokeLinecap="round" className="stroke-[#3b6df6]" />
          </svg>
          <span className="flex items-center gap-1 text-[13.5px] font-medium">
            Acme Ltd <ChevronDown className="size-3.5 text-[#8a8f9a]" />
          </span>
          <span className="ml-auto hidden items-center gap-2 text-[12.5px] text-[#5b616e] sm:flex">
            <span className="size-1.5 rounded-full bg-[#12a15f]" />
            Hotline <span className="font-gmono">09612 345 678</span> online
          </span>
          <Avatar name="Nadia Rahman" className="ml-auto sm:ml-3" />
        </div>
        <div className="flex">
          <nav className="hidden w-[208px] shrink-0 border-r border-[#eceef1] bg-[#fbfbfc] p-3 lg:block">
            {[
              [LayoutDashboard, 'Dashboard'],
              [Radio, 'Live calls'],
              [History, 'Call log'],
              [Voicemail, 'Voicemail'],
              [Users, 'Extensions'],
              [Hash, 'Numbers'],
              [ListTree, 'IVR menus'],
              [UsersRound, 'Ring groups'],
              [ListOrdered, 'Queues'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Radio;
              const on = label === 'Live calls';
              return (
                <div key={label as string} className={clsx('flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px]', on ? 'bg-white font-medium text-[#0b0d12] shadow-[0_1px_2px_rgb(11_13_18/0.06)] ring-1 ring-[#e7e8ec]' : 'text-[#5b616e]')}>
                  <I className="size-4" />
                  {label as string}
                  {on && <span className="font-gmono ml-auto text-[11px] text-[#1f57eb] tabular-nums">{live.length}</span>}
                </div>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1 p-4 sm:p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="site-label">Today</div>
                <div className="font-display mt-1 text-[22px] leading-none font-semibold tracking-[-0.02em]">Live calls</div>
              </div>
              <span className="font-gmono flex items-center gap-1.5 text-[11.5px] text-[#5b616e]">
                <span className="size-1.5 animate-pulse rounded-full bg-[#12a15f] motion-reduce:animate-none" /> Live
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
              {[
                ['Calls today', String(b.today)],
                ['Answered', '96%'],
                ['On calls now', String(talking.length)],
                ['Waiting', String(ringing.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[#eceef1] px-3.5 py-3">
                  <div className="text-[12px] text-[#8a8f9a]">{label}</div>
                  <div className="font-display mt-1 text-[24px] leading-none tracking-[-0.02em] tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_290px]">
              <div className="overflow-hidden rounded-xl border border-[#eceef1]">
                <div className="font-gmono grid h-9 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_52px] items-center gap-3 border-b border-[#eceef1] bg-[#fbfbfc] px-4 text-[10.5px] tracking-[0.06em] text-[#8a8f9a] uppercase sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_52px]">
                  <span>Caller</span>
                  <span className="hidden sm:block">Route</span>
                  <span>Answered by</span>
                  <span className="text-right">Time</span>
                </div>
                <ul className="h-[260px]">
                  {calls.slice(0, 5).map((c) => {
                    const a = agentOf(c.agent);
                    const waiting = c.state === 'ringing' && t - c.start >= 3;
                    return (
                      <li
                        key={c.id}
                        className={clsx(
                          'grid h-[52px] grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_52px] items-center gap-3 border-b border-[#f1f2f4] px-4 text-[13px] transition-[background-color,opacity] duration-700 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_52px]',
                          c.id > START.seq && 'site-row-in',
                          c.state === 'ringing' && 'bg-[#fff8ec]',
                          c.state === 'ended' && 'opacity-40',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {c.dir === 'out' ? <PhoneOutgoing className="size-3.5 shrink-0 text-[#8a8f9a]" /> : <PhoneIncoming className="size-3.5 shrink-0 text-[#8a8f9a]" />}
                          <span className="font-gmono truncate text-[12.5px]">{c.number}</span>
                        </span>
                        <span className="hidden truncate text-[#5b616e] sm:block">{c.dir === 'out' ? 'Outgoing' : `Hotline → ${c.team}`}</span>
                        <span className="flex min-w-0 items-center gap-2">
                          {c.state === 'ringing' ? (
                            <>
                              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#f5a524] motion-reduce:animate-none" />
                              <span className="truncate text-[#a15c07]">{waiting ? `In ${c.team} queue` : `Ringing ${c.team}`}</span>
                            </>
                          ) : c.state === 'ended' ? (
                            <span className="text-[#8a8f9a]">Ended</span>
                          ) : (
                            <>
                              <Avatar name={a?.name ?? '?'} className="size-6 text-[9.5px]" />
                              <span className="truncate">{a?.name}</span>
                              <Talking />
                            </>
                          )}
                        </span>
                        <span className="font-gmono text-right text-[12px] text-[#5b616e] tabular-nums">
                          {c.state === 'talking' ? clock(t - c.answered) : c.state === 'ringing' ? clock(t - c.start) : clock(c.ended - c.answered)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="hidden rounded-xl border border-[#eceef1] p-4 md:block">
                <div className="site-label">Team</div>
                <ul className="mt-3 space-y-2.5">
                  {AGENTS.map((a) => {
                    const s = status(a);
                    return (
                      <li key={a.ext} className="flex items-center gap-2.5">
                        <Avatar name={a.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{a.name}</span>
                          <span className="font-gmono block text-[11px] text-[#8a8f9a]">
                            {a.ext} · {a.team}
                          </span>
                        </span>
                        <span
                          className={clsx(
                            'shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums transition-colors duration-500',
                            s.tone === 'green' && 'bg-[#e7f6ee] text-[#0b7a45]',
                            s.tone === 'amber' && 'bg-[#fff1d6] text-[#a15c07]',
                            s.tone === 'gray' && 'bg-[#f1f2f4] text-[#5b616e]',
                          )}
                        >
                          {s.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 border-t border-[#eceef1] pt-3.5">
                  <div className="flex items-baseline justify-between">
                    <span className="site-label">Channels</span>
                    <span className="font-gmono text-[11.5px] text-[#5b616e] tabular-nums">{live.length} of 5</span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-5 gap-1">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} className={clsx('h-1.5 rounded-full transition-colors duration-500', i < live.length ? 'bg-[#1f57eb]' : 'bg-[#e7e8ec]')} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
