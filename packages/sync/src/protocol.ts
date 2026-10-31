import { z } from 'zod';
import {
  validateDocumentPayload,
  type INVALID_PAYLOAD,
  type PayloadIssue,
} from '@serva/core/contracts/documents';
import { DOC_TYPES, seriesOf, type DocType } from './doc-types';
import { hashCanonical } from './hash';
import { parseDocNumber } from './numbering';
import { UUID_V7_PATTERN } from './uuid';

/**
 * Sync contract v1 (tab 15 › عقد المزامنة v1 للمهندسين; 17 › البيع والمزامنة). The device and the
 * server validate with these same schemas, so the two cannot drift.
 */

export const CONTRACT_VERSION = 1;
/** Versions the server still accepts (17: earlier versions for at least 90 days). */
export const SUPPORTED_CONTRACT_VERSIONS: readonly number[] = [1];

/** A push batch: up to 50 documents (17 › POST /v1/sync/push) … */
export const PUSH_MAX_DOCUMENTS = 50;
/** … and the device keeps its JSON under 4 MB, so even uncompressed it fits the server's limit. */
export const PUSH_TARGET_BYTES = 4 * 1024 * 1024;
/** What the server takes on the wire (gzip or not); above it answers an explicit 413. */
export const PUSH_MAX_WIRE_BYTES = 5 * 1024 * 1024;
/** Inflated size the server accepts from a gzip body, so a small "zip bomb" cannot exhaust memory. */
export const PUSH_MAX_INFLATED_BYTES = 24 * 1024 * 1024;
/** Rows per pull page (15 › السحب: صفحات 5,000 سطر). */
export const PULL_PAGE_SIZE = 5000;
/** Confirmed documents stay on the device this long, to be resent after a server restore. */
export const CONFIRMED_RETENTION_DAYS = 30;
/** A document may depend on this many others (e.g. a return on its sale). */
export const MAX_DEPS = 20;

const uuidV7 = z.string().regex(UUID_V7_PATTERN, 'not a UUIDv7');
const isoTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

export const docTypeSchema = z.enum(DOC_TYPES);

/** The fields that make a document what it is. Transport details (app version, send time) are not part of it. */
export interface SyncDocumentBody {
  id: string;
  /** Per-device creation order, 1, 2, 3… across all types: the server processes a device's documents in this order */
  seq: number;
  type: DocType;
  /** INV-001-002-0000154, or null for an unnumbered type */
  number: string | null;
  deviceTime: string;
  /** The business day printed on the receipt, computed by the device */
  businessDate: string;
  /** Device clock minus server clock at the last sync (ms) */
  deviceOffsetMs: number;
  /** Pricing engine version that computed the totals; the server recomputes with the same one */
  engineVersion: string;
  contractVersion: number;
  /** Ids this document depends on, e.g. the original sale of a return */
  deps: string[];
  payload: Record<string, unknown>;
}

export interface SyncDocument extends SyncDocumentBody {
  /** payloadHash(): sha256 of the canonical JSON of the body */
  hash: string;
}

/** The payload hash of a document: everything in its body, in canonical form. */
export function payloadHash(body: SyncDocumentBody): string {
  return hashCanonical({
    id: body.id,
    seq: body.seq,
    type: body.type,
    number: body.number,
    deviceTime: body.deviceTime,
    businessDate: body.businessDate,
    deviceOffsetMs: body.deviceOffsetMs,
    engineVersion: body.engineVersion,
    contractVersion: body.contractVersion,
    deps: body.deps,
    payload: body.payload,
  });
}

const lineSchema = z.looseObject({ lineNo: z.number().int().min(1) });

export const syncDocumentSchema = z
  .object({
    id: uuidV7,
    seq: z.number().int().min(1),
    type: docTypeSchema,
    number: z.string().max(32).nullable(),
    deviceTime: isoTime,
    businessDate: isoDate,
    deviceOffsetMs: z.number().int(),
    engineVersion: z.string().min(1).max(32),
    contractVersion: z.number().int().min(1),
    deps: z.array(uuidV7).max(MAX_DEPS),
    payload: z.record(z.string(), z.unknown()),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine((doc, ctx) => {
    const series = seriesOf(doc.type);
    if (series === null) {
      if (doc.number !== null) ctx.addIssue({ code: 'custom', path: ['number'], message: 'unnumbered type' });
    } else {
      const parsed = doc.number === null ? null : parseDocNumber(doc.number);
      if (!parsed || parsed.series !== series) {
        ctx.addIssue({ code: 'custom', path: ['number'], message: `expected a ${series} number` });
      }
    }
    // Every line carries a fixed line number (17 › حقول إلزامية): unique, so a resend or a
    // return can point at one line.
    const lines = doc.payload.lines;
    if (lines !== undefined) {
      const parsed = z.array(lineSchema).safeParse(lines);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: ['payload', 'lines'], message: 'every line needs lineNo' });
      } else if (new Set(parsed.data.map((l) => l.lineNo)).size !== parsed.data.length) {
        ctx.addIssue({ code: 'custom', path: ['payload', 'lines'], message: 'lineNo must be unique' });
      }
    }
    if (doc.deps.includes(doc.id)) {
      ctx.addIssue({ code: 'custom', path: ['deps'], message: 'a document cannot depend on itself' });
    }
  });

