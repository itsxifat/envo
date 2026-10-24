import { Worker } from 'node:worker_threads';

/*
 * Faces in registration photos, found and compared on this server (no outside service). The work
 * runs in a worker thread (faceWorker.ts, bundled with the face models into faces/ next to the
 * server): started on first use, ended when idle, and started afresh if it ever fails.
 */

export interface Face {
  /** Detector confidence, 0-1. */
  score: number;
  /** Share of the picture's width the face takes. */
  size: number;
  /** Head turn: 0 looking straight, about ±0.3 turned well to one side. */
  yaw: number;
  descriptor: Float32Array;
}

/** The first check loads the models (a few seconds); none takes anywhere near this long. */
const JOB_TIMEOUT_MS = 60_000;
/** The worker's memory (TensorFlow keeps what it once used) goes back after this long unused. */
const IDLE_MS = 10 * 60_000;

interface Job {
  resolve: (faces: Face[] | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: Worker | null = null;
let idle: NodeJS.Timeout | null = null;
const jobs = new Map<number, Job>();
let nextId = 1;

/** Ends the worker; whatever it was still doing fails with `err`. */
function stop(w: Worker, err: Error): void {
  if (worker === w) worker = null;
  for (const [id, job] of jobs) {
    clearTimeout(job.timer);
    job.reject(err);
    jobs.delete(id);
  }
  void w.terminate();
}

function engine(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./faces/worker.mjs', import.meta.url));
  w.unref();
  w.on('message', (m: { id: number; faces?: Face[] | null; error?: string }) => {
    const job = jobs.get(m.id);
    if (!job) return;
    jobs.delete(m.id);
    clearTimeout(job.timer);
    if (m.error === undefined) job.resolve(m.faces ?? null);
    else {
      // TensorFlow can be left broken after an error: the next check gets a fresh worker.
      job.reject(new Error(m.error));
      stop(w, new Error(m.error));
    }
    if (!jobs.size && worker === w) idle = setTimeout(() => worker === w && !jobs.size && stop(w, new Error('stopped')), IDLE_MS).unref();
  });
  w.on('error', (err) => stop(w, err));
  w.on('exit', () => stop(w, new Error('The face check stopped')));
  worker = w;
  return w;
}

/** Every face in a picture, largest first. Null when the picture can't be read (e.g. a PDF). */
export function facesIn(buf: Buffer): Promise<Face[] | null> {
  if (idle) clearTimeout(idle);
  idle = null;
  const w = engine();
  const id = nextId++;
  return new Promise<Face[] | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      jobs.delete(id);
      reject(new Error('The face check took too long'));
      stop(w, new Error('The face check took too long'));
    }, JOB_TIMEOUT_MS);
    jobs.set(id, { resolve, reject, timer });
    w.postMessage({ id, image: buf });
  });
}

/** Euclidean distance of two face descriptors: under about 0.5 the same person, over 0.6 not. */
export const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.sqrt(Array.from(a).reduce((s, v, i) => s + (v - b[i]!) ** 2, 0));
