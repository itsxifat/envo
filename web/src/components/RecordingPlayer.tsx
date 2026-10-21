import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import clsx from 'clsx';
import { Download, Keyboard, ListVideo, LoaderCircle, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { formatDuration } from '../lib/format';
import { IconButton, Kbd, Tooltip } from './ui';

export interface PlayerTrack {
  id: number;
  /** Streams or downloads the audio. */
  url: string;
  downloadUrl: string;
  title: string;
  subtitle: string;
  size: number | null;
  /** Talk time from the call record, shown until the audio reports its own length. */
  duration: number;
}

export interface PlayerHandle {
  toggle: () => void;
}

/** Larger files stream instead of loading fully (no waveform, but playback starts at once). */
const WAVEFORM_MAX_BYTES = 25 * 1024 * 1024;
const PEAK_POINTS = 1200;
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SHORTCUTS: Array<[string, string]> = [
  ['Space / K', 'Play or pause'],
  ['← / →', 'Back or forward 5 s'],
  ['J / L', 'Back or forward 10 s'],
  ['< / >', 'Slower or faster'],
  ['P / N', 'Previous or next recording'],
  ['M', 'Mute'],
];

function readPref(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: number | string): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode */
  }
}

async function readWithProgress(res: Response, total: number, onProgress: (fraction: number) => void): Promise<Blob> {
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(Math.min(1, received / total));
  }
  return new Blob(chunks as BlobPart[], { type: 'audio/wav' });
}

/** Loudness envelope of the recording (0..1), for drawing the waveform. */
async function computePeaks(data: ArrayBuffer): Promise<Float32Array> {
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const audio = await new Ctx(1, 1, 8000).decodeAudioData(data);
  const samples = audio.getChannelData(0);
  const n = Math.min(PEAK_POINTS, samples.length);
  const out = new Float32Array(n);
  const block = samples.length / n;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * block);
    const end = Math.max(start + 1, Math.floor((i + 1) * block));
    const step = Math.max(1, Math.floor((end - start) / 96));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += step) {
      const v = samples[j]!;
      sum += v * v;
      count++;
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    out[i] = rms;
    if (rms > max) max = rms;
  }
  // Square root lifts quiet speech so both sides of the call stay visible.
  for (let i = 0; i < n; i++) out[i] = max > 0 ? Math.sqrt(out[i]! / max) : 0;
  return out;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Call recording player: waveform with click/drag seeking, speed, skip, volume, autoplay of the next
 * recording, keyboard shortcuts and lock-screen controls. Sticks to the bottom of the page.
 */