/**
 * The payload check of a document (packages/core › contracts/documents.ts), by its type: the
 * device runs it before saving a document, the server before processing one. It is kept out of
 * syncDocumentSchema on purpose: a malformed payload must cost only its own document
 * (`rejected` with `invalid_payload`), never a 400 for the whole batch (15 › المرفوض لا يوقف الطابور).
 * Types without a payload schema yet pass.
 */
export function documentPayloadRejection(
  doc: Pick<SyncDocumentBody, 'type' | 'payload'>,
): { code: typeof INVALID_PAYLOAD; issues: PayloadIssue[] } | null {
  const result = validateDocumentPayload(doc.type, doc.payload);
  return result.ok ? null : { code: result.code, issues: result.issues };
}

export const pushRequestSchema = z.object({
  contractVersion: z.number().int().min(1),
  appVersion: z.string().min(1).max(32),
  /** Device clock when the batch left, for the clock offset (15 › ساعة الجهاز) */
  sentAt: isoTime,
  /**
   * Heartbeat (15 › إشارة حياة): the last number the device issued per series, so the server knows
   * how many documents have not reached it yet, and which of a revoked device's to accept.
   */
  lastIssued: z.record(z.string().regex(/^[A-Z]{2,3}$/), z.number().int().min(0)).default({}),
  documents: z.array(syncDocumentSchema).min(1).max(PUSH_MAX_DOCUMENTS),
});
export type PushRequest = z.input<typeof pushRequestSchema>;

/**
 * The answer for one document (15 › جواب الخادم لكل مستند):
 * - accepted: stored;
 * - duplicate: the same id and the same hash arrived before, whenever that was; `outcome` is what
 *   the first arrival got, so a replay gets the same answer;
 * - pending_link: accepted, but it depends on a document of another device that has not arrived;
 *   linked by the server when it does (never "retry" between devices);
 * - id_conflict: the same id with a different hash: held for support, the queue goes on;
 * - rejected: structurally invalid (a payload that breaks its schema: invalid_payload; unbalanced,
 *   number reused by another document, depends on a rejected document of this device…), with a code;
 * - quarantined: from a revoked device, numbered after the last number it announced;
 * - retry: temporary pressure on the server only; never stops the rest of the batch.
 */
export const PUSH_STATUSES = [
  'accepted',
  'duplicate',
  'pending_link',
  'id_conflict',
  'rejected',
  'quarantined',
  'retry',
] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];
/** What a stored document ended as; a duplicate reports one of these as its outcome. */
export type StoredStatus = Exclude<PushStatus, 'duplicate' | 'retry' | 'id_conflict'>;

/**
 * Accept-and-flag (15 › اقبل ونبّه للمال): what happened in the shop is never refused; the server
 * accepts it and raises a flag for the manager.
 */
export const SYNC_FLAGS = [
  'permission_stale',
  'approval_offline',
  'totals_mismatch',
  'pending_link',
  'clock_skew',
  'license_expired',
  'negative_stock',
  'credit_limit_exceeded',
  'over_return',
  'posted_to_open_period',
] as const;
export type SyncFlag = (typeof SYNC_FLAGS)[number];

/**
 * The conflict codes of the contract, with what each means for the document. The device holds
 * documents that are `hold`; the others are confirmed.
 */
export const CONFLICT_CODES = {
  /** Same id, different content: held for support */
  id_conflict: 'hold',
  /** Depends on a document from another device not yet arrived: accepted, linked later */
  pending_link: 'accept',
  /** Sold with a permission withdrawn while the device was offline: accepted and flagged */
  permission_stale: 'accept',
  /** The server's recomputed totals differ from the printed ones: accepted, critical flag */
  totals_mismatch: 'accept',
} as const satisfies Record<string, 'accept' | 'hold'>;
export type ConflictCode = keyof typeof CONFLICT_CODES;

