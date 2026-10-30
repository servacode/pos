// Performance budget (tab 00 › الجودة, tab 23): checked on every merge after `pnpm build`.
// - The sale screen (/pos) loads under 300 KB of JS + CSS after gzip.
// - Each lazily loaded chunk stays under 60 KB gzip.
// - Fonts have their own budget: the woff2 files the cashier keeps (Arabic + Latin, 3 weights).
// File lists come from Vite's manifest, so they follow the real chunk graph whatever Rollup names
// or shares.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const manifestUrl = new URL('./dist/vite-manifest.json', import.meta.url);
if (!existsSync(manifestUrl)) {
  throw new Error('dist/vite-manifest.json is missing: run `pnpm --filter @serva/web build` first.');
}
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

/** Every JS and CSS file the browser needs for these manifest entries and their static imports. */
function filesFor(...keys) {
  const files = new Set();
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`${key} is not in the Vite manifest.`);
    if (files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  keys.forEach(visit);
  return [...files].map((file) => `dist/${file}`);
}

const lazyChunks = Object.entries(manifest)
  .filter(([, chunk]) => chunk.isDynamicEntry)
  .map(([key, chunk]) => ({
    name: `Lazy chunk ${key} (JS + CSS, gzip)`,
    path: [chunk.file, ...(chunk.css ?? [])].map((file) => `dist/${file}`),
    gzip: true,
    limit: '60 kB',
  }));

const cashierFonts = readdirSync(new URL('./dist/assets/', import.meta.url))
  .filter((file) => /^ibm-plex-sans-arabic-(arabic|latin)-\d00-normal-.*\.woff2$/.test(file))
  .map((file) => `dist/assets/${file}`);

export default [
  {
    name: 'Sale screen /pos (JS + CSS, gzip)',
    path: filesFor('index.html', 'src/pos/PosApp.tsx'),
    gzip: true,
    limit: '300 kB',
  },
  ...lazyChunks,
  {
    name: 'Cashier fonts (woff2: Arabic + Latin, 400/600/700)',
    path: cashierFonts,
    brotli: false,
    limit: '200 kB',
  },
];
