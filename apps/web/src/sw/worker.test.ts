import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { registerServiceWorker } from './register';
import SOURCE from './worker.js?raw';

/**
 * The service worker (worker.js) run in a sandbox with a fake Cache Storage and network: it keeps
 * the app for offline opening, and never stands between the app and the API.
 */

const ORIGIN = 'https://192.168.1.20';

class FakeCache {
  entries = new Map<string, Response>();
  async addAll(urls: string[]) {
    for (const u of urls)
      this.entries.set(u, new Response(`file ${u}`, { headers: { 'Content-Type': 'text/plain' } }));
  }
  async put(key: string | Request, response: Response) {
    this.entries.set(keyOf(key), response);
  }
  async match(key: string | Request) {
    return this.entries.get(keyOf(key))?.clone();
  }
  async keys() {
    return [...this.entries.keys()];
  }
}
const keyOf = (key: string | Request) => (typeof key === 'string' ? key : new URL(key.url).pathname);

function sandbox(
  options: { build?: string; files?: string[]; network?: (r: Request) => Promise<Response> } = {},
) {
  const stores = new Map<string, FakeCache>();
  const listeners = new Map<string, (event: unknown) => void>();
  const fetched: string[] = [];
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: string | Request) => {
      for (const cache of stores.values()) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const code = SOURCE.replace(
    "'__SERVA_BUILD__'",
    JSON.stringify(options.build ?? '20261103000000000-abc'),
  ).replace(
    '/* __SERVA_FILES__ */ []',
    JSON.stringify(options.files ?? ['assets/index-1.js', 'assets/index-1.css', 'favicon.svg']),
  );
  const network =
    options.network ??
    (async (r: Request) =>
      new Response(`net ${new URL(r.url).pathname}`, {
        headers: {
          'Content-Type': new URL(r.url).pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
        },
      }));
  runInNewContext(code, {
    self,
    caches,
    fetch: (r: Request) => {
      fetched.push(new URL(r.url).pathname);
      return network(r);
    },
    URL,
    Response,
    setTimeout,
    clearTimeout,
    Promise,
  });

  const lifecycle = async (type: 'install' | 'activate') => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  /** The worker's answer, or null when it lets the browser fetch on its own. */
  const request = async (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => {
    const req = {
      url: `${init.origin ?? ORIGIN}${path}`,
      method: init.method ?? 'GET',
      mode: init.mode ?? 'cors',
    } as unknown as Request;
    const box: { answer: Promise<Response> | null } = { answer: null };
    listeners.get('fetch')!({ request: req, respondWith: (p: Promise<Response>) => (box.answer = p) });
    return box.answer ? await box.answer : null;
  };
  return { stores, lifecycle, request, fetched };
}

describe('the service worker', () => {
  it('stores the whole app at install, in a cache named after the build', async () => {
    const sw = sandbox();
    await sw.lifecycle('install');
    expect([...sw.stores.keys()]).toEqual(['serva-app-20261103000000000-abc']);
    expect(await sw.stores.get('serva-app-20261103000000000-abc')!.keys()).toEqual([
      '/index.html',
      '/assets/index-1.js',
      '/assets/index-1.css',
      '/favicon.svg',
    ]);
  });

  it('opens a page from the network when there is one, and from the cache when there is not', async () => {
    let online = true;
    const sw = sandbox({
      network: async (r) => {
        if (!online) throw new TypeError('Failed to fetch');
        return new Response(`fresh ${new URL(r.url).pathname}`, { headers: { 'Content-Type': 'text/html' } });
      },
    });
    await sw.lifecycle('install');
    expect(await (await sw.request('/pos', { mode: 'navigate' }))!.text()).toBe('fresh /pos');
    // The fresh page (with its own nonce) replaced the copy kept for offline
    online = false;
    const offline = await sw.request('/products', { mode: 'navigate' });
    expect(offline!.status).toBe(200);
    expect(await offline!.text()).toBe('fresh /pos');
  });

  it('never keeps a non-HTML navigation as the app page', async () => {
    let online = true;
    const sw = sandbox({
      network: async () => {
        if (!online) throw new TypeError('offline');
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });
    await sw.lifecycle('install');
    await sw.request('/something.json', { mode: 'navigate' });
    online = false;
    expect(await (await sw.request('/pos', { mode: 'navigate' }))!.text()).toBe('file /index.html');
  });

  it('says plainly when the app was never stored and the network is down', async () => {
    const sw = sandbox({
      network: async () => {
        throw new TypeError('offline');
      },
    });
    const answer = await sw.request('/pos', { mode: 'navigate' });
    expect(answer!.status).toBe(503);
    expect(await answer!.text()).toContain('لا اتصال بالخادم');
  });

  it('serves the build files from the cache, without the network', async () => {
    const sw = sandbox();
    await sw.lifecycle('install');
    sw.fetched.length = 0;
    expect(await (await sw.request('/assets/index-1.js'))!.text()).toBe('file /assets/index-1.js');
    expect(sw.fetched).toEqual([]);
  });

  it('keeps a screen loaded later for the next offline open', async () => {
    const sw = sandbox();
    await sw.lifecycle('install');
    await sw.request('/assets/Lazy-2.js');
    expect(sw.fetched).toEqual(['/assets/Lazy-2.js']);
    sw.fetched.length = 0;
    expect(await (await sw.request('/assets/Lazy-2.js'))!.text()).toBe('net /assets/Lazy-2.js');
    expect(sw.fetched).toEqual([]);
  });

  it('leaves the API, other methods and other origins alone', async () => {
    const sw = sandbox();
    await sw.lifecycle('install');
    expect(await sw.request('/v1/sync/push', { method: 'POST' })).toBeNull();
    expect(await sw.request('/v1/me')).toBeNull();
    expect(await sw.request('/health')).toBeNull();
    expect(await sw.request('/assets/x.js', { origin: 'https://cdn.example' })).toBeNull();
    expect(sw.fetched).toEqual([]);
  });

  it('keeps the newest two builds and deletes older ones', async () => {
    const sw = sandbox({ build: '20261103000000003-ccc' });
    for (const name of [
      'serva-app-20261103000000001-aaa',
      'serva-app-20261103000000002-bbb',
      'other-cache',
    ]) {
      sw.stores.set(name, new FakeCache());
    }
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect([...sw.stores.keys()].sort()).toEqual([
      'other-cache',
      'serva-app-20261103000000002-bbb',
      'serva-app-20261103000000003-ccc',
    ]);
  });
});

describe('registering the worker', () => {
  it('registers /sw.js in a production build only', async () => {
    const calls: string[] = [];
    const nav = {
      serviceWorker: {
        register: async (url: string) => {
          calls.push(url);
          return {} as ServiceWorkerRegistration;
        },
      },
    } as unknown as Pick<Navigator, 'serviceWorker'>;
    registerServiceWorker(nav, false);
    expect(calls).toEqual([]);
    registerServiceWorker(nav, true);
    expect(calls).toEqual(['/sw.js']);
  });

  it('does nothing where the browser has no service workers', () => {
    expect(() => registerServiceWorker({} as Pick<Navigator, 'serviceWorker'>, true)).not.toThrow();
  });
});
