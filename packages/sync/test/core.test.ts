import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CanonicalJsonError,
  CONFLICT_CODES,
  canonicalJson,
  createUuidV7,
  DOC_SERIES,
  documentPayloadRejection,
  DOC_TYPES,
  epochChanged,
  formatDocNumber,
  hashCanonical,
  isUuidV7,
  NumberingError,
  outcomeOf,
  parseDocNumber,
  payloadHash,
  pullQuerySchema,
  pushRequestSchema,
  selectBatch,
  sha256Hex,
  syncDocumentSchema,
  uuidV7Time,
  uuidv7,
  type OutboxEntry,
  type SyncDocument,
  type SyncDocumentBody,
} from '../src';
import { buildSalePayload } from '@serva/core/sale';

describe('UUIDv7 ids made on the device', () => {
  it('are version 7, variant 10, and carry their creation time', () => {
    const at = Date.parse('2026-10-30T10:00:00Z');
    const id = createUuidV7({ now: () => at })();
    expect(isUuidV7(id)).toBe(true);
    expect(uuidV7Time(id)).toBe(at);
    expect(isUuidV7(uuidv7())).toBe(true);
  });

  it('strictly increase, even within one millisecond or when the clock steps back', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -5_000, max: 5_000 }), { minLength: 2, maxLength: 300 }),
        (steps) => {
          let t = Date.parse('2026-10-30T10:00:00Z');
          const next = createUuidV7({ now: () => t });
          const ids: string[] = [];
          for (const step of steps) {
            t += step;
            ids.push(next());
          }
          for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
          expect(ids.every(isUuidV7)).toBe(true);
        },
      ),
    );
  });

  it('keep increasing past 4096 ids in the same millisecond', () => {
    const next = createUuidV7({ now: () => 1_000, random: (b) => b.fill(0xff) });
    let previous = next();
    for (let i = 0; i < 5_000; i++) {
      const id = next();
      expect(id > previous).toBe(true);
      previous = id;
    }
    expect(uuidV7Time(previous)).toBeGreaterThan(1_000);
  });
});

describe('payload hash', () => {
  it('SHA-256 matches node:crypto for any input', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
    );
  });

  it('canonical JSON sorts keys, drops undefined members and hashes Arabic text as UTF-8', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'ب'], c: undefined, d: { z: 0, y: -0 } })).toBe(
      '{"a":[true,null,"ب"],"b":1,"d":{"y":0,"z":0}}',
    );
    expect(hashCanonical({ name: 'بيبسي' })).toBe(
      createHash('sha256').update('{"name":"بيبسي"}', 'utf8').digest('hex'),
    );
  });

  it('is the same whatever the key order', () => {
    const json = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: 'small' },
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie('value'), { maxLength: 4 }),
        fc.dictionary(fc.string({ maxLength: 6 }), tie('value'), { maxKeys: 5 }),
      ),
    })).value;
    const reverse = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reverse);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).reverse()) out[k] = reverse((v as Record<string, unknown>)[k]);
        return out;
      }
      return v;
    };
    fc.assert(
      fc.property(json, (value) => {
        expect(hashCanonical(reverse(value))).toBe(hashCanonical(value));
      }),
    );
  });

  it('refuses what cannot be hashed the same everywhere: fractions, NaN, dates, undefined in arrays', () => {
    for (const bad of [
      { price: 1.5 },
      { n: Number.NaN },
      { n: 2 ** 60 },
      { at: new Date() },
      [undefined],
      () => 1,
    ]) {
      expect(() => canonicalJson(bad)).toThrow(CanonicalJsonError);
    }
  });

  it('changes when any part of the document changes', () => {
    const body = makeBody();
    const hash = payloadHash(body);
    expect(payloadHash({ ...body })).toBe(hash);
    expect(payloadHash({ ...body, payload: { ...body.payload, total: 1501 } })).not.toBe(hash);
    expect(payloadHash({ ...body, number: 'INV-001-002-0000002' })).not.toBe(hash);
    expect(payloadHash({ ...body, deps: [uuidv7()] })).not.toBe(hash);
  });
});

