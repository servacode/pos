/**
 * Boundary tests for the sync contract (ADR-0001, task M0-2).
 *
 * Mutation testing of protocol.ts scored 59.74%: the suite checked that a well-formed
 * request is accepted and an obviously broken one refused, but never the edges of each
 * bound. So a mutant that turned `min(1)` into `max(1)`, or dropped the `^`/`$` of a
 * pattern, survived — and each of those is a request the server would wrongly accept.
 *
 * Every test below names the mutant it kills. They assert the contract, not the code:
 * each one is a request a device can really send.
 */
import { describe, expect, it } from 'vitest';
import {
  CURSOR_PATTERN,
  INITIAL_CURSOR,
  MAX_SEQUENCE,
  PULL_PAGE_SIZE,
  PUSH_MAX_DOCUMENTS,
  formatDocNumber,
  heartbeatRequestSchema,
  payloadHash,
  pullQuerySchema,
  pushRequestSchema,
  resyncRequestSchema,
  syncDocumentSchema,
  type SyncDocument,
  type SyncDocumentBody,
} from '../src';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

function makeBody(overrides: Partial<SyncDocumentBody> = {}): SyncDocumentBody {
  return {
    id: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b',
    seq: 1,
    type: 'sale',
    number: 'INV-001-002-0000001',
    deviceTime: '2026-10-30T10:00:00.000Z',
    businessDate: '2026-10-30',
    deviceOffsetMs: 0,
    engineVersion: '1.0.0',
    contractVersion: 1,
    deps: [],
    payload: { total: 1500, lines: [{ lineNo: 1, qty: 1000 }] },
    ...overrides,
  };
}
const makeDoc = (overrides: Partial<SyncDocumentBody> = {}): SyncDocument => {
  const body = makeBody(overrides);
  return { ...body, hash: payloadHash(body) };
};

const pushRequest = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  appVersion: '1.0.0',
  sentAt: '2026-10-30T10:00:00.000Z',
  documents: [makeDoc()],
  ...overrides,
});
const heartbeat = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  appVersion: '1.0.0',
  sentAt: '2026-10-30T10:00:00.000Z',
  unsentCount: 0,
  ...overrides,
});

describe('contractVersion is a floor, never a ceiling', () => {
  // Kills `min(1)` → `max(1)` in syncDocumentSchema, pushRequestSchema and
  // heartbeatRequestSchema. Under that mutant a device on a newer contract is locked out
  // and one sending 0 gets in.
  it('accepts a contract newer than 1 and refuses 0 or a negative', () => {
    expect(ok(syncDocumentSchema, makeDoc({ contractVersion: 2 }))).toBe(true);
    expect(ok(syncDocumentSchema, makeDoc({ contractVersion: 0 }))).toBe(false);
    expect(ok(syncDocumentSchema, makeDoc({ contractVersion: -1 }))).toBe(false);

    expect(ok(pushRequestSchema, pushRequest({ contractVersion: 2 }))).toBe(true);
    expect(ok(pushRequestSchema, pushRequest({ contractVersion: 0 }))).toBe(false);

    expect(ok(heartbeatRequestSchema, heartbeat({ contractVersion: 2 }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ contractVersion: 0 }))).toBe(false);
  });
});

describe('the payload hash is the whole string and nothing else', () => {
  // Kills both anchor mutants of /^[0-9a-f]{64}$/. Dropping either anchor lets a hash
  // carry extra characters, and the hash is what makes a replayed push a duplicate
  // instead of a second sale.
  it('refuses a hash with anything before or after the 64 hex digits', () => {
    const doc = makeDoc();
    expect(ok(syncDocumentSchema, doc)).toBe(true);
    expect(ok(syncDocumentSchema, { ...doc, hash: `x${doc.hash}` })).toBe(false);
    expect(ok(syncDocumentSchema, { ...doc, hash: `${doc.hash}x` })).toBe(false);
    expect(ok(syncDocumentSchema, { ...doc, hash: doc.hash.slice(0, 63) })).toBe(false);
    expect(ok(syncDocumentSchema, { ...doc, hash: `${doc.hash}0` })).toBe(false);
    expect(ok(syncDocumentSchema, { ...doc, hash: doc.hash.toUpperCase() })).toBe(false);
  });
});

describe('a line number appears once per document', () => {
  // Kills the ArrowFunction mutant of `(l) => l.lineNo`, which maps every line to
  // undefined: the Set then holds one entry and duplicate line numbers pass. Two lines
  // sharing a number make a return ambiguous about which line it reverses.
  it('refuses repeated line numbers, and accepts distinct ones out of order', () => {
    const twice = {
      lines: [
        { lineNo: 2, qty: 1 },
        { lineNo: 2, qty: 5 },
      ],
    };
    expect(ok(syncDocumentSchema, makeDoc({ payload: twice }))).toBe(false);

    const threeSame = {
      lines: [
        { lineNo: 7, qty: 1 },
        { lineNo: 7, qty: 1 },
        { lineNo: 7, qty: 1 },
      ],
    };
    expect(ok(syncDocumentSchema, makeDoc({ payload: threeSame }))).toBe(false);

    const distinct = {
      lines: [
        { lineNo: 3, qty: 1 },
        { lineNo: 1, qty: 1 },
        { lineNo: 2, qty: 1 },
      ],
    };
    expect(ok(syncDocumentSchema, makeDoc({ payload: distinct }))).toBe(true);
  });
});

