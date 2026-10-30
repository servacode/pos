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
  },
});
