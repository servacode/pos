/**
 * The golden day replayed through the real system (23 › المرحلة 1 › 11, «يوم البيع المكتوب سلفاً»).
 *
 * golden/day1/scenario.json holds the 200 sales, the two shifts and their cash movements as two
 * devices would send them; golden/day1/expected.json holds the results computed by the independent
 * calculator in golden/calc (Python, from the specs only). This test builds the store and its
 * catalogue through the real routes, links the two devices, pushes every document through
 * /v1/sync/push in the scenario's shuffled order (the 50 offline sales twice), then compares the
 * system with the sheet, to the qirsh.
 *
 * Nothing here computes money: every expected number comes from expected.json. When the system
 * and the sheet disagree, neither is changed to match; the difference goes to golden/DISAGREEMENTS.md.
 *
 * The report routes (day report, shifts, journal, trial balance, evidence) come with the accounting
 * step; until they are registered their comparisons are skipped, and they run as soon as they are.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductDetail } from '@serva/core';
import { payloadHash, type PushResponse, type SyncDocument, type SyncDocumentBody } from '@serva/sync';
import { ManualClock } from '../src/clock';
import { activateDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

// ─── The golden files ─────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

interface ScenarioDoc extends Omit<SyncDocumentBody, 'payload'> {
  payload: Json;
  golden: { offline?: boolean; pattern?: string; tag?: string };
}

interface Scenario {
  businessDate: string;
  taxRates: Record<string, { name: string; rateBp: number; kind: 'consumption' | 'stamp' | 'sales' }>;
  users: Record<string, { fullName: string; role: string; phone?: string }>;
  devices: Record<string, { code: string; name: string; lastIssued: Record<string, number> }>;
  rates: { afternoon: { unit: string; quote: string; rate: string } };
  products: {
    sku: string;
    nameAr: string;
    priceCurrency: 'SYP' | 'USD';
    priceMinor: number;
    unit: 'piece' | 'kg';
    tax: string | null;
    type: 'stock' | 'service';
    openingStock: number | null;
    barcode: string;
    pack: { packQty: number; packName: string; packPriceMinor: number; barcode: string } | null;
  }[];
  documents: Record<string, ScenarioDoc[]>;
  pushPlan: { device: string; documents: string[] }[];
}

interface MoneyLine {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
  currency: string;
  amountMinor: number;
}

interface Expected {
  dayReport: {
    invoiceCount: number;
    grossMinor: number;
    discountMinor: number;
    netExTaxMinor: number;
    taxMinor: number;
    totalMinor: number;
    tipsMinor: number;
    cashRoundingMinor: number;
    byMethod: {
      method: string;
      currency: string;
      amountMinor: number;
      baseAmountMinor: number;
      count: number;
    }[];
    byCashier: { userId: string; invoiceCount: number; totalMinor: number }[];
  };
  invoices: {
    number: string;
    id: string;
    totals: Record<string, number>;
    tipMinor: number;
    lines: {
      lineNo: number;
      grossMinor: number;
      lineDiscountMinor: number;
      invoiceDiscountShareMinor: number;
      taxMinor: number;
      totalMinor: number;
      baseQty: number;
    }[];
    payments: {
      paymentNo: number;
      method: string;
      currency: string;
      amountMinor: number;
      baseAmountMinor: number;
    }[];
    change: { baseAmountMinor: number } | null;
    cashRounding: { roundingBaseMinor: number } | null;
  }[];
  shifts: {
    id: string;
    number: string;
    deviceCode: string;
    status: string;
    salesCount: number;
    salesTotalMinor: number;
    byCurrency: Record<string, number | string>[];
    byMethod: { method: string; currency: string; amountMinor: number; count: number }[];
    movements: {
      id: string;
      kind: string;
      currency: string;
      amountMinor: number;
      approvedBy: string | null;
    }[];
  }[];
  stock: { sku: string; closingQty: number }[];
  journal: { source: { type: string; id: string; number: string | null }; lines: MoneyLine[] }[];
  trialBalance: {
    rows: { accountCode: string; debitMinor: number; creditMinor: number; closingMinor: number }[];
    totals: { debitMinor: number; creditMinor: number };
    balanced: boolean;
  };
  evidence: Record<
    string,
    {
      sent: number;
      accepted: number;
      duplicate: number;
      rejected: number;
      quarantined: number;
      lastAnnouncedNumber: Record<string, string>;
      lastReceivedNumber: Record<string, string>;
    }
  >;
}

const golden = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../golden/day1/${name}`, import.meta.url)), 'utf8'));
const scenario = golden('scenario.json') as Scenario;
const expected = golden('expected.json') as Expected;

// ─── Setup through the real routes ───────────────────────────────────────────

let app: FastifyInstance;
const clock = new ManualClock('2026-10-30T19:00:00.000Z'); // 22:00 in Damascus, after both shifts closed
let store: TestStore;
const devices: Record<string, TestDevice> = {};
/** "@variant:P01" → the real id, and so on for products, tax rates and users */
const ids = new Map<string, string>();
const pushResults: { device: string; result: PushResponse['results'][number] }[] = [];

