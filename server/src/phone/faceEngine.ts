import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { Face } from './faces.js';

/*
 * The face detector, its 68 landmarks and a face descriptor (face-api.js models on TensorFlow's
 * WebAssembly backend). This runs in the face worker (faceWorker.ts), never on the API's own thread:
 * the bundle sits in faces/ with the models and .wasm files (copied there by the build).
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MODELS = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'] as const;
/** Larger pictures are refused unread: a file of a few hundred KB can declare billions of pixels. */
const MAX_PIXELS = 40_000_000;
/** The detector looks at about 512 pixels anyway; TensorFlow only ever gets pictures this small. */
const MAX_SIDE = 800;

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

interface Pixels {
  data: Uint8Array;
  width: number;
  height: number;
}

/** JPEG or PNG to RGB pixels; null for anything else (a PDF, an unknown format), a broken file or one too large. */
function decode(buf: Buffer): Pixels | null {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 512 });
      return { data: img.data, width: img.width, height: img.height };
    }
    if (buf.length > 24 && buf.subarray(1, 4).toString('latin1') === 'PNG') {
      // The size is in the first chunk (IHDR), read before anything is decoded.
      if (buf.readUInt32BE(16) * buf.readUInt32BE(20) > MAX_PIXELS) return null;
      const png = PNG.sync.read(buf);
      const rgb = new Uint8Array(png.width * png.height * 3);
      for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
        rgb[j] = png.data[i]!;
        rgb[j + 1] = png.data[i + 1]!;
        rgb[j + 2] = png.data[i + 2]!;
      }
      return { data: rgb, width: png.width, height: png.height };
    }
  } catch {
    return null;
  }
  return null;
}

/** Scales a picture down to at most MAX_SIDE on its long side, each new pixel the average of the ones it covers. */
function shrink(img: Pixels): Pixels {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (scale === 1) return img;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const sums = new Uint32Array(width * height * 3);
  const counts = new Uint32Array(width * height);
  const column = new Uint32Array(img.width);
  for (let x = 0; x < img.width; x++) column[x] = Math.min(width - 1, Math.floor((x * width) / img.width));
  for (let y = 0; y < img.height; y++) {
    const row = Math.min(height - 1, Math.floor((y * height) / img.height)) * width;
    for (let x = 0, i = y * img.width * 3; x < img.width; x++, i += 3) {
      const o = row + column[x]!;
      sums[o * 3] += img.data[i]!;
      sums[o * 3 + 1] += img.data[i + 1]!;
      sums[o * 3 + 2] += img.data[i + 2]!;
      counts[o]!++;
    }
  }
  const data = new Uint8Array(width * height * 3);
  for (let o = 0; o < counts.length; o++) {
    const n = counts[o] || 1;
    data[o * 3] = Math.round(sums[o * 3]! / n);
    data[o * 3 + 1] = Math.round(sums[o * 3 + 1]! / n);
    data[o * 3 + 2] = Math.round(sums[o * 3 + 2]! / n);
  }
  return { data, width, height };
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

// One picture at a time keeps TensorFlow's memory to one picture's worth.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Every face in a picture, largest first. Null when the picture can't be read (e.g. a PDF). */
export function facesIn(buf: Buffer): Promise<Face[] | null> {
  return serial(async () => {
    const decoded = decode(buf);
    if (!decoded) return null;
    const img = shrink(decoded);
    await load();
    const input = tf.tensor3d(img.data, [img.height, img.width, 3], 'int32');
    try {
      const found = await faceapi.detectAllFaces(input as never, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks().withFaceDescriptors();
      return found
        .map((f) => ({ score: f.detection.score, size: f.detection.box.width / img.width, yaw: yawOf(f.landmarks), descriptor: f.descriptor }))
        .sort((a, b) => b.size - a.size);
    } finally {
      input.dispose();
    }
  });
}
