// Performance budget (tab 00 › الجودة, tab 23): checked on every merge after `pnpm build`.
// - The sale screen (/pos) loads under 300 KB of JS + CSS after gzip.
// - Each lazily loaded chunk stays under 60 KB gzip.
// - The stylesheet (the @serva/ui theme and every class its components use) stays under 15 KB gzip.
// - Fonts have their own budget: the woff2 files the cashier keeps (Arabic + Latin, 3 weights).
// File lists come from Vite's manifest, so they follow the real chunk graph whatever Rollup names
// or shares.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const manifestUrl = new URL('./dist/vite-manifest.json', import.meta.url);
if (!existsSync(manifestUrl)) {
  throw new Error('dist/vite-manifest.json is missing: run `pnpm --filter @serva/web build` first.');
}
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

// The component gallery (/dev/ui) is for dev builds only and must never ship.
const devOnly = Object.keys(manifest).filter((key) => key.startsWith('src/dev/'));
if (devOnly.length > 0) {
  throw new Error(`Dev-only code reached the production build: ${devOnly.join(', ')}`);
}

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

// The cashier chunk. Vite keys it by its source file, or by `_PosApp-<hash>.js` once another
// chunk (the device-linking screens) imports from it.
const posKey =
  'src/pos/PosApp.tsx' in manifest
    ? 'src/pos/PosApp.tsx'
    : Object.keys(manifest).find((key) => manifest[key].isDynamicEntry && manifest[key].name === 'PosApp');

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
    path: filesFor('index.html', posKey),
    gzip: true,
    limit: '300 kB',
  },
  ...lazyChunks,
  {
    name: 'Stylesheet: @serva/ui theme and component classes (gzip)',
    path: manifest['index.html'].css.map((file) => `dist/${file}`),
    gzip: true,
    limit: '15 kB',
  },
  {
    name: 'Cashier fonts (woff2: Arabic + Latin, 400/600/700)',
    path: cashierFonts,
    brotli: false,
    limit: '200 kB',
  },
];
