/* The service worker (tab 15 › فتح التطبيق دون اتصال). A till that reloads, or a phone that opens
 * the app again, while the shop's network is down must still get the app: sales are kept on the
 * device (IndexedDB) and sent later, so the only thing the browser lacks offline is the app itself.
 *
 * - Install: the whole app (index.html and every file of this build) goes into a cache named after
 *   the build, before the worker takes over.
 * - Pages: from the network first, so an online load always gets the latest release and its fresh
 *   security nonce; the cached copy (stored with its own headers, nonce included) only when the
 *   network fails or takes longer than NAVIGATION_TIMEOUT_MS.
 * - Files of the build: from the cache, they never change under the same name.
 * - The API (/v1/, /health) and anything from another origin: never touched. Money and documents
 *   only go through the sync client, never through a cache.
 * - Old builds: the newest two caches are kept, so a page still open on the previous release can
 *   load a screen it has not opened yet; older ones are deleted.
 *
 * apps/web/vite.config.ts fills in BUILD and FILES when it writes dist/sw.js.
 */
/* global self, caches */
const BUILD = '__SERVA_BUILD__';
const FILES = /* __SERVA_FILES__ */ [];

const PREFIX = 'serva-app-';
const CACHE = `${PREFIX}${BUILD}`;
const NAVIGATION_TIMEOUT_MS = 4000;
const KEEP_BUILDS = 2;

function bypass(url) {
  return url.pathname.startsWith('/v1/') || url.pathname === '/health';
}

async function install() {
  const cache = await caches.open(CACHE);
  await cache.addAll(['/index.html', ...FILES.map((f) => `/${f}`)]);
}

/** Build names start with the build time, so sorting them sorts the builds. */
async function cleanup() {
  const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).sort();
  const old = names.filter((n) => n !== CACHE).slice(0, Math.max(0, names.length - KEEP_BUILDS));
  await Promise.all(old.map((n) => caches.delete(n)));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function page(request) {
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (response.ok && (response.headers.get('Content-Type') ?? '').startsWith('text/html')) {
      const cache = await caches.open(CACHE);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cached =
      (await (await caches.open(CACHE)).match('/index.html')) ?? (await caches.match('/index.html'));
    return (
      cached ??
      new Response(
        '<!doctype html><meta charset="utf-8"><p dir="rtl">لا اتصال بالخادم، ولم يُحفظ التطبيق على هذا الجهاز بعد.</p>',
        {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    );
  }
}

async function file(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname.startsWith('/assets/')) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/** What the worker answers for this request, or null to let the browser fetch it as usual. */
function route(request, origin) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== origin || bypass(url)) return null;
  if (request.mode === 'navigate') return page(request);
  return file(request);
}

self.addEventListener('install', (event) => {
  event.waitUntil(install().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanup().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const answer = route(event.request, self.location.origin);
  if (answer) event.respondWith(answer);
});
