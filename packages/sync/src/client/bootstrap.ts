import type { SnapshotInfo } from '../protocol';
import { parseSnapshot, SnapshotFormatError, type ParsedSnapshot } from '../snapshot';
import { backoffDelay } from './backoff';
import type { SyncStore } from './store';
import type { SyncTransport, TransportResult } from './transport';

export interface BootstrapProgress {
  /** Bytes of the file received so far */
  received: number;
  total: number;
}

export type BootstrapFailure =
  /** The device token was refused, or the device revoked */
  | 'unauthorized'
  | 'revoked'
  /** The server refused the request itself */
  | 'refused'
  /** The connection kept failing, or the server stayed busy */
  | 'network'
  /** The file arrived damaged (size, sha256 or content) more than once */
  | 'corrupt';

export class BootstrapError extends Error {
  override readonly name = 'BootstrapError';
  constructor(readonly reason: BootstrapFailure) {
    super(`bootstrap failed: ${reason}`);
  }
}

export interface DownloadSnapshotOptions {
  onProgress?: (progress: BootstrapProgress) => void;
  /** Failed connections in a row before giving up (default 8) */
  maxAttempts?: number;
  /** Waits between tries; growing delays from backoff.ts by default */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function stopReason(res: Extract<TransportResult<unknown>, { ok: false }>): BootstrapFailure | null {
  if (res.kind === 'unauthorized' || res.kind === 'revoked' || res.kind === 'refused') return res.kind;
  return null;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function gunzipText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Downloads a snapshot file, asking only for the rest after a cut connection (HTTP Range), then
 * checks its size and sha256 and reads it. Throws BootstrapError.
 */
export async function downloadSnapshot(
  transport: SyncTransport,
  info: SnapshotInfo,
  options: DownloadSnapshotOptions = {},
): Promise<ParsedSnapshot> {
  const { onProgress, maxAttempts = 8, sleep = realSleep, random = Math.random } = options;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let failures = 0;
  onProgress?.({ received, total: info.bytes });
  for (;;) {
    const before = received;
    const res = await transport.download(info.url, {
      offset: received,
      etag: `"${info.sha256}"`,
      onData: (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        onProgress?.({ received, total: info.bytes });
      },
      onRestart: () => {
        chunks.length = 0;
        received = 0;
      },
    });
    // A file longer than announced is damaged; a shorter one asks for the rest.
    if (received > info.bytes) throw new BootstrapError('corrupt');
    if (res.ok && received === info.bytes) break;
    if (!res.ok) {
      const stop = stopReason(res);
      if (stop) throw new BootstrapError(stop);
    }
    // A connection that brought something is not counted against the next tries.
    failures = received > before ? 1 : failures + 1;
    if (failures >= maxAttempts) throw new BootstrapError('network');
    const wait = !res.ok && res.kind === 'busy' ? res.retryAfterMs : null;
    await sleep(wait ?? backoffDelay(failures, random));
  }

  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  if (bytes.length !== info.bytes || (await sha256Hex(bytes)) !== info.sha256) {
    throw new BootstrapError('corrupt');
  }
  try {
    const parsed = parseSnapshot(await gunzipText(bytes));
    if (parsed.snapshotId !== info.snapshotId) throw new BootstrapError('corrupt');
    return parsed;
  } catch (error) {
    if (error instanceof SnapshotFormatError || error instanceof TypeError)
      throw new BootstrapError('corrupt');
    throw error;
  }
}

export interface RunBootstrapOptions extends DownloadSnapshotOptions {
  store: SyncStore;
  transport: SyncTransport;
  now?: () => number;
}

/**
 * The first download of a newly activated device (15 › التثبيت خطوة بخطوة، التنزيل): asks for a
 * snapshot, downloads it with resume, checks it, then applies every set and saves the cursors and
 * the server epoch in one local transaction. The pull then carries on from those cursors. A file
 * that expired or arrived damaged is asked for again once.
 */
export async function runBootstrap(options: RunBootstrapOptions): Promise<void> {
  const { store, transport, now = Date.now, sleep = realSleep, random = Math.random } = options;
  const maxAttempts = options.maxAttempts ?? 8;
  let retried = false;
  for (;;) {
    let failures = 0;
    let answer = await transport.bootstrap();
    while (!answer.ok) {
      const stop = stopReason(answer);
      if (stop) throw new BootstrapError(stop);
      failures += 1;
      if (failures >= maxAttempts) throw new BootstrapError('network');
      await sleep(
        answer.kind === 'busy' && answer.retryAfterMs ? answer.retryAfterMs : backoffDelay(failures, random),
      );
      answer = await transport.bootstrap();
    }
    const info = answer.body;
    try {
      const snapshot = await downloadSnapshot(transport, info, { ...options, sleep, random, maxAttempts });
      await store.applySnapshot(
        { sets: snapshot.sets, cursors: snapshot.cursors, serverEpoch: snapshot.serverEpoch },
        now(),
      );
      return;
    } catch (error) {
      // An expired file (404) or a damaged one: ask for a snapshot again, once.
      const again =
        error instanceof BootstrapError &&
        (error.reason === 'corrupt' || error.reason === 'refused') &&
        !retried;
      if (!again) throw error;
      retried = true;
    }
  }
}