export function RecordingPlayer({
  track,
  onClose,
  onPrev,
  onNext,
  autoNext,
  onAutoNextChange,
  onPlayingChange,
  ref,
}: {
  track: PlayerTrack;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  autoNext: boolean;
  onAutoNextChange: (on: boolean) => void;
  onPlayingChange?: (playing: boolean) => void;
  ref?: Ref<PlayerHandle>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(track.duration);
  const [rate, setRate] = useState(() => readPref('envo.player.rate', 1));
  const [volume, setVolume] = useState(() => Math.min(1, readPref('envo.player.volume', 1)));
  const [muted, setMuted] = useState(false);

  // Handlers read the latest props without re-running effects.
  const latest = useRef({ onPrev, onNext, autoNext, onPlayingChange, rate });
  latest.current = { onPrev, onNext, autoNext, onPlayingChange, rate };

  const audio = () => audioRef.current!;
  const toggle = () => {
    const a = audio();
    if (!a.src) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };
  const seek = (sec: number) => {
    const a = audio();
    const max = Number.isFinite(a.duration) ? a.duration : duration;
    a.currentTime = Math.min(Math.max(0, sec), Math.max(0, max - 0.05));
    setTime(a.currentTime);
  };
  const skip = (delta: number) => seek(audio().currentTime + delta);
  const changeRate = (dir: 1 | -1) => {
    const i = RATES.indexOf(rate);
    const next = RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))]!;
    setRate(next);
  };
  const cycleRate = () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1);

  useImperativeHandle(ref, () => ({ toggle }));

  // Load the recording: small files are fetched whole (waveform, instant seeking), large ones stream.
  useEffect(() => {
    const a = audioRef.current!;
    const ctrl = new AbortController();
    let objectUrl = '';
    setStatus('loading');
    setLoaded(0);
    setError('');
    setPeaks(null);
    setTime(0);
    setDuration(track.duration);
    const start = (src: string) => {
      a.src = src;
      a.playbackRate = latest.current.rate;
      setStatus('ready');
      void a.play().catch(() => undefined);
    };
    void (async () => {
      try {
        if (track.size !== null && track.size > WAVEFORM_MAX_BYTES) {
          start(track.url);
          return;
        }
        const res = await fetch(track.url, { credentials: 'same-origin', signal: ctrl.signal });
        if (!res.ok) throw new Error(res.status === 404 ? 'This recording is no longer on the server.' : `Could not load the recording (${res.status}).`);
        const total = Number(res.headers.get('content-length')) || track.size || 0;
        const blob = await readWithProgress(res, total, setLoaded);
        if (ctrl.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        start(objectUrl);
        const p = await computePeaks(await blob.arrayBuffer()).catch(() => null);
        if (!ctrl.signal.aborted) setPeaks(p);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not load the recording.');
      }
    })();
    return () => {
      ctrl.abort();
      a.pause();
      a.removeAttribute('src');
      a.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [track.id, track.url, track.size, track.duration]);

  useEffect(() => {
    audio().playbackRate = rate;
    writePref('envo.player.rate', rate);
  }, [rate]);

  useEffect(() => {
    audio().volume = volume;
    audio().muted = muted;
    writePref('envo.player.volume', volume);
  }, [volume, muted]);

  useEffect(() => {
    latest.current.onPlayingChange?.(playing);
  }, [playing]);

  // Smooth progress while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setTime(audioRef.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const keys = useRef({ toggle, skip, seek, changeRate });
  keys.current = { toggle, skip, seek, changeRate };

  // Keyboard shortcuts while the player is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { toggle, skip, changeRate } = keys.current;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const onControl = e.target instanceof HTMLElement && !!e.target.closest('button, a, [role="slider"]');
      switch (e.key) {
        case ' ':
          if (onControl) return;
          e.preventDefault();
          toggle();
          break;
        case 'k':
        case 'K':
          toggle();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (onControl) return;
          e.preventDefault();
          skip(e.key === 'ArrowLeft' ? -5 : 5);
          break;
        case 'j':
        case 'J':
          skip(-10);
          break;
        case 'l':
        case 'L':
          skip(10);
          break;
        case '<':
        case ',':
          changeRate(-1);
          break;
        case '>':
        case '.':
          changeRate(1);
          break;
        case 'n':
        case 'N':
          latest.current.onNext?.();
          break;
        case 'p':
        case 'P':
          latest.current.onPrev?.();
          break;
        case 'm':
        case 'M':
          setMuted((m) => !m);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lock-screen / headset controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    try {
      ms.metadata = new MediaMetadata({ title: track.title, artist: track.subtitle, album: 'Call recording' });
    } catch {
      /* MediaMetadata missing */
    }
    set('play', () => void audioRef.current?.play());
    set('pause', () => audioRef.current?.pause());
    set('seekbackward', () => keys.current.skip(-10));
    set('seekforward', () => keys.current.skip(10));
    set('seekto', (d) => d.seekTime !== undefined && keys.current.seek(d.seekTime));
    set('previoustrack', () => latest.current.onPrev?.());
    set('nexttrack', () => latest.current.onNext?.());
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) set(a, null);
      ms.metadata = null;
    };
  }, [track.id, track.title, track.subtitle]);

  const total = duration > 0 ? duration : track.duration;
  const fraction = total > 0 ? Math.min(1, time / total) : 0;

  const playButton = (big: boolean) => (
    <button
      type="button"
      onClick={toggle}
      disabled={status !== 'ready'}
      aria-label={playing ? 'Pause' : 'Play'}
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full bg-ink-950 text-white shadow-[0_6px_16px_-6px_rgb(11_13_18/0.6)] transition hover:bg-ink-800 focus-visible:ring-4 focus-visible:ring-brand-500/30 focus-visible:outline-none active:scale-95 disabled:opacity-60',
        big ? 'size-12' : 'size-11',
      )}
    >
      {status === 'loading' ? (
        <LoaderCircle className="size-5 animate-spin" />
      ) : playing ? (
        <Pause className="size-5 fill-current" />
      ) : (
        <Play className="ml-0.5 size-5 fill-current" />
      )}
    </button>
  );
  const rateButton = (
    <Tooltip label="Playback speed (< >)">
      <button
        type="button"
        onClick={cycleRate}
        aria-label={`Playback speed ${rate}x`}
        className={clsx(
          'h-8 min-w-12 rounded-full px-2.5 font-mono text-xs font-medium tabular-nums transition',
          rate === 1 ? 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-900' : 'bg-brand-50 text-brand-700 hover:bg-brand-100',
        )}
      >
        {rate}×
      </button>
    </Tooltip>
  );
  const autoButton = (
    <Tooltip label={autoNext ? 'Autoplay next: on' : 'Autoplay next: off'}>
      <button
        type="button"
        onClick={() => onAutoNextChange(!autoNext)}
        aria-pressed={autoNext}
        aria-label="Autoplay the next recording"
        className={clsx(
          'inline-flex size-9 items-center justify-center rounded-full transition sm:size-8',
          autoNext ? 'bg-brand-50 text-brand-700 hover:bg-brand-100' : 'text-slate-400 hover:bg-black/[0.05] hover:text-slate-800',
        )}
      >
        <ListVideo className="size-4" />
      </button>
    </Tooltip>
  );

  return (
    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-4 lg:bottom-4" role="region" aria-label="Recording player">
      <div className="animate-fade-in rounded-2xl border border-black/[0.08] bg-white/95 p-3 shadow-[0_18px_50px_-18px_rgb(11_13_18/0.45)] backdrop-blur-xl sm:p-4">
        <audio
          ref={audioRef}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onEnded={() => {
            setPlaying(false);
            if (latest.current.autoNext) latest.current.onNext?.();
          }}
          onError={(e) => {
            if (e.currentTarget.getAttribute('src') && status === 'ready') {
              setStatus('error');
              setError('This recording cannot be played.');
            }
          }}
        />

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <IconButton label="Previous recording (P)" onClick={onPrev} disabled={!onPrev}>
              <SkipBack className="size-4" />
            </IconButton>
            {playButton(false)}
            <IconButton label="Next recording (N)" onClick={onNext} disabled={!onNext}>
              <SkipForward className="size-4" />
            </IconButton>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold tracking-tight text-slate-950">{track.title}</p>
            <p className="truncate text-xs text-slate-500">{track.subtitle}</p>
          </div>
          <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
            <IconButton label="Back 10 seconds (J)" onClick={() => skip(-10)} disabled={status !== 'ready'}>
              <RotateCcw className="size-4" />
            </IconButton>
            <IconButton label="Forward 10 seconds (L)" onClick={() => skip(10)} disabled={status !== 'ready'}>
              <RotateCw className="size-4" />
            </IconButton>
            {rateButton}
            <IconButton label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => setMuted(!muted)}>
              {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              aria-label="Volume"
              className="hidden w-20 accent-brand-600 lg:block"
            />
            {autoButton}
            <a
              href={track.downloadUrl}
              className="inline-flex size-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-800"
              title="Download recording"
              aria-label="Download recording"
            >
              <Download className="size-4" />
            </a>
            <Tooltip
              label={
                <div className="space-y-1 py-0.5">
                  {SHORTCUTS.map(([keys, what]) => (
                    <div key={keys} className="flex items-center justify-between gap-4">
                      <Kbd>{keys}</Kbd>
                      <span>{what}</span>
                    </div>
                  ))}
                </div>
              }
            >
              <span className="hidden size-8 items-center justify-center rounded-full text-slate-400 lg:inline-flex" tabIndex={0} aria-label="Keyboard shortcuts">
                <Keyboard className="size-4" />
              </span>
            </Tooltip>
          </div>
          <IconButton label="Close player" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="mt-2.5 flex items-center gap-2.5 sm:mt-3 sm:gap-3">
          <span className="w-11 shrink-0 text-right font-mono text-[11px] text-slate-500 tabular-nums">{formatDuration(time)}</span>
          {status === 'error' ? (
            <p className="flex h-12 flex-1 items-center text-sm text-rose-600">{error}</p>
          ) : (
            <Waveform peaks={peaks} fraction={fraction} total={total} loading={status === 'loading'} loaded={loaded} onSeek={(f) => seek(f * total)} />
          )}
          <span className="w-11 shrink-0 font-mono text-[11px] text-slate-500 tabular-nums">{formatDuration(total)}</span>
        </div>

        <div className="mt-2 flex items-center justify-between sm:hidden">
          {rateButton}
          <div className="flex items-center gap-1">
            <IconButton label="Previous recording" onClick={onPrev} disabled={!onPrev}>
              <SkipBack className="size-4" />
            </IconButton>
            <IconButton label="Back 10 seconds" onClick={() => skip(-10)} disabled={status !== 'ready'}>
              <RotateCcw className="size-4" />
            </IconButton>
            {playButton(true)}
            <IconButton label="Forward 10 seconds" onClick={() => skip(10)} disabled={status !== 'ready'}>
              <RotateCw className="size-4" />
            </IconButton>
            <IconButton label="Next recording" onClick={onNext} disabled={!onNext}>
              <SkipForward className="size-4" />
            </IconButton>
          </div>
          {autoButton}
        </div>
      </div>
    </div>
  );
}

