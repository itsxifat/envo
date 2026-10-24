// Bundles the server into a single file so the VPS needs no node_modules.
import { build } from 'esbuild';
import { copyFaceAssets } from './face-assets.mjs';

await build({
  // The face worker runs in a thread of its own, next to the face models it loads.
  entryPoints: { index: 'src/index.ts', 'faces/worker': 'src/phone/faceWorker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  loader: { '.sql': 'text', '.conf': 'text' },
  // Optional native add-ons that the pure-JS packages probe for at runtime.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  // Some bundled CommonJS deps call require() (and TensorFlow's WebAssembly __dirname); give ESM output both.
  banner: {
    js: "import { createRequire as __envoCreateRequire } from 'node:module'; import { fileURLToPath as __envoFileURLToPath } from 'node:url'; const require = __envoCreateRequire(import.meta.url); const __filename = __envoFileURLToPath(import.meta.url); const __dirname = __filename.slice(0, __filename.lastIndexOf('/'));",
  },
  logLevel: 'info',
});
copyFaceAssets();