describe('document numbers', () => {
  it('format as SERIES-BRANCH-DEVICE-SEQUENCE and parse back', () => {
    expect(formatDocNumber({ series: 'INV', branchCode: '001', deviceCode: '002', sequence: 154 })).toBe(
      'INV-001-002-0000154',
    );
    fc.assert(
      fc.property(
        fc.constantFrom('INV', 'SRT', 'RCV', 'SO'),
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 1, max: 9_999_999 }),
        (series, branch, device, sequence) => {
          const parts = {
            series,
            branchCode: String(branch).padStart(3, '0'),
            deviceCode: String(device).padStart(3, '0'),
            sequence,
          };
          expect(parseDocNumber(formatDocNumber(parts))).toEqual(parts);
        },
      ),
    );
  });

  it('refuse the server device code 000, bad codes and sequences out of range', () => {
    const ok = { series: 'INV', branchCode: '001', deviceCode: '002', sequence: 1 };
    for (const bad of [
      { deviceCode: '000' },
      { branchCode: '1' },
      { sequence: 0 },
      { sequence: 10_000_000 },
      { series: 'inv' },
    ]) {
      expect(() => formatDocNumber({ ...ok, ...bad })).toThrow(NumberingError);
    }
    expect(parseDocNumber('INV-001-002-0000000')).toBeNull();
    expect(parseDocNumber('INV-1-2-3')).toBeNull();
  });

  it('every numbered type has a two- or three-letter series from tab 08', () => {
    for (const type of DOC_TYPES) {
      const series = DOC_SERIES[type];
      if (series !== null) expect(series).toMatch(/^[A-Z]{2,3}$/);
    }
    expect(DOC_SERIES.sale).toBe('INV');
    expect(DOC_SERIES.return).toBe('SRT');
  });
});

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

function makeDoc(overrides: Partial<SyncDocumentBody> = {}): SyncDocument {
  const body = makeBody(overrides);
  return { ...body, hash: payloadHash(body) };
}

describe('protocol schemas', () => {
  it('accept a well-formed document', () => {
    expect(syncDocumentSchema.safeParse(makeDoc()).success).toBe(true);
    expect(syncDocumentSchema.safeParse(makeDoc({ type: 'customer', number: null })).success).toBe(true);
  });

  it('refuse a number from the wrong series, a number on an unnumbered type, and lines without lineNo', () => {
    const bad = [
      makeDoc({ number: 'SRT-001-002-0000001' }),
      makeDoc({ number: null }),
      makeDoc({ type: 'customer' }),
      makeDoc({ payload: { lines: [{ qty: 1 }] } }),
      makeDoc({ payload: { lines: [{ lineNo: 1 }, { lineNo: 1 }] } }),
      makeDoc({ id: '0192a3b4-c5d6-4e8f-9a0b-1c2d3e4f5a6b' }),
      makeDoc({ deps: ['0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b'] }),
      makeDoc({ deviceTime: 'yesterday' }),
    ];
    for (const doc of bad) expect(syncDocumentSchema.safeParse(doc).success, JSON.stringify(doc)).toBe(false);
  });

  it('check a payload by its type: a malformed sale is rejected alone, with invalid_payload', () => {
    const sale = buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [],
      lines: [
        {
          lineNo: 1,
          productId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01',
          variantId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02',
          name: 'شاي',
          qty: 1000,
          priceCurrency: 'SYP',
          priceMinor: 60000,
          taxRateBp: 0,
        },
      ],
      shiftId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03',
      cashierId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04',
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100000 }],
      cashSteps: { SYP: 1000 },
    });
    expect(documentPayloadRejection({ type: 'sale', payload: sale })).toBeNull();
    // Valid for the envelope, so the batch is not refused…
    const toy = makeDoc({ payload: { total: 1500, lines: [{ lineNo: 1, qty: 1000 }] } });
    expect(syncDocumentSchema.safeParse(toy).success).toBe(true);
    // … but the document itself is.
    const rejection = documentPayloadRejection(toy);
    expect(rejection?.code).toBe('invalid_payload');
    expect(rejection?.issues.map((i) => i.path)).toContain('shiftId');
    // Types without a payload schema yet are stored as they arrive.
    expect(documentPayloadRejection({ type: 'return', payload: { total: 500 } })).toBeNull();
  });

  it('limit a push to 50 documents', () => {
    const request = (n: number) => ({
      contractVersion: 1,
      appVersion: '1.0.0',
      sentAt: '2026-10-30T10:00:00.000Z',
      documents: Array.from({ length: n }, () => makeDoc()),
    });
    expect(pushRequestSchema.safeParse(request(50)).success).toBe(true);
    expect(pushRequestSchema.safeParse(request(51)).success).toBe(false);
    expect(pushRequestSchema.safeParse(request(0)).success).toBe(false);
  });

  it('read pull cursors from a JSON query value', () => {
    expect(
      pullQuerySchema.parse({
        cursors: '{"users":"0","branches":"812.0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b"}',
      }),
    ).toEqual({
      cursors: { users: '0', branches: '812.0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b' },
      limit: 5000,
    });
    expect(pullQuerySchema.parse({}).cursors).toEqual({});
    for (const cursors of ['not json', '{"users":"-1"}', '{"USERS":"0"}', '{"users":"01"}']) {
      expect(pullQuerySchema.safeParse({ cursors }).success, cursors).toBe(false);
    }
  });

  it('name the conflict codes of the contract and what the device does with each', () => {
    expect(CONFLICT_CODES).toEqual({
      id_conflict: 'hold',
      pending_link: 'accept',
      permission_stale: 'accept',
      totals_mismatch: 'accept',
    });
  });
});