describe('a series is two or three capitals, exactly', () => {
  // Kills the anchor, the /^[A-Z]$/ and the negated-class mutants of /^[A-Z]{2,3}$/ in
  // lastIssued, on both the push and the heartbeat. The key is a series, and the value is
  // the last number issued in it: a wrong key hides documents that never arrived.
  it.each([
    ['SAL', true],
    ['SA', true],
    ['S', false],
    ['SALE', false],
    ['sal', false],
    ['SAL1', false],
    [' SAL', false],
    ['SAL ', false],
    ['123', false],
  ])('lastIssued key %j is accepted: %s', (series, accepted) => {
    const lastIssued = { [series]: 3 };
    expect(ok(pushRequestSchema, pushRequest({ lastIssued }))).toBe(accepted);
    expect(ok(heartbeatRequestSchema, heartbeat({ lastIssued }))).toBe(accepted);
  });

  // Kills `min(0)` → `max(0)` on the value: a device that has issued anything would be
  // refused, and a negative last number accepted.
  it('counts from zero upwards, never below', () => {
    expect(ok(heartbeatRequestSchema, heartbeat({ lastIssued: { SAL: 0 } }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ lastIssued: { SAL: 1 } }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ lastIssued: { SAL: -1 } }))).toBe(false);
  });
});

describe('a batch holds between one and PUSH_MAX_DOCUMENTS documents', () => {
  // Kills `min(1)`/`max(PUSH_MAX_DOCUMENTS)` mutants on documents.
  it('accepts one and the maximum, refuses none and one too many', () => {
    const batch = (n: number) =>
      pushRequest({
        documents: Array.from({ length: n }, (_, i) =>
          makeDoc({
            seq: i + 1,
            number: formatDocNumber({ series: 'INV', branchCode: '001', deviceCode: '002', sequence: i + 1 }),
          }),
        ),
      });
    expect(ok(pushRequestSchema, batch(1))).toBe(true);
    expect(ok(pushRequestSchema, batch(PUSH_MAX_DOCUMENTS))).toBe(true);
    expect(ok(pushRequestSchema, batch(0))).toBe(false);
    expect(ok(pushRequestSchema, batch(PUSH_MAX_DOCUMENTS + 1))).toBe(false);
  });
});

describe('appVersion is between one and thirty-two characters', () => {
  // Kills `min(1)` → `max(1)` and `max(32)` → `min(32)` on appVersion, in both schemas.
  it.each([
    [1, true],
    [2, true],
    [32, true],
    [33, false],
    [0, false],
  ])('a version of %i characters is accepted: %s', (length, accepted) => {
    const appVersion = 'v'.repeat(length);
    expect(ok(pushRequestSchema, pushRequest({ appVersion }))).toBe(accepted);
    expect(ok(heartbeatRequestSchema, heartbeat({ appVersion }))).toBe(accepted);
  });
});

describe('the pull page size is capped', () => {
  // Kills `min(1)` → `max(1)` and `max(PULL_PAGE_SIZE)` → `min(PULL_PAGE_SIZE)` on limit.
  // Uncapped, one device could ask for the whole database in a single page.
  it('accepts 1 and the cap, refuses 0 and one past the cap', () => {
    expect(ok(pullQuerySchema, { limit: 1 })).toBe(true);
    expect(ok(pullQuerySchema, { limit: 2 })).toBe(true);
    expect(ok(pullQuerySchema, { limit: PULL_PAGE_SIZE })).toBe(true);
    expect(ok(pullQuerySchema, { limit: PULL_PAGE_SIZE + 1 })).toBe(false);
    expect(ok(pullQuerySchema, { limit: 0 })).toBe(false);
    expect(ok(pullQuerySchema, { limit: -1 })).toBe(false);
  });

  it('defaults to a full page when no limit is given', () => {
    expect(pullQuerySchema.parse({}).limit).toBe(PULL_PAGE_SIZE);
  });
});

