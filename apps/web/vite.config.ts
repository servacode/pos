import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_ORIGIN = 'http://localhost:3000';

/**
 * The support matrix (tab 15 › الحد الأدنى للأجهزة, owner decision): Chrome and Edge 111+,
 * WebView2 and Android System WebView 111+ (same engine), and Safari 16.4 for the owner and store
 * pages. Tailwind 4 and oklch need these engines; older ones get the «محرّك قديم» page instead.
 */
const BUILD_TARGET = ['chrome111', 'edge111', 'safari16.4'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: BUILD_TARGET,
    // The chunk graph the size budget (.size-limit.js) measures. Not under dist/.vite, because
    // turbo's cache does not restore files inside dot-folders.
    manifest: 'vite-manifest.json',
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': API_ORIGIN,
      '/health': API_ORIGIN,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // Above the 5s asyncUtilTimeout in vitest.setup.ts, so a slow render reports as the
    // assertion that failed and not as a bare test timeout.
    testTimeout: 15_000,
  },
});
