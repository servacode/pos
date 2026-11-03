import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_ORIGIN = 'http://localhost:3000';

/**
 * The support matrix (tab 15 › الحد الأدنى للأجهزة, owner decision): Chrome and Edge 111+,
 * WebView2 and Android System WebView 111+ (same engine), and Safari 16.4 for the owner and store
 * pages. Tailwind 4 and oklch need these engines; older ones get the «محرّك قديم» page instead.
 */
const BUILD_TARGET = ['chrome111', 'edge111', 'safari16.4'];

/**
 * Writes dist/sw.js (src/sw/worker.js) with this build's name and the list of every file it
 * emitted, plus public/, so the whole app is cached at install and opens without a network.
 */
function serviceWorker(): Plugin {
  const source = fileURLToPath(new URL('./src/sw/worker.js', import.meta.url));
  const publicDir = fileURLToPath(new URL('./public', import.meta.url));
  return {
    name: 'serva-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [
        ...Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'vite-manifest.json'),
        ...readdirSync(publicDir),
      ]
        .filter((f) => f !== 'index.html' && f !== 'sw.js')
        .sort();
      const hash = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      // Time first, so the worker can sort its caches by build and keep the newest two
      const build = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${hash}`;
      const code = readFileSync(source, 'utf8')
        .replace("'__SERVA_BUILD__'", JSON.stringify(build))
        .replace('/* __SERVA_FILES__ */ []', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
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
