import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { CircleCheck, ScanFace, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

/** The three pictures: looking straight, then turning the head one way and the other. */
const STEPS = [
  { title: 'Look straight at the camera', text: 'Keep your face inside the circle', ms: 1800 },
  { title: 'Slowly turn your head to the left', text: 'Just a little, keep looking at the screen', ms: 2000 },
  { title: 'Now slowly to the right', text: 'Almost done', ms: 2000 },
] as const;

type Phase = { kind: 'starting' } | { kind: 'ready' } | { kind: 'step'; step: number } | { kind: 'checking' } | { kind: 'passed' } | { kind: 'failed'; message: string } | { kind: 'no-camera'; message: string };

export interface CheckedSelfie {
  id: string;
  preview: string;
}

/** One frame of the video as an upright JPEG of at most 900 pixels. */
function grab(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/jpeg', 0.88));
}

/**
 * The live selfie on the website, as in the app: three pictures a moment apart while the person
 * follows the prompts; Envo's server checks one face, the same in all three, and a real head turn.
 */
export function LiveSelfie({ onDone, onClose }: { onDone: (s: CheckedSelfie) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const frames = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        setPhase({ kind: 'ready' });
      })
      .catch(() => setPhase({ kind: 'no-camera', message: 'Allow the camera for this page in your browser, or finish in the Envo Phone app.' }));
    if (!navigator.mediaDevices) setPhase({ kind: 'no-camera', message: 'This browser has no camera. Use your phone, or the Envo Phone app.' });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Each step: the ring fills while the person follows the prompt, then the frame is taken.
  useEffect(() => {
    if (phase.kind !== 'step') return;
    const t = setTimeout(async () => {
      try {
        frames.current[phase.step] = await grab(video.current!);
        setPhase(phase.step < STEPS.length - 1 ? { kind: 'step', step: phase.step + 1 } : { kind: 'checking' });
      } catch {
        setPhase({ kind: 'failed', message: "The camera didn't take the picture. Please try again." });
      }
    }, STEPS[phase.step]!.ms);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase.kind !== 'checking') return;
    const body = new FormData();
    ['straight', 'turn_1', 'turn_2'].forEach((name, i) => body.append(name, frames.current[i]!, `${name}.jpg`));
    api
      .post<{ id: string }>('/api/phone/selfie', body)
      .then((r) => {
        setPhase({ kind: 'passed' });
        setTimeout(() => onDone({ id: r.id, preview: URL.createObjectURL(frames.current[0]!) }), 800);
      })
      .catch((err) => setPhase({ kind: 'failed', message: errorMessage(err) }));
  }, [phase, onDone]);

  const title =
    phase.kind === 'step'
      ? STEPS[phase.step]!.title
      : phase.kind === 'starting'
        ? 'Starting the camera…'
        : phase.kind === 'ready'
          ? 'Take a live selfie'
          : phase.kind === 'checking'
            ? 'Checking it’s you…'
            : phase.kind === 'passed'
              ? 'Thank you!'
              : phase.kind === 'failed'
                ? 'Let’s try that again'
                : 'Your camera is needed';
  const text =
    phase.kind === 'step'
      ? STEPS[phase.step]!.text
      : phase.kind === 'failed' || phase.kind === 'no-camera'
        ? phase.message
        : phase.kind === 'ready'
          ? 'Sit facing the light. We take three pictures while you follow the prompts.'
          : phase.kind === 'checking'
            ? 'This takes a few seconds.'
            : phase.kind === 'passed'
              ? 'Your selfie is done.'
              : '';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950 p-4 text-white" role="dialog" aria-label="Live selfie">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
        <X className="size-6" />
      </button>
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative size-72 sm:size-80">
          {/* The ring fills during each step (restarted by the key). */}
          <svg viewBox="0 0 100 100" className="absolute -inset-3 size-[calc(100%+1.5rem)] -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="48" fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="1.6" />
            {phase.kind === 'step' && (
              <circle key={phase.step} cx="50" cy="50" r="48" fill="none" stroke="#618ffa" strokeWidth="1.8" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="selfie-ring" style={{ animationDuration: `${STEPS[phase.step]!.ms}ms` }} />
            )}
            {(phase.kind === 'passed' || phase.kind === 'failed') && <circle cx="50" cy="50" r="48" fill="none" stroke={phase.kind === 'passed' ? '#22c55e' : '#f87171'} strokeWidth="1.8" />}
          </svg>
          <div className="absolute inset-0 overflow-hidden rounded-full bg-ink-900">
            <video ref={video} autoPlay playsInline muted className={clsx('size-full -scale-x-100 object-cover', phase.kind === 'no-camera' && 'hidden')} />
            {phase.kind === 'no-camera' && (
              <div className="flex size-full items-center justify-center">
                <ScanFace className="size-16 text-white/40" />
              </div>
            )}
          </div>
          {phase.kind === 'passed' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-ink-950/50">
              <CircleCheck className="size-20 text-emerald-400" />
            </div>
          )}
        </div>
        <h2 className="mt-9 text-[24px] leading-tight font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 min-h-[2.75rem] text-[15px] text-white/70">{text}</p>
        {phase.kind === 'step' && (
          <div className="mt-4 flex gap-2" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={clsx('size-2 rounded-full', i <= phase.step ? 'bg-brand-400' : 'bg-white/25')} />
            ))}
          </div>
        )}
        {(phase.kind === 'ready' || phase.kind === 'failed') && (
          <button
            type="button"
            onClick={() => {
              frames.current = [];
              setPhase({ kind: 'step', step: 0 });
            }}
            className="mt-7 h-12 w-full rounded-full bg-white text-[15px] font-semibold text-ink-950 transition hover:bg-white/90"
          >
            {phase.kind === 'ready' ? 'Start' : 'Try again'}
          </button>
        )}
        {phase.kind === 'no-camera' && (
          <button type="button" onClick={onClose} className="mt-7 h-12 w-full rounded-full bg-white/10 text-[15px] font-semibold transition hover:bg-white/15">
            Close
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
