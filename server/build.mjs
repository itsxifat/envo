// Bundles the server into a single file so the VPS needs no node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  loader: { '.sql': 'text', '.conf': 'text' },
  // Optional native add-ons that the pure-JS packages probe for at runtime.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  // Some bundled CommonJS deps call require(); give ESM output a working one.
  banner: {
    js: "import { createRequire as __envoCreateRequire } from 'node:module'; const require = __envoCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
