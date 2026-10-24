import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/*
 * Faces in registration photos, found and compared on this server (no outside service): the face
 * detector, its 68 landmarks and a face descriptor (face-api.js models, run with TensorFlow's
 * WebAssembly backend). Loaded on first use; the models and .wasm files sit in faces/ next to the
 * bundle (copied there by the build).
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

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'faces');
const MODELS = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'] as const;

let ready: Promise<void> | null = null;

// face-api's types name TensorFlow's classes from another copy of its declarations, so the same
// tensors don't type-match across the two: they are passed as `never`.
async function loadNet(net: { loadFromWeightMap: (m: never) => void }, name: string): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(path.join(DIR, `${name}-weights_manifest.json`), 'utf8')) as { paths: string[]; weights: tf.io.WeightsManifestEntry[] }[];
  const parts = await Promise.all(manifest.flatMap((g) => g.paths.map((p) => fs.readFile(path.join(DIR, p)))));
  const data = Buffer.concat(parts);
  net.loadFromWeightMap(tf.io.decodeWeights(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), manifest.flatMap((g) => g.weights)) as never);
}

function load(): Promise<void> {
  ready ??= (async () => {
    setWasmPaths(`${DIR}/`);
    await tf.setBackend('wasm');
    await tf.ready();
    await loadNet(faceapi.nets.ssdMobilenetv1, MODELS[0]);
    await loadNet(faceapi.nets.faceLandmark68Net, MODELS[1]);
    await loadNet(faceapi.nets.faceRecognitionNet, MODELS[2]);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

/** JPEG or PNG to RGB pixels; null for anything else (a PDF, an unknown format). */
function decode(buf: Buffer): { data: Uint8Array; width: number; height: number } | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 512 });
    return { data: img.data, width: img.width, height: img.height };
  }
  if (buf.subarray(1, 4).toString('latin1') === 'PNG') {
    const png = PNG.sync.read(buf);
    const rgb = new Uint8Array(png.width * png.height * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      rgb[j] = png.data[i]!;
      rgb[j + 1] = png.data[i + 1]!;
      rgb[j + 2] = png.data[i + 2]!;
    }
    return { data: rgb, width: png.width, height: png.height };
  }
  return null;
}

const mean = (pts: faceapi.Point[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/** How far the head is turned: the nose tip's offset from between the eyes, in eye distances. */
function yawOf(landmarks: faceapi.FaceLandmarks68): number {
  const p = landmarks.positions;
  const left = mean(p.slice(36, 42));
  const right = mean(p.slice(42, 48));
  const between = Math.hypot(right.x - left.x, right.y - left.y) || 1;
  return (p[30]!.x - (left.x + right.x) / 2) / between;
}

// One picture at a time: the server is shared, and this is heavy.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Every face in a picture, largest first. Null when the picture can't be read (e.g. a PDF). */
export function facesIn(buf: Buffer): Promise<Face[] | null> {
  return serial(async () => {
    const img = decode(buf);
    if (!img) return null;
    await load();
    // The detector looks at about 512 pixels anyway; a smaller picture is much faster.
    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
    const input = tf.tidy(() => {
      const t = tf.tensor3d(img.data, [img.height, img.width, 3], 'int32');
      return scale < 1 ? tf.image.resizeBilinear(t, [Math.round(img.height * scale), Math.round(img.width * scale)]).toInt() : t;
    }) as tf.Tensor3D;
    try {
      const found = await faceapi.detectAllFaces(input as never, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks().withFaceDescriptors();
      const width = input.shape[1];
      return found
        .map((f) => ({ score: f.detection.score, size: f.detection.box.width / width, yaw: yawOf(f.landmarks), descriptor: f.descriptor }))
        .sort((a, b) => b.size - a.size);
    } finally {
      input.dispose();
    }
  });
}

/** Euclidean distance of two face descriptors: under about 0.5 the same person, over 0.6 not. */
export const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.sqrt(Array.from(a).reduce((s, v, i) => s + (v - b[i]!) ** 2, 0));
