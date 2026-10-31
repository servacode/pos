/**
 * The refusals a device is told about, and the edges of numbering and hashing (M0-2).
 *
 * A second group of mutants survived protocol.ts, numbering.ts and hash.ts because the
 * suite only asked "was this refused?". So a mutant that emptied the issue, its path or
 * its message left every test green, and a device would be told a document is wrong
 * without being told which field. The path and the message are part of the contract:
 * the till shows them to the cashier.
 *
 * The rest cover the edges: a pattern without its anchors, a number with junk around it,
 * and the canonical form that makes two equal documents hash alike.
 */
import { describe, expect, it } from 'vitest';
import {
  CanonicalJsonError,
  canonicalJson,
  formatDocNumber,
  parseDocNumber,
  payloadHash,
  PUSH_MAX_DOCUMENTS,
  PUSH_MAX_INFLATED_BYTES,
  PUSH_MAX_WIRE_BYTES,
  SUPPORTED_CONTRACT_VERSIONS,
  syncDocumentSchema,
  utf8Length,
  type SyncDocument,
  type SyncDocumentBody,
} from '../src';

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

/** The issues of a refusal, as { path, message } — what the device shows the cashier. */
function refusal(doc: unknown): Array<{ path: string; message: string }> {
  const result = syncDocumentSchema.safeParse(doc);
  expect(result.success, 'expected this document to be refused').toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe('a refusal names the field and says why', () => {
  // Kills the ObjectLiteral, ArrayDeclaration and StringLiteral mutants of every
  // ctx.addIssue in syncDocumentSchema. Each emptied the issue, its path or its text, so
  // the document was still refused but the device could not say which field was wrong.
  it('a number on a type that has none', () => {
    expect(refusal(makeDoc({ type: 'customer' }))).toEqual([{ path: 'number', message: 'unnumbered type' }]);
  });

  it('a number from the wrong series, and a missing number', () => {
    expect(refusal(makeDoc({ number: 'SRT-001-002-0000001' }))).toEqual([
      { path: 'number', message: 'expected a INV number' },
    ]);
    expect(refusal(makeDoc({ number: null }))).toEqual([
      { path: 'number', message: 'expected a INV number' },
    ]);
  });

  it('a line without a line number', () => {
    expect(refusal(makeDoc({ payload: { lines: [{ qty: 1 }] } }))).toEqual([
      { path: 'payload.lines', message: 'every line needs lineNo' },
    ]);
  });

  it('two lines sharing a line number', () => {
    expect(refusal(makeDoc({ payload: { lines: [{ lineNo: 1 }, { lineNo: 1 }] } }))).toEqual([
      { path: 'payload.lines', message: 'lineNo must be unique' },
    ]);
  });

  it('a document that depends on itself', () => {
    const id = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b';
    expect(refusal(makeDoc({ id, deps: [id] }))).toEqual([
      { path: 'deps', message: 'a document cannot depend on itself' },
    ]);
  });
});

describe('a document without lines is a document, not an error', () => {
  // Kills `lines !== undefined` → `true`. Under that mutant the line check runs on a
  // payload that has no lines at all and refuses it, so every customer, shift or exchange
  // rate document would be rejected.
  it('accepts a payload with no lines, and still checks the lines when there are some', () => {
    expect(syncDocumentSchema.safeParse(makeDoc({ payload: { total: 1500 } })).success).toBe(true);
    expect(
      syncDocumentSchema.safeParse(makeDoc({ type: 'customer', number: null, payload: { name: 'x' } }))
        .success,
    ).toBe(true);
    expect(syncDocumentSchema.safeParse(makeDoc({ payload: { lines: [{ qty: 1 }] } })).success).toBe(false);
  });
});

describe('a device time carries its offset from UTC', () => {
  // Kills `z.iso.datetime({ offset: true })` → `{}` / `offset: false`. The offset is how
  // the server works out a till's clock skew; a time without one cannot be placed.
  it('accepts a time with an offset or Z, refuses one with neither', () => {
    const at = (deviceTime: string) => syncDocumentSchema.safeParse(makeDoc({ deviceTime })).success;
    expect(at('2026-10-30T10:00:00.000Z')).toBe(true);
    expect(at('2026-10-30T10:00:00.000+03:00')).toBe(true);
    expect(at('2026-10-30T10:00:00.000')).toBe(false);
    expect(at('2026-10-30 10:00:00Z')).toBe(false);
    expect(refusal(makeDoc({ deviceTime: '2026-10-30T10:00:00.000' }))[0]?.path).toBe('deviceTime');
  });
});

describe('a document number is matched whole', () => {
  // Kills the anchor mutants of NUMBER, CODE and the series pattern in numbering.ts.
  // Without an anchor a number with text around it parses as a valid one, which is a
  // forged number the server would file under the real one's series.
  it.each([
    'xINV-001-002-0000001',
    'INV-001-002-0000001x',
    ' INV-001-002-0000001',
    'INV-001-002-0000001 ',
    'INV-001-002-00000011',
    'INV-001-002-000001',
    'inv-001-002-0000001',
  ])('refuses to parse %j', (text) => {
    expect(parseDocNumber(text)).toBe(null);
  });

  it('parses the number it formats, and no other', () => {
    const number = formatDocNumber({
      series: 'INV',
      branchCode: '001',
      deviceCode: '002',
      sequence: 7,
    });
    expect(number).toBe('INV-001-002-0000007');
    expect(parseDocNumber(number)).toEqual({
      series: 'INV',
      branchCode: '001',
      deviceCode: '002',
      sequence: 7,
    });
  });

  // Kills the anchor mutants of CODE (/^\d{3}$/) for the branch and device codes.
  it.each([
    ['001', '002', true],
    ['0011', '002', false],
    ['x001', '002', false],
    ['001', '0022', false],
    ['001', '002x', false],
    ['001', '000', false],
    ['01', '002', false],
  ])('branch %j and device %j are accepted: %s', (branchCode, deviceCode, accepted) => {
    const format = () => formatDocNumber({ series: 'INV', branchCode, deviceCode, sequence: 1 });
    if (accepted) expect(format()).toContain(`-${branchCode}-${deviceCode}-`);
    else expect(format).toThrow();
  });

  // Kills the anchor and class mutants of the series pattern in formatDocNumber.
  it.each(['I', 'INVO', 'inv', 'IN1', ' INV', 'INV '])('refuses the series %j', (series) => {
    expect(() => formatDocNumber({ series, branchCode: '001', deviceCode: '002', sequence: 1 })).toThrow();
  });
});

describe('the canonical form is what two equal documents share', () => {
  // Kills `Object.is(value, -0)` → `+0` in hash.ts. Minus zero must write as "0": a till
  // that reaches a zero total by subtraction would otherwise hash it differently from one
  // that reached the same zero directly, and the replay would post a second time.
  it('writes minus zero and zero the same way', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson({ total: -0 })).toBe(canonicalJson({ total: 0 }));
    expect(payloadHash(makeBody({ payload: { total: -0 } }))).toBe(
      payloadHash(makeBody({ payload: { total: 0 } })),
    );
  });

  // Kills `item === undefined` → `false`: a hole in a list would be hashed as nothing
  // instead of refused, so two different documents could share one hash.
  it('refuses a hole in a list rather than hashing it away', () => {
    expect(() => canonicalJson([undefined])).toThrow(CanonicalJsonError);
    expect(() => canonicalJson([1, undefined, 2])).toThrow(CanonicalJsonError);
    expect(() => canonicalJson([1, 2])).not.toThrow();
  });

  // The path in the message is how a rejected document is diagnosed: without it the till
  // only knows the payload cannot be hashed, not which field is at fault.
  it('refuses what it cannot hash, and names the field', () => {
    expect(() => canonicalJson(1.5)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(() => 1)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Date())).toThrow(CanonicalJsonError);
    expect(new CanonicalJsonError('x').name).toBe('CanonicalJsonError');

    const message = (value: unknown) => {
      try {
        canonicalJson(value);
      } catch (error) {
        return (error as Error).message;
      }
      return 'did not throw';
    };
    expect(message(1.5)).toBe('$: 1.5 is not a safe integer (use minor units or a string)');
    expect(message({ total: 1.5 })).toBe('$.total: 1.5 is not a safe integer (use minor units or a string)');
    expect(message([undefined])).toBe('$[0] is undefined');
    expect(message({ lines: [{ qty: 1.5 }] })).toBe(
      '$.lines[0].qty: 1.5 is not a safe integer (use minor units or a string)',
    );
    expect(message(new Date())).toBe('$: only plain objects, arrays and primitives can be hashed');
    expect(message(() => 1)).toBe('$: function cannot be hashed');
  });

  it('writes booleans as words, not numbers', () => {
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
  });

  // Kills the emptied body of utf8Length: the push size limit is counted with it, so an
  // empty body would let a batch of any size through.
  it('counts bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('م')).toBe(2);
    expect(utf8Length('')).toBe(0);
    expect(utf8Length('مبيعات')).toBe(12);
  });
});

describe('the limits of a push are the ones the server enforces', () => {
  // Kills the arithmetic mutants on the byte limits and the emptied
  // SUPPORTED_CONTRACT_VERSIONS: nothing asserted their value, so any of them could drift.
  it('states them in bytes and documents', () => {
    expect(PUSH_MAX_WIRE_BYTES).toBe(5 * 1024 * 1024);
    expect(PUSH_MAX_INFLATED_BYTES).toBe(24 * 1024 * 1024);
    expect(PUSH_MAX_INFLATED_BYTES).toBeGreaterThan(PUSH_MAX_WIRE_BYTES);
    expect(PUSH_MAX_DOCUMENTS).toBe(50);
  });

  it('supports contract version 1', () => {
    expect(SUPPORTED_CONTRACT_VERSIONS).toContain(1);
    expect(SUPPORTED_CONTRACT_VERSIONS.length).toBeGreaterThan(0);
  });
});
