import { defineConfig } from 'vite';

// Builds the embeddable phone widget as a single self-contained script:
//   https://<envo host>/embed/phone.js  ->  window.Envo.phone({ ... })
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/embed',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: 'embed/phone.ts',
      name: 'Envo',
      formats: ['iife'],
      fileName: () => 'phone.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});