/** Seekable loudness bars; falls back to a plain bar while loading or for streamed files. */
function Waveform({
  peaks,
  fraction,
  total,
  loading,
  loaded,
  onSeek,
}: {
  peaks: Float32Array | null;
  fraction: number;
  total: number;
  loading: boolean;
  loaded: number;
  onSeek: (fraction: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = Math.max(24, Math.floor(width / 4));
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!peaks) {
      bars.push(0.18 + 0.12 * Math.abs(Math.sin(i * 0.7)));
      continue;
    }
    const from = Math.floor((i / count) * peaks.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
    let v = 0;
    for (let j = from; j < to; j++) v = Math.max(v, peaks[j]!);
    bars.push(v);
  }

  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const shown = drag ?? fraction;
  const disabled = loading || total <= 0;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(at(e.clientX));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const f = at(e.clientX);
    if (drag !== null) setDrag(f);
    else setHover(f);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    onSeek(at(e.clientX));
    setDrag(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || total <= 0) return;
    const step = (e.shiftKey ? 15 : 5) / total;
    if (e.key === 'ArrowLeft') onSeek(Math.max(0, fraction - step));
    else if (e.key === 'ArrowRight') onSeek(Math.min(1, fraction + step));
    else if (e.key === 'Home') onSeek(0);
    else if (e.key === 'End') onSeek(0.999);
    else return;
    e.preventDefault();
  };

  const tip = drag ?? hover;
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Position in recording"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(shown * total)}
      aria-valuetext={formatDuration(shown * total)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      className={clsx(
        'group relative flex h-12 min-w-0 flex-1 touch-none items-center gap-[2px] rounded-lg select-none focus-visible:ring-3 focus-visible:ring-brand-500/25 focus-visible:outline-none',
        disabled ? 'cursor-progress' : 'cursor-pointer',
      )}
    >
      {peaks || loading ? (
        bars.map((v, i) => {
          const played = (i + 0.5) / count <= shown;
          return (
            <span
              key={i}
              className={clsx(
                'min-w-px flex-1 rounded-full transition-colors duration-75',
                loading ? 'animate-pulse bg-slate-200' : played ? 'bg-brand-600' : tip !== null && (i + 0.5) / count <= tip ? 'bg-brand-200' : 'bg-slate-300',
              )}
              style={{ height: `${Math.max(8, v * 100)}%` }}
            />
          );
        })
      ) : (
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="absolute inset-y-0 left-0 rounded-full bg-brand-600" style={{ width: `${shown * 100}%` }} />
        </div>
      )}
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-white/90 px-2.5 py-1 font-mono text-[11px] text-slate-600 shadow-sm ring-1 ring-black/[0.06] tabular-nums">
            Loading{loaded > 0 ? ` ${Math.round(loaded * 100)}%` : '…'}
          </span>
        </span>
      )}
      {!disabled && <span className="pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-ink-950" style={{ left: `calc(${shown * 100}% - 1px)` }} />}
      {!disabled && tip !== null && (
        <span
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-ink-950 px-1.5 py-0.5 font-mono text-[10.5px] text-white tabular-nums"
          style={{ left: `${tip * 100}%` }}
        >
          {formatDuration(tip * total)}
        </span>
      )}
    </div>
  );
}
