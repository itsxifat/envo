import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    // Local development against `npm run dev` in ../server.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4310', ws: true },
    },
  },
});
