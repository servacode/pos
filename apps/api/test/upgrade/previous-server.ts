import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * The previous version of this server (N−1), run from the repository's own history: the commit
 * just before the latest migration was added, checked out beside this one and started as its own
 * process against the upgrade test's database. It is what writes a shop's books before the
 * upgrade, so a migration that only adds a table or a column is tested as it ships: the old code
 * never knew of it, and the new code meets it only after the migration ran (deploy/local/compose.yml
 * starts the API once `migrate` has finished).
 *
 * When the latest migration is not committed yet (work in progress), the previous version is HEAD.
 */

const repoRoot = resolve(import.meta.dirname, '../../../..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

/** The commit whose code wrote the books at the previous schema. */
export function previousCommit(lastMigrationTag: string): string {
  const added = git(
    'log',
    '--diff-filter=A',
    '--format=%H',
    '-1',
    '--',
    `packages/db/drizzle/${lastMigrationTag}.sql`,
  );
  return added ? `${added}^` : 'HEAD';
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Checks the commit out and links this checkout's installed packages into it. */
function checkout(commit: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'serva-previous-'));
  rmSync(folder, { recursive: true });
  git('worktree', 'add', '--quiet', '--detach', '--force', folder, commit);
  symlinkSync(join(repoRoot, 'node_modules'), join(folder, 'node_modules'));
  // Each package's own node_modules holds relative links (to the store and to the workspace's
  // packages), so a copy of the links resolves inside the old checkout.
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(repoRoot, group))) {
      const from = join(repoRoot, group, name, 'node_modules');
      const to = join(folder, group, name);
      if (existsSync(from) && existsSync(to)) {
        cpSync(from, join(to, 'node_modules'), { recursive: true, verbatimSymlinks: true });
      }
    }
  }
  return folder;
}

interface Injected {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json: <T = unknown>() => T;
}

export interface PreviousServer {
  commit: string;
  /** Enough of FastifyInstance for the test fixtures: inject() over HTTP */
  app: FastifyInstance;
  stop: () => Promise<void>;
}

export async function startPreviousServer(
  commit: string,
  env: { DATABASE_URL: string; JWT_SECRET: string },
): Promise<PreviousServer> {
  const folder = checkout(commit);
  const port = await freePort();
  const limits = Object.fromEntries(
    [
      'RATE_LIMIT_PER_MINUTE',
      'AUTH_RATE_LIMIT_PER_MINUTE',
      'LOGIN_PHONE_LIMIT_PER_HOUR',
      'REGISTER_PHONE_LIMIT_PER_HOUR',
      'SESSION_RATE_LIMIT_PER_MINUTE',
      'STORE_RATE_LIMIT_PER_MINUTE',
      'DEVICE_RATE_LIMIT_PER_MINUTE',
      'SYNC_PUSH_RATE_LIMIT_PER_MINUTE',
      'ACTIVATE_RATE_LIMIT_PER_MINUTE',
      'ACTIVATE_STORE_LIMIT_PER_HOUR',
    ].map((k) => [k, '100000']),
  );
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: join(folder, 'apps', 'api'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      DEPLOYMENT: 'local',
      // The sign-up answer carries its code: no message is sent from a test.
      OTP_DELIVERY: 'screen',
      LOG_LEVEL: 'warn',
      COOKIE_SECURE: 'false',
      ...limits,
      ...env,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      await exited;
    }
    try {
      git('worktree', 'remove', '--force', folder);
    } catch {
      rmSync(folder, { recursive: true, force: true });
      git('worktree', 'prune');
    }
  };

  // Up when it answers its health check, within a minute (tsx compiles on the way).
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`the previous server (${commit}) exited with ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${base}/v1/meta`);
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`the previous server (${commit}) did not start within a minute`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const inject = async (opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<Injected> => {
    const res = await fetch(`${base}${opts.url}`, {
      method: opts.method,
      headers: {
        ...(opts.payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...opts.headers,
      },
      body: opts.payload === undefined ? undefined : JSON.stringify(opts.payload),
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      body,
      headers: Object.fromEntries(res.headers),
      json: <T>() => JSON.parse(body) as T,
    };
  };
  return { commit, app: { inject } as unknown as FastifyInstance, stop };
}
