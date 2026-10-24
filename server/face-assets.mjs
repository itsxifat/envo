// The face models and TensorFlow's WebAssembly files for the selfie check (src/phone/faces.ts),
// copied next to the bundle into dist/faces/, which a release carries along (see deploy.sh).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

export function copyFaceAssets(out = 'dist/faces') {
  mkdirSync(out, { recursive: true });
  const models = 'node_modules/@vladmandic/face-api/model';
  for (const f of readdirSync(models)) if (/^(ssd_mobilenetv1|face_landmark_68|face_recognition)_model/.test(f)) cpSync(`${models}/${f}`, `${out}/${f}`);
  const wasm = 'node_modules/@tensorflow/tfjs-backend-wasm/dist';
  for (const f of readdirSync(wasm)) if (f.endsWith('.wasm')) cpSync(`${wasm}/${f}`, `${out}/${f}`);
}
