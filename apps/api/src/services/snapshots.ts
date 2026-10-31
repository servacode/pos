import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { withTenant, type Database } from '@serva/db';
import {
  CONTRACT_VERSION,
  INITIAL_CURSOR,
  PULL_PAGE_SIZE,
  type BootstrapResponse,
  type ResyncResponse,
  type SnapshotLine,
} from '@serva/sync';
import type { DeviceClaims } from '../auth/device-guard';
import { currentXmin, PULL_SET_NAMES, pullSetPage, unknownSets } from './sync-pull';
import { readServerState } from './sync-state';

/**
 * Bootstrap snapshots (17 › GET /v1/sync/bootstrap; 15 › السحب إلى الجهاز): one gzip NDJSON file of
 * the sets a device keeps, built from the same set builders the pull uses, at one xmin bound, so
 * applying it and then pulling from its cursors gives exactly a full pull. Files live in
 * SNAPSHOT_DIR until they expire; a new device of the same branch reuses a recent one instead of
 * reading the whole store again.
 */

export interface SnapshotMeta {
  id: string;
  tenantId: string;
  branchId: string;
  sets: string[];
  serverEpoch: number;
  createdAt: string;
  expiresAt: string;
  bytes: number;
  sha256: string;
  cursors: Record<string, string>;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const snapshotUrl = (id: string) => `/v1/sync/snapshots/${id}`;

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export class SnapshotStore {
  constructor(
    readonly dir: string,
    readonly ttlMs: number,
  ) {}

  private dataPath(id: string) {
    return join(this.dir, `${id}.ndjson.gz`);
  }

  private metaPath(id: string) {
    return join(this.dir, `${id}.json`);
  }

  private keyPath(key: string) {
    return join(this.dir, `key-${key}.json`);
  }

  private async readMeta(id: string): Promise<SnapshotMeta | null> {
    if (!ID_PATTERN.test(id)) return null;
    try {
      return JSON.parse(await readFile(this.metaPath(id), 'utf8')) as SnapshotMeta;
    } catch {
      return null;
    }
  }

  /**
   * A snapshot of these sets for the device's store and branch: a recent one (younger than half
   * the TTL, same server epoch) or a new one.
   */
  async snapshotFor(db: Database, device: DeviceClaims, sets: string[], now: Date): Promise<SnapshotMeta> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.sweep(now);
    const names = [...new Set(sets)].sort();
    const key = createHash('sha256')
      .update(JSON.stringify([device.tenantId, device.branchId, names]))
      .digest('hex');
    const epoch = await withTenant(
      db,
      device.tenantId,
      async (tx) => (await readServerState(tx)).serverEpoch,
    );
    try {
      const { id } = JSON.parse(await readFile(this.keyPath(key), 'utf8')) as { id: string };
      const meta = await this.readMeta(id);
      if (
        meta &&
        meta.tenantId === device.tenantId &&
        meta.serverEpoch === epoch &&
        Date.parse(meta.createdAt) + this.ttlMs / 2 > now.getTime()
      ) {
        return meta;
      }
    } catch {
      // No recent snapshot for this key.
    }
    const meta = await this.build(db, device, names, now);
    await writeFile(this.keyPath(key), JSON.stringify({ id: meta.id }), { mode: 0o600 });
    return meta;
  }