const owner = () => bearer(store.accessToken);

async function post<T>(url: string, payload: Json): Promise<T> {
  const res = await app.inject({ method: 'POST', url, headers: owner(), payload });
  if (res.statusCode !== 201) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return res.json<T>();
}

async function get<T>(url: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url, headers: owner() });
  if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return res.json<T>();
}

/** Swaps every "@kind:key" placeholder for the id the server gave it. */
function resolve<T>(value: T): T {
  if (typeof value === 'string' && value.startsWith('@')) {
    const id = ids.get(value);
    if (id === undefined) throw new Error(`no id for ${value}`);
    return id as T;
  }
  if (Array.isArray(value)) return value.map(resolve) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) as T;
  }
  return value;
}

function toSyncDocument(doc: ScenarioDoc): SyncDocument {
  const { golden: _golden, ...rest } = doc;
  const body: SyncDocumentBody = { ...rest, payload: resolve(rest.payload) };
  return { ...body, hash: payloadHash(body) };
}

async function buildStore(): Promise<void> {
  store = await testStore(app, '0911000001');
  ids.set('@user:owner', store.userId);
  for (const [key, user] of Object.entries(scenario.users)) {
    if (user.role === 'owner') continue;
    const staff = await staffUser(app, store, user.role, user.phone!, { fullName: user.fullName });
    ids.set(`@user:${key}`, staff.userId);
  }
  for (const [key, rate] of Object.entries(scenario.taxRates)) {
    ids.set(`@tax:${key}`, (await post<{ id: string }>('/v1/tax-rates', rate)).id);
  }
  const units = await get<{ items: { id: string; allowsFraction: boolean }[] }>('/v1/units');
  const kilo = units.items.find((u) => u.allowsFraction);
  if (!kilo) throw new Error('the store has no weighed unit');
  for (const p of scenario.products) {
    const barcodes: Json[] = [{ kind: 'standard', code: p.barcode }];
    if (p.pack) {
      barcodes.push({
        kind: 'standard',
        code: p.pack.barcode,
        packQty: p.pack.packQty,
        packName: p.pack.packName,
        packPriceMinor: p.pack.packPriceMinor,
      });
    }
    const product = await post<ProductDetail>('/v1/products', {
      nameAr: p.nameAr,
      type: p.type,
      ...(p.unit === 'kg' ? { unitId: kilo.id } : {}),
      taxRateId: p.tax === null ? null : ids.get(`@tax:${p.tax}`),
      variants: [{ price: { currency: p.priceCurrency, priceMinor: p.priceMinor }, barcodes }],
    });
    ids.set(`@product:${p.sku}`, product.id);
    ids.set(`@variant:${p.sku}`, product.variants[0]!.id);
  }
  // Opening stock and the day's rate have no admin route yet: written directly, like catalog-fixtures.
  for (const p of scenario.products) {
    if (p.openingStock === null) continue;
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${store.tenantId}, ${store.branchId}, ${ids.get(`@variant:${p.sku}`)!}, ${p.openingStock})`;
  }
  const rate = scenario.rates.afternoon;
  await ownerDb()`
    insert into exchange_rates (tenant_id, unit, quote, rate, collect_rate)
    values (${store.tenantId}, ${rate.unit}, ${rate.quote}, ${rate.rate}, ${rate.rate})`;
  for (const [key, device] of Object.entries(scenario.devices)) {
    devices[key] = await activateDevice(app, store.accessToken, store.branchId, device.name);
  }
}

async function pushDay(): Promise<void> {
  const byId = new Map<string, { device: string; doc: ScenarioDoc }>();
  for (const [device, docs] of Object.entries(scenario.documents)) {
    for (const doc of docs) byId.set(doc.id, { device, doc });
  }
  for (const batch of scenario.pushPlan) {
    const device = devices[batch.device]!;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { authorization: device.authorization },
      payload: {
        contractVersion: 1,
        appVersion: '1.0.0',
        sentAt: clock.now().toISOString(),
        lastIssued: scenario.devices[batch.device]!.lastIssued,
        documents: batch.documents.map((id) => toSyncDocument(byId.get(id)!.doc)),
      },
    });
    if (res.statusCode !== 200) throw new Error(`push: ${res.statusCode} ${res.body}`);
    for (const result of res.json<PushResponse>().results) pushResults.push({ device: batch.device, result });
  }
}

beforeAll(async () => {
  await resetDatabase();
  app = await makeApp({}, { clock });
  await buildStore();
  await pushDay();
}, 180_000);

afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

// ─── Helpers for the comparisons ─────────────────────────────────────────────

/** A list of differences, each a readable line, so a failure shows every one at once. */
class Diffs {
  readonly items: string[] = [];
  eq(what: string, actual: unknown, wanted: unknown): void {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      this.items.push(`${what}: system ${JSON.stringify(actual)}, sheet ${JSON.stringify(wanted)}`);
    }
  }
}

const n = (v: unknown) => Number(v);

/** Six-digit sub-accounts (a drawer, a provider) fold into their four-digit parent (10 › سجل الترقيم). */
const parentCode = (code: string) => code.slice(0, 4);

function foldLines(lines: MoneyLine[]): Record<string, { debit: number; credit: number; amount: number }> {
  const out: Record<string, { debit: number; credit: number; amount: number }> = {};
  for (const l of lines) {
    const debit = n(l.debitMinor);
    const credit = n(l.creditMinor);
    if (debit === 0 && credit === 0) continue;
    const key = `${parentCode(l.accountCode)} ${l.currency} ${debit > 0 ? 'D' : 'C'}`;
    const row = (out[key] ??= { debit: 0, credit: 0, amount: 0 });
    row.debit += debit;
    row.credit += credit;
    row.amount += n(l.amountMinor);
  }
  return out;
}

function routeExists(url: string): boolean {
  return app.hasRoute({ method: 'GET', url });
}

const userKey = (ref: string) => ids.get(ref) ?? ref;

// ─── Sync: every document once, the duplicates change nothing ───────────────

describe('the golden day through /v1/sync/push', () => {
  it('stores every document once and answers the replays as duplicates', () => {
    const total = Object.values(scenario.documents).reduce((acc, docs) => acc + docs.length, 0);
    const offline = Object.values(scenario.documents)
      .flat()
      .filter((d) => d.golden.offline).length;
    expect(pushResults.length).toBe(total + offline);
    const byStatus: Record<string, number> = {};
    for (const { result } of pushResults) byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
    expect(byStatus).toEqual({ accepted: total, duplicate: offline });
    const rejected = pushResults.filter((r) => !['accepted', 'duplicate'].includes(r.result.status));
    expect(rejected).toEqual([]);
  });

  it('never flags a sale whose numbers the server recomputes differently (totals_mismatch)', () => {
    const mismatched = pushResults
      .filter((r) => r.result.flags.includes('totals_mismatch'))
      .map((r) => r.result.id);
    expect([...new Set(mismatched)]).toEqual([]);
  });

  it('raises no money flag the sheet does not expect', () => {
    const allowed = new Set(['approval_offline']);
    const unexpected = pushResults.flatMap((r) => r.result.flags.filter((f) => !allowed.has(f)));
    expect([...new Set(unexpected)]).toEqual([]);
  });

  it('flags every approval given offline, and only those', () => {
    const offlineApproval = new Set(
      Object.values(scenario.documents)
        .flat()
        .filter((d) => JSON.stringify(d.payload).includes('"offline":true'))
        .map((d) => d.id),
    );
    const flagged = new Set(
      pushResults.filter((r) => r.result.flags.includes('approval_offline')).map((r) => r.result.id),
    );
    expect([...flagged].sort()).toEqual([...offlineApproval].sort());
  });
});

// ─── The stored documents, to the qirsh ──────────────────────────────────────

describe('the golden day as stored', () => {
  it('stores the 200 invoices with the sheet’s totals, lines and payments', async () => {
    const diffs = new Diffs();
    const invoices = await ownerDb()<Json[]>`
      select id, number, gross_minor, discount_minor, tax_minor, total_minor, tip_minor,
             rounding_base_minor, change_base_minor
      from invoices where tenant_id = ${store.tenantId}`;
    diffs.eq('invoice count', invoices.length, expected.invoices.length);
    const lines = await ownerDb()<Json[]>`
      select invoice_id, line_no, gross_minor, discount_minor, tax_minor, total_minor, base_qty
      from invoice_lines where tenant_id = ${store.tenantId}`;
    const payments = await ownerDb()<Json[]>`
      select invoice_id, payment_no, method, currency, amount_minor, base_amount_minor
      from invoice_payments where tenant_id = ${store.tenantId}`;
    const byId = new Map(invoices.map((i) => [String(i.id), i]));
    for (const inv of expected.invoices) {
      const row = byId.get(inv.id);
      if (!row) {
        diffs.items.push(`${inv.number}: missing`);
        continue;
      }
      const t = inv.totals;
      diffs.eq(
        `${inv.number} totals`,
        [row.number, row.gross_minor, row.discount_minor, row.tax_minor, row.total_minor, row.tip_minor].map(
          String,
        ),
        [inv.number, t.grossMinor, t.discountMinor, t.taxMinor, t.totalMinor, inv.tipMinor].map(String),
      );
      diffs.eq(
        `${inv.number} rounding and change`,
        [n(row.rounding_base_minor), n(row.change_base_minor)],
        [inv.cashRounding?.roundingBaseMinor ?? 0, inv.change?.baseAmountMinor ?? 0],
      );
      const got = lines
        .filter((l) => l.invoice_id === inv.id)
        .sort((a, b) => n(a.line_no) - n(b.line_no))
        .map((l) =>
          [l.line_no, l.gross_minor, l.discount_minor, l.tax_minor, l.total_minor, l.base_qty].map(n),
        );
      const want = inv.lines.map((l) => [
        l.lineNo,
        l.grossMinor,
        l.lineDiscountMinor + l.invoiceDiscountShareMinor,
        l.taxMinor,
        l.totalMinor,
        l.baseQty,
      ]);
      diffs.eq(`${inv.number} lines`, got, want);
      const gotPay = payments
        .filter((p) => p.invoice_id === inv.id)
        .sort((a, b) => n(a.payment_no) - n(b.payment_no))
        .map((p) => [n(p.payment_no), p.method, p.currency, n(p.amount_minor), n(p.base_amount_minor)]);
      const wantPay = inv.payments.map((p) => [
        p.paymentNo,
        p.method,
        p.currency,
        p.amountMinor,
        p.baseAmountMinor,
      ]);
      diffs.eq(`${inv.number} payments`, gotPay, wantPay);
    }
    expect(diffs.items).toEqual([]);
  });

  it('leaves the stock the sheet expects', async () => {
    const diffs = new Diffs();
    const rows = await ownerDb()<{ variant_id: string; qty: string }[]>`
      select variant_id, qty from stock_levels
      where tenant_id = ${store.tenantId} and branch_id = ${store.branchId}`;
    const qty = new Map(rows.map((r) => [r.variant_id, n(r.qty)]));
    for (const s of expected.stock) diffs.eq(s.sku, qty.get(ids.get(`@variant:${s.sku}`)!), s.closingQty);
    // services keep no stock
    for (const p of scenario.products.filter((x) => x.type === 'service')) {
      diffs.eq(`${p.sku} (service)`, qty.get(ids.get(`@variant:${p.sku}`)!) ?? 0, 0);
    }
    expect(diffs.items).toEqual([]);
  });

  it('closes both shifts', async () => {
    const rows = await ownerDb()<{ id: string; status: string; number: string }[]>`
      select id, status, number from shifts where tenant_id = ${store.tenantId} order by number`;
    expect(rows.map((r) => [r.id, r.status, r.number])).toEqual(
      expected.shifts.map((s) => [s.id, s.status, s.number]),
    );
  });
});

// ─── The report routes (accounting step) ─────────────────────────────────────

describe('the golden day in the reports', () => {
  const date = () => scenario.businessDate;

  it('day report', async (ctx) => {
    if (!routeExists('/v1/reports/day')) ctx.skip();
    const r = await get<Json>(`/v1/reports/day?branchId=${store.branchId}&date=${date()}`);
    const d = expected.dayReport;
    const diffs = new Diffs();
    for (const k of [
      'invoiceCount',
      'grossMinor',
      'discountMinor',
      'netExTaxMinor',
      'taxMinor',
      'totalMinor',
      'tipsMinor',
      'cashRoundingMinor',
    ] as const) {
      diffs.eq(k, n(r[k]), d[k]);
    }
    const key = (m: { method: string; currency: string }) => `${m.method} ${m.currency}`;
    const methods = Object.fromEntries(
      (r.byMethod as Expected['dayReport']['byMethod']).map((m) => [
        key(m),
        [n(m.amountMinor), n(m.baseAmountMinor), n(m.count)],
      ]),
    );
    diffs.eq(
      'byMethod',
      methods,
      Object.fromEntries(d.byMethod.map((m) => [key(m), [m.amountMinor, m.baseAmountMinor, m.count]])),
    );
    const cashiers = Object.fromEntries(
      (r.byCashier as { userId: string; invoiceCount: number; totalMinor: number }[]).map((c) => [
        c.userId,
        [n(c.invoiceCount), n(c.totalMinor)],
      ]),
    );
    diffs.eq(
      'byCashier',
      cashiers,
      Object.fromEntries(d.byCashier.map((c) => [userKey(c.userId), [c.invoiceCount, c.totalMinor]])),
    );
    expect(diffs.items).toEqual([]);
  });

  it('shift reports', async (ctx) => {
    if (!routeExists('/v1/shifts/:id')) ctx.skip();
    const diffs = new Diffs();
    const list = await get<{
      items: { id: string; status: string; salesCount: number; salesTotalMinor: number }[];
    }>(`/v1/shifts?branchId=${store.branchId}&date=${date()}`);
    diffs.eq(
      'shift list',
      list.items.map((s) => [s.id, s.status, n(s.salesCount), n(s.salesTotalMinor)]).sort(),
      expected.shifts.map((s) => [s.id, s.status, s.salesCount, s.salesTotalMinor]).sort(),
    );
    for (const s of expected.shifts) {
      const r = await get<{
        deviceCode: string;
        byCurrency: Record<string, number | string | null>[];
        byMethod: { method: string; currency: string; amountMinor: number; count: number }[];
        movements: {
          id: string;
          kind: string;
          currency: string;
          amountMinor: number;
          approvedBy: { id: string } | null;
        }[];
      }>(`/v1/shifts/${s.id}`);
      diffs.eq(`${s.number} device`, r.deviceCode, s.deviceCode);
      const fields = [
        'openingMinor',
        'cashSalesMinor',
        'changeGivenMinor',
        'payInMinor',
        'payOutMinor',
        'dropsMinor',
        'expectedMinor',
        'countedMinor',
        'differenceMinor',
      ];
      for (const c of s.byCurrency) {
        const got = r.byCurrency.find((x) => x.currency === c.currency);
        diffs.eq(
          `${s.number} ${String(c.currency)}`,
          got ? fields.map((f) => (got[f] === null ? null : n(got[f]))) : null,
          fields.map((f) => c[f]),
        );
      }
      const key = (m: { method: string; currency: string }) => `${m.method} ${m.currency}`;
      diffs.eq(
        `${s.number} byMethod`,
        Object.fromEntries(r.byMethod.map((m) => [key(m), [n(m.amountMinor), n(m.count)]])),
        Object.fromEntries(s.byMethod.map((m) => [key(m), [m.amountMinor, m.count]])),
      );
      diffs.eq(
        `${s.number} movements`,
        r.movements.map((m) => [m.id, m.kind, m.currency, n(m.amountMinor), m.approvedBy?.id ?? null]).sort(),
        s.movements
          .map((m) => [m.id, m.kind, m.currency, m.amountMinor, m.approvedBy ? userKey(m.approvedBy) : null])
          .sort(),
      );
    }
    expect(diffs.items).toEqual([]);
  });

  it('journal lines', async (ctx) => {
    if (!routeExists('/v1/journal')) ctx.skip();
    type Entry = { source: { type: string; id: string }; lines: MoneyLine[] };
    const entries: Entry[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Entry[]; nextCursor: string | null } = await get(
        `/v1/journal?from=${date()}&to=${date()}&branchId=${store.branchId}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      entries.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const diffs = new Diffs();
    for (const e of entries) {
      const lines = foldLines(e.lines);
      const debit = Object.values(lines).reduce((a, l) => a + l.debit, 0);
      const credit = Object.values(lines).reduce((a, l) => a + l.credit, 0);
      diffs.eq(`entry ${e.source.type} ${e.source.id} balance`, debit, credit);
    }
    // the whole day, account by account (10 lets cash sales share one entry per shift)
    diffs.eq(
      'the day, by account, currency and side',
      foldLines(entries.flatMap((e) => e.lines)),
      foldLines(expected.journal.flatMap((e) => e.lines)),
    );
    // and every document the system posted on its own, line by line
    const own = new Map(entries.map((e) => [e.source.id, e]));
    for (const e of expected.journal) {
      const got = own.get(e.source.id);
      if (got)
        diffs.eq(
          `${e.source.type} ${e.source.number ?? e.source.id}`,
          foldLines(got.lines),
          foldLines(e.lines),
        );
    }
    expect(diffs.items).toEqual([]);
  });

  it('trial balance', async (ctx) => {
    if (!routeExists('/v1/reports/trial-balance')) ctx.skip();
    const tb = await get<{
      rows: { accountCode: string; debitMinor: number; creditMinor: number; closingMinor: number }[];
      totals: { debitMinor: number; creditMinor: number };
      balanced: boolean;
    }>(`/v1/reports/trial-balance?from=${date()}&to=${date()}&branchId=${store.branchId}`);
    const codes = tb.rows.map((r) => r.accountCode);
    // leaves only: a parent row next to its own sub-accounts would count twice
    const leaves = tb.rows.filter(
      (r) => !codes.some((c) => c !== r.accountCode && c.startsWith(r.accountCode)),
    );
    const folded: Record<string, [number, number, number]> = {};
    for (const r of leaves) {
      if (n(r.debitMinor) === 0 && n(r.creditMinor) === 0 && n(r.closingMinor) === 0) continue;
      const row = (folded[parentCode(r.accountCode)] ??= [0, 0, 0]);
      row[0] += n(r.debitMinor);
      row[1] += n(r.creditMinor);
      row[2] += n(r.closingMinor);
    }
    const diffs = new Diffs();
    diffs.eq(
      'rows',
      folded,
      Object.fromEntries(
        expected.trialBalance.rows.map((r) => [r.accountCode, [r.debitMinor, r.creditMinor, r.closingMinor]]),
      ),
    );
    diffs.eq(
      'totals',
      [n(tb.totals.debitMinor), n(tb.totals.creditMinor)],
      [expected.trialBalance.totals.debitMinor, expected.trialBalance.totals.creditMinor],
    );
    diffs.eq('balanced', tb.balanced, true);
    expect(diffs.items).toEqual([]);
  });

  it('evidence screen: nothing lost, nothing doubled', async (ctx) => {
    if (!routeExists('/v1/sync/evidence')) ctx.skip();
    const diffs = new Diffs();
    for (const [key, want] of Object.entries(expected.evidence)) {
      const r = await get<Json>(`/v1/sync/evidence?deviceId=${devices[key]!.deviceId}&date=${date()}`);
      for (const f of ['sent', 'accepted', 'duplicate', 'rejected', 'quarantined'] as const) {
        diffs.eq(`${key} ${f}`, n(r[f]), want[f]);
      }
      diffs.eq(`${key} lastAnnouncedNumber`, r.lastAnnouncedNumber, want.lastAnnouncedNumber);
      diffs.eq(`${key} lastReceivedNumber`, r.lastReceivedNumber, want.lastReceivedNumber);
    }
    expect(diffs.items).toEqual([]);
  });
});

describe('the golden setup', () => {
  it('links the two devices with the codes the numbers carry', () => {
    for (const [key, device] of Object.entries(scenario.devices))
      expect(devices[key]!.code).toBe(device.code);
  });

  // Runs last: it adds a sale of its own. It proves «no totals_mismatch» above is not vacuous.
  it('flags a sale whose printed numbers are one qirsh off the engine', async () => {
    const doc = scenario.documents.D1!.find((d) => d.number === 'INV-001-001-0000003')!;
    const copy = JSON.parse(JSON.stringify(doc)) as ScenarioDoc;
    copy.id = '019a33d0-0000-7000-8000-000000000001';
    copy.number = 'INV-001-001-0000999';
    copy.seq = 9999;
    (copy.payload.lines as { priced: { taxMinor: number } }[])[1]!.priced.taxMinor += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { authorization: devices.D1!.authorization },
      payload: {
        contractVersion: 1,
        appVersion: '1.0.0',
        sentAt: clock.now().toISOString(),
        documents: [toSyncDocument(copy)],
      },
    });
    expect(res.json<PushResponse>().results[0]!.flags).toContain('totals_mismatch');
  });
});