export interface PushResult {
  id: string;
  status: PushStatus;
  outcome?: StoredStatus;
  /** For rejected and quarantined: why, e.g. number_conflict, invalid_document */
  code?: string;
  flags: SyncFlag[];
  /** When the server first received it (the same on every replay) */
  receivedAt?: string;
}

export interface SyncCommands {
  /** Sets whose scope changed: download them again from scratch */
  resync?: string[];
  /** Pull now (something changed for this device) */
  pullNow?: boolean;
  /** The device was revoked: after sending what it holds, it wipes its data */
  wipe?: boolean;
}

export interface PushResponse {
  contractVersion: number;
  /** Changes when the server is restored from a backup (15 › الحقبة بعد الاستعادة) */
  serverEpoch: number;
  serverTime: string;
  /**
   * The highest seq the server held from this device before this batch. A restore loses the end
   * of a device's documents, so anything the device had confirmed above it must be sent again.
   */
  resendFrom: number;
  results: PushResult[];
  commands: SyncCommands;
}

/**
 * A pull cursor: the change_xid watermark of a set, optionally with the last id inside that
 * transaction when a page ended in the middle of it. "0" downloads the set from the start.
 */
export const CURSOR_PATTERN =
  /^(0|[1-9]\d{0,19})(\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;
export const INITIAL_CURSOR = '0';

export const pullQuerySchema = z.object({
  /** JSON object { set: cursor }; sets not listed are not pulled. Empty: every set from the start. */
  cursors: z
    .string()
    .max(4096)
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return {};
      try {
        return z
          .record(z.string().regex(/^[a-z_]{1,32}$/), z.string().regex(CURSOR_PATTERN))
          .parse(JSON.parse(raw));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'cursors must be a JSON object of set → cursor' });
        return z.NEVER;
      }
    }),
  limit: z.coerce.number().int().min(1).max(PULL_PAGE_SIZE).default(PULL_PAGE_SIZE),
});

export interface PullSetPage {
  /** Rows changed after the cursor; each has an `id` */
  upserts: Array<Record<string, unknown> & { id: string }>;
  /** Ids deleted after the cursor (from sync_tombstones) */
  deletes: string[];
  cursor: string;
}

export interface PullResponse {
  contractVersion: number;
  serverEpoch: number;
  serverTime: string;
  sets: Record<string, PullSetPage>;
  /** More pages wait: pull again with the new cursors */
  hasMore: boolean;
  commands: SyncCommands;
}

export const resyncRequestSchema = z.object({
  sets: z
    .array(z.string().regex(/^[a-z_]{1,32}$/))
    .min(1)
    .max(32),
});

/**
 * The first download (17 › GET /v1/sync/bootstrap; 15 › السحب إلى الجهاز): one gzip NDJSON file
 * of every set (snapshot.ts), downloaded from `url` with HTTP Range resume (device-authenticated),
 * checked against `sha256`, then pulled from `cursors`. A resync answers the same shape for the
 * sets it names.
 */
export interface SnapshotInfo {
  snapshotId: string;
  /** Path under the API origin: /v1/sync/snapshots/<id> */
  url: string;
  /** Size of the gzip file */
  bytes: number;
  /** sha256 of the gzip file, hex */
  sha256: string;
  /** Per set: pull from here once the snapshot is applied */
  cursors: Record<string, string>;
  serverEpoch: number;
  /** The file can be downloaded until then */
  expiresAt: string;
}

export interface BootstrapResponse extends SnapshotInfo {
  contractVersion: number;
  serverTime: string;
}

/** POST /v1/sync/resync: a snapshot of the sets it names, in the bootstrap's shape. */
export interface ResyncResponse extends BootstrapResponse {
  /** Per set: start from cursor 0, or apply the snapshot at snapshotUrl and pull from `cursors` */
  sets: Record<string, { cursor: string; snapshotUrl: string | null }>;
}

/**
 * Heartbeat (17 › POST /v1/sync/heartbeat; 15 › إشارة حياة): the last number issued per series,
 * what still waits to be sent, the app version, the clock (from sentAt) and the space used. The
 * server compares the numbers with what reached it and shows the owner what is missing.
 */
export const heartbeatRequestSchema = z.object({
  contractVersion: z.number().int().min(1),
  appVersion: z.string().min(1).max(32),
  sentAt: isoTime,
  lastIssued: z.record(z.string().regex(/^[A-Z]{2,3}$/), z.number().int().min(0)).default({}),
  unsentCount: z.number().int().min(0).max(10_000_000),
  storageUsedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
});
export type HeartbeatRequest = z.input<typeof heartbeatRequestSchema>;

export interface HeartbeatResponse {
  contractVersion: number;
  serverEpoch: number;
  serverTime: string;
  commands: SyncCommands;
}