describe('a cursor names one set and one watermark', () => {
  // Kills the anchor mutants of /^[a-z_]{1,32}$/ for set names in the pull cursors and in
  // resync. A set name that is not matched whole can address a set the device may not read.
  it.each([
    ['sales', true],
    ['a', true],
    ['with_underscore', true],
    ['a'.repeat(32), true],
    ['a'.repeat(33), false],
    ['Sales', false],
    ['sales1', false],
    ['sales-x', false],
    ['', false],
  ])('the set name %j is accepted: %s', (set, accepted) => {
    const cursors = JSON.stringify({ [set]: INITIAL_CURSOR });
    expect(ok(pullQuerySchema, { cursors })).toBe(accepted);
    expect(ok(resyncRequestSchema, { sets: [set] })).toBe(accepted);
  });

  // Kills the `INITIAL_CURSOR = '0'` → `''` mutant: an empty cursor is not a valid one, so
  // the first pull of a set would be refused instead of starting from the beginning.
  it('starts a set from INITIAL_CURSOR, which is a valid cursor', () => {
    expect(INITIAL_CURSOR).toBe('0');
    expect(CURSOR_PATTERN.test(INITIAL_CURSOR)).toBe(true);
    expect(ok(pullQuerySchema, { cursors: JSON.stringify({ sales: INITIAL_CURSOR }) })).toBe(true);
  });

  it('refuses a cursor that is not a watermark, and accepts one with a row id', () => {
    const withRow = '42.0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b';
    expect(ok(pullQuerySchema, { cursors: JSON.stringify({ sales: withRow }) })).toBe(true);
    expect(ok(pullQuerySchema, { cursors: JSON.stringify({ sales: '01' }) })).toBe(false);
    expect(ok(pullQuerySchema, { cursors: JSON.stringify({ sales: '-1' }) })).toBe(false);
    expect(ok(pullQuerySchema, { cursors: JSON.stringify({ sales: 'x' }) })).toBe(false);
  });

  // Kills the ObjectLiteral and StringLiteral mutants around the cursors issue: text that
  // is not JSON must be refused, not silently read as no cursors at all.
  it('refuses cursors that are not a JSON object', () => {
    expect(ok(pullQuerySchema, { cursors: 'not json' })).toBe(false);
    expect(ok(pullQuerySchema, { cursors: '[1,2]' })).toBe(false);
    expect(ok(pullQuerySchema, { cursors: '"sales"' })).toBe(false);
  });

  it('treats an absent or empty cursors field as every set from the start', () => {
    expect(pullQuerySchema.parse({}).cursors).toEqual({});
    expect(pullQuerySchema.parse({ cursors: '' }).cursors).toEqual({});
  });
});

describe('a resync asks for between one and thirty-two sets', () => {
  // Kills `min(1)` → `max(1)` and `max(32)` → `min(32)` on sets, and the ObjectLiteral
  // mutant of the schema itself.
  it('accepts one and thirty-two, refuses none and thirty-three', () => {
    // Set names are lowercase letters and underscores only, so count in letters.
    const name = (i: number) =>
      `${'a'.repeat(Math.floor(i / 26) + 1)}_${'abcdefghijklmnopqrstuvwxyz'[i % 26]}`;
    const sets = (n: number) => Array.from({ length: n }, (_, i) => name(i));
    expect(ok(resyncRequestSchema, { sets: sets(1) })).toBe(true);
    expect(ok(resyncRequestSchema, { sets: sets(2) })).toBe(true);
    expect(ok(resyncRequestSchema, { sets: sets(32) })).toBe(true);
    expect(ok(resyncRequestSchema, { sets: sets(33) })).toBe(false);
    expect(ok(resyncRequestSchema, { sets: [] })).toBe(false);
  });
});

describe('the heartbeat counters stay inside their range', () => {
  // Kills the `min(0)` → `max(0)` and `max(…)` → `min(…)` mutants on unsentCount and
  // storageUsedBytes. These two tell the owner how much has not reached the server.
  it('accepts a real backlog and refuses an impossible one', () => {
    expect(ok(heartbeatRequestSchema, heartbeat({ unsentCount: 0 }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ unsentCount: 1 }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ unsentCount: 10_000_000 }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ unsentCount: 10_000_001 }))).toBe(false);
    expect(ok(heartbeatRequestSchema, heartbeat({ unsentCount: -1 }))).toBe(false);
  });

  it('accepts a storage figure, zero or none, and refuses a negative one', () => {
    expect(ok(heartbeatRequestSchema, heartbeat({ storageUsedBytes: 0 }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ storageUsedBytes: 1 }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ storageUsedBytes: null }))).toBe(true);
    expect(ok(heartbeatRequestSchema, heartbeat({ storageUsedBytes: -1 }))).toBe(false);
    expect(heartbeatRequestSchema.parse(heartbeat()).storageUsedBytes).toBe(null);
  });
});

describe('a sequence runs from one to MAX_SEQUENCE inclusive', () => {
  // Kills `sequence > MAX_SEQUENCE` → `sequence >= MAX_SEQUENCE` in numbering.ts. Under
  // that mutant the very last number a device can issue is refused, which would stop a
  // till mid-day with no way forward.
  it('issues the last number in range and refuses the one after it', () => {
    const at = (sequence: number) =>
      formatDocNumber({ series: 'INV', branchCode: '001', deviceCode: '002', sequence });
    expect(at(MAX_SEQUENCE)).toBe(`INV-001-002-${String(MAX_SEQUENCE)}`);
    expect(() => at(MAX_SEQUENCE + 1)).toThrow();
    expect(() => at(1)).not.toThrow();
    expect(() => at(0)).toThrow();
  });
});