function entry(seq: number, overrides: Partial<SyncDocumentBody> = {}, bytes = 100): OutboxEntry {
  const doc = makeDoc({ id: createUuidV7({ now: () => seq })(), seq, ...overrides });
  return {
    seq,
    id: doc.id,
    type: doc.type,
    bytes,
    doc,
    status: 'pending',
    attempts: 0,
    lastError: null,
    flags: [],
    createdAt: 0,
    confirmedAt: null,
  };
}

describe('outbox', () => {
  it('sends in creation order, within the document and size limits', () => {
    const entries = [entry(3), entry(1), entry(2), entry(4)];
    expect(selectBatch(entries, new Set(), { maxDocs: 3, maxBytes: 1e9 }).batch.map((e) => e.seq)).toEqual([
      1, 2, 3,
    ]);
    expect(selectBatch(entries, new Set(), { maxDocs: 50, maxBytes: 250 }).batch.map((e) => e.seq)).toEqual([
      1, 2,
    ]);
    // One document larger than the limit still goes alone, so the server can answer 413 for it.
    expect(selectBatch([entry(1, {}, 999)], new Set(), { maxDocs: 50, maxBytes: 10 }).batch).toHaveLength(1);
  });

  it('keeps back what depends on a held document, directly or not, and sends the rest', () => {
    const held = entry(1);
    const ret = entry(2, { type: 'return', number: 'SRT-001-002-0000001', deps: [held.id] });
    const refund = entry(3, { type: 'receipt', number: 'RCV-001-002-0000001', deps: [ret.id] });
    const other = entry(4);
    const { batch, blocked } = selectBatch([ret, refund, other], new Set([held.id]), {
      maxDocs: 50,
      maxBytes: 1e9,
    });
    expect(batch.map((e) => e.seq)).toEqual([4]);
    expect(blocked.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('maps each answer to confirmed, held or pending', () => {
    const r = (status: Parameters<typeof outcomeOf>[0]['status'], outcome?: 'accepted' | 'rejected') =>
      outcomeOf({ id: 'x', status, flags: [], ...(outcome ? { outcome } : {}) });
    expect(r('accepted')).toBe('confirmed');
    expect(r('pending_link')).toBe('confirmed');
    expect(r('duplicate', 'accepted')).toBe('confirmed');
    expect(r('duplicate', 'rejected')).toBe('held');
    expect(r('duplicate')).toBe('confirmed');
    expect(r('id_conflict')).toBe('held');
    expect(r('rejected')).toBe('held');
    expect(r('quarantined')).toBe('held');
    expect(r('retry')).toBe('pending');
  });

  it('sees an epoch change only once an epoch is known', () => {
    expect(epochChanged(null, 3)).toBe(false);
    expect(epochChanged(3, 3)).toBe(false);
    expect(epochChanged(3, 4)).toBe(true);
  });
});