  private async build(db: Database, device: DeviceClaims, sets: string[], now: Date): Promise<SnapshotMeta> {
    const id = randomUUID();
    const temp = join(this.dir, `${id}.tmp`);
    const gzip = createGzip();
    const written = pipeline(gzip, createWriteStream(temp, { mode: 0o600 }));
    const write = async (line: SnapshotLine) => {
      if (!gzip.write(`${JSON.stringify(line)}\n`)) await once(gzip, 'drain');
    };
    try {
      const { serverEpoch, cursors } = await withTenant(db, device.tenantId, async (tx) => {
        const state = await readServerState(tx);
        // One bound for every page and set: the file is one consistent cut of the store.
        const xmin = await currentXmin(tx);
        await write({
          kind: 'header',
          snapshotId: id,
          contractVersion: CONTRACT_VERSION,
          serverEpoch: state.serverEpoch,
          createdAt: now.toISOString(),
          sets,
        });
        const cursors: Record<string, string> = {};
        let rows = 0;
        for (const set of sets) {
          let cursor = INITIAL_CURSOR;
          for (;;) {
            const { page, hasMore } = await pullSetPage(
              tx,
              device.tenantId,
              set,
              cursor,
              xmin,
              PULL_PAGE_SIZE,
            );
            for (const row of page.upserts) await write({ kind: 'row', set, row });
            for (const deleted of page.deletes) await write({ kind: 'delete', set, id: deleted });
            rows += page.upserts.length;
            cursor = page.cursor;
            if (!hasMore) break;
          }
          cursors[set] = cursor;
          await write({ kind: 'cursor', set, cursor });
        }
        await write({ kind: 'end', rows });
        return { serverEpoch: state.serverEpoch, cursors };
      });
      gzip.end();
      await written;
      const meta: SnapshotMeta = {
        id,
        tenantId: device.tenantId,
        branchId: device.branchId,
        sets,
        serverEpoch,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
        bytes: (await stat(temp)).size,
        sha256: await sha256File(temp),
        cursors,
      };
      await rename(temp, this.dataPath(id));
      await writeFile(this.metaPath(id), JSON.stringify(meta), { mode: 0o600 });
      return meta;
    } catch (error) {
      gzip.destroy();
      await written.catch(() => undefined);
      await rm(temp, { force: true });
      throw error;
    }
  }

  /** The snapshot file for a device of this store, or null (unknown, another store's, expired). */
  async open(id: string, tenantId: string, now: Date): Promise<{ meta: SnapshotMeta; path: string } | null> {
    const meta = await this.readMeta(id);
    if (!meta || meta.tenantId !== tenantId || Date.parse(meta.expiresAt) <= now.getTime()) return null;
    return { meta, path: this.dataPath(id) };
  }

  /** Deletes expired snapshots (and their key pointers), and temp files of failed builds. */
  async sweep(now: Date): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    const expired = new Set<string>();
    for (const name of names) {
      const match = /^(.+)\.json$/.exec(name);
      if (!match || name.startsWith('key-')) continue;
      const meta = await this.readMeta(match[1]!);
      if (meta && Date.parse(meta.expiresAt) <= now.getTime()) expired.add(meta.id);
    }
    for (const id of expired) {
      await rm(this.dataPath(id), { force: true });
      await rm(this.metaPath(id), { force: true });
    }
    for (const name of names) {
      if (!name.startsWith('key-')) continue;
      try {
        const { id } = JSON.parse(await readFile(join(this.dir, name), 'utf8')) as { id: string };
        if (expired.has(id) || !(await this.readMeta(id))) await rm(join(this.dir, name), { force: true });
      } catch {
        await rm(join(this.dir, name), { force: true });
      }
    }
  }
}

const answer = (meta: SnapshotMeta, now: Date): BootstrapResponse => ({
  contractVersion: CONTRACT_VERSION,
  serverTime: now.toISOString(),
  snapshotId: meta.id,
  url: snapshotUrl(meta.id),
  bytes: meta.bytes,
  sha256: meta.sha256,
  cursors: meta.cursors,
  serverEpoch: meta.serverEpoch,
  expiresAt: meta.expiresAt,
});

/** GET /v1/sync/bootstrap: every set the device keeps. */
export async function bootstrapSnapshot(
  db: Database,
  store: SnapshotStore,
  device: DeviceClaims,
  now: Date,
): Promise<BootstrapResponse> {
  return answer(await store.snapshotFor(db, device, PULL_SET_NAMES, now), now);
}

/**
 * POST /v1/sync/resync: the named sets again (the device's scope changed or its copy was damaged),
 * as a snapshot like the bootstrap.
 */
export async function resyncSnapshot(
  db: Database,
  store: SnapshotStore,
  device: DeviceClaims,
  sets: string[],
  now: Date,
): Promise<ResyncResponse> {
  unknownSets(sets);
  const meta = await store.snapshotFor(db, device, sets, now);
  return {
    ...answer(meta, now),
    sets: Object.fromEntries(
      meta.sets.map((set) => [set, { cursor: INITIAL_CURSOR, snapshotUrl: snapshotUrl(meta.id) }]),
    ),
  };
}
