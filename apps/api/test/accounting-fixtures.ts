import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import {
  buildSalePayload,
  type CashMovementPayload,
  type ProductDetail,
  type SaleCart,
  type SaleCartLine,
  type SalePayload,
  type ShiftClosePayload,
  type ShiftOpenPayload,
  type TradeRate,
} from '@serva/core';
import {
  createUuidV7,
  formatDocNumber,
  payloadHash,
  seriesOf,
  type DocType,
  type PushResponse,
  type SyncDocument,
  type SyncDocumentBody,
} from '@serva/sync';
import { createDevice, type TestDevice } from './devices';
import { ownerDb, registerStore } from './helpers';

/** Shared by the accounting, report and integrity tests: a store, its devices, its documents. */

export const newId = createUuidV7();
export const USD_130: TradeRate = { unit: 'USD', quote: 'SYP', rate: '130' };
export const DATE = '2026-10-30';

export interface Store {
  tenantId: string;
  userId: string;
  accessToken: string;
  device: TestDevice;
}

export async function openStore(app: FastifyInstance, phone = '0912345678'): Promise<Store> {
  const { body } = await registerStore(app, { phone });
  const tenantId: string = body.tenant.id;
  return {
    tenantId,
    userId: body.user.id,
    accessToken: body.accessToken,
    device: await createDevice(tenantId),
  };
}

export async function makeProduct(app: FastifyInstance, store: Store, nameAr: string, priceMinor: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: { authorization: `Bearer ${store.accessToken}` },
    payload: { nameAr, variants: [{ price: { currency: 'SYP', priceMinor } }] },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  return { productId: p.id, variantId: p.variants[0]!.id, name: nameAr };
}

/** Documents as a device makes them: one seq for all, a counter per series. */
export function documents(device: TestDevice, businessDate = DATE) {
  let seq = 0;
  const counters = new Map<string, number>();
  return (type: DocType, payload: unknown, id = newId()): SyncDocument => {
    seq += 1;
    const series = seriesOf(type);
    const n = series ? (counters.get(series) ?? 0) + 1 : 0;
    if (series) counters.set(series, n);
    const body: SyncDocumentBody = {
      id,
      seq,
      type,
      number: series
        ? formatDocNumber({ series, branchCode: '001', deviceCode: device.code, sequence: n })
        : null,
      deviceTime: `${businessDate}T08:59:00.000Z`,
      businessDate,
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps: [],
      payload: payload as Record<string, unknown>,
    };
    return { ...body, hash: payloadHash(body) };
  };
}

export async function push(
  app: FastifyInstance,
  device: TestDevice,
  docs: SyncDocument[],
): Promise<PushResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: { authorization: device.authorization },
    payload: { contractVersion: 1, appVersion: '1.0.0', sentAt: `${DATE}T09:00:00.000Z`, documents: docs },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

let lineIds = 0;
export function cartLine(
  lineNo: number,
  priceMinor: number,
  extra: Partial<SaleCartLine> = {},
): SaleCartLine {
  lineIds += 1;
  return {
    lineNo,
    productId: `0192a3b4-c5d6-7e8f-9a0b-${String(lineIds).padStart(12, '0')}`,
    variantId: `0192a3b4-c5d6-7e8f-9a0b-${String(lineIds + 500_000).padStart(12, '0')}`,
    name: `صنف ${lineNo}`,
    qty: 1000,
    priceCurrency: 'SYP',
    priceMinor,
    taxRateBp: 0,
    ...extra,
  };
}

export function sale(
  store: Pick<Store, 'userId'>,
  shiftId: string,
  cart: Partial<SaleCart> & Pick<SaleCart, 'lines' | 'payments'>,
): SalePayload {
  return buildSalePayload({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [USD_130],
    shiftId,
    cashierId: store.userId,
    cashSteps: {},
    ...cart,
  });
}

/** The golden first sale of 23 › أول بيع: 1,290.00 ل.س paid 9 $ + 200 ل.س, 80.00 ل.س back. */
export function goldenFirstSale(store: Pick<Store, 'userId'>, shiftId: string): SalePayload {
  return sale(store, shiftId, {
    lines: [
      cartLine(1, 5000, { qty: 3000, name: 'ماء' }),
      cartLine(3, 32500, { name: 'لبن' }),
      cartLine(4, 60000, {
        name: 'شاي',
        discount: { type: 'percent', bp: 1000, source: 'manual', reason: null, approval: null },
      }),
      cartLine(5, 27500, { name: 'سكر' }),
    ],
    payments: [
      { method: 'cash', currency: 'USD', amountMinor: 900 },
      { method: 'cash', currency: 'SYP', amountMinor: 20000 },
    ],
    cashSteps: { SYP: 1000, USD: 25 },
  });
}

export const shiftOpen = (userId: string, opening = [{ currency: 'SYP', amountMinor: 100_000 }]) =>
  ({
    openedBy: userId,
    mode: 'per_cashier',
    handoverFromShiftId: null,
    opening: opening.map((o) => ({ ...o, denominations: null })),
  }) as ShiftOpenPayload;

export interface DrawerTerms {
  currency: 'SYP' | 'USD';
  rate?: TradeRate | null;
  opening?: number;
  cashIn?: number;
  changeOut?: number;
  payIn?: number;
  payOut?: number;
  drops?: number;
  counted: number;
}

/** A close whose drawers follow the formula of 10 › مطابقة الصندوق. */
export function shiftClose(
  userId: string,
  shiftId: string,
  drawers: DrawerTerms[],
  extra: Partial<ShiftClosePayload> = {},
): ShiftClosePayload {
  return {
    shiftId,
    shiftNumber: 'SFT-001-002-0000001',
    closedBy: userId,
    baseCurrency: 'SYP',
    cash: drawers.map((d) => {
      const expected =
        (d.opening ?? 0) +
        (d.cashIn ?? 0) -
        (d.changeOut ?? 0) +
        (d.payIn ?? 0) -
        (d.payOut ?? 0) -
        (d.drops ?? 0);
      const difference = d.counted - expected;
      const rate = d.currency === 'SYP' ? null : (d.rate ?? USD_130);
      return {
        currency: d.currency,
        rate,
        openingMinor: d.opening ?? 0,
        cashInMinor: d.cashIn ?? 0,
        changeOutMinor: d.changeOut ?? 0,
        refundsMinor: 0,
        receiptsMinor: 0,
        payInMinor: d.payIn ?? 0,
        fxInMinor: 0,
        payOutMinor: d.payOut ?? 0,
        fxOutMinor: 0,
        dropsMinor: d.drops ?? 0,
        expectedMinor: expected,
        countedMinor: d.counted,
        denominations: null,
        differenceMinor: difference,
        differenceBaseMinor: rate ? difference * Number(rate.rate) : difference,
      };
    }),
    shortageTreatment: 'loss',
    approval: null,
    summary: { saleCount: 0, byMethod: [] },
    forced: false,
    ...extra,
  };
}

export function movement(
  userId: string,
  shiftId: string,
  kind: CashMovementPayload['kind'],
  amountMinor: number,
  extra: Partial<CashMovementPayload> = {},
): CashMovementPayload {
  const currency = extra.currency ?? 'SYP';
  const rate = currency === 'SYP' ? null : USD_130;
  return {
    shiftId,
    kind,
    currency,
    amountMinor,
    baseCurrency: 'SYP',
    rate,
    baseAmountMinor: rate ? amountMinor * 130 : amountMinor,
    reason: kind === 'expense' ? 'فاتورة كهرباء' : 'فكة',
    expenseAccountCode: kind === 'expense' ? '6102' : null,
    reference: null,
    performedBy: userId,
    approval: { userId, method: 'pin', at: `${DATE}T08:58:00.000Z`, offline: false },
    ...extra,
  };
}

export interface PostedLine {
  code: string;
  debit: number;
  credit: number;
  currency: string;
  amount: number;
}

export interface PostedEntry {
  number: string;
  sourceType: string;
  sourceId: string;
  total: number;
  lines: PostedLine[];
}

/** Every entry of a store with its lines, in number order (read as the owner role). */
export async function postedEntries(tenantId: string): Promise<PostedEntry[]> {
  const rows = await ownerDb()<
    {
      number: string;
      source_type: string;
      source_id: string;
      total: string;
      code: string;
      debit: string;
      credit: string;
      currency: string;
      amount: string;
    }[]
  >`
    select e.number, e.source_type, e.source_id, e.total_minor as total, a.code,
           l.debit_minor as debit, l.credit_minor as credit, l.currency, l.amount_minor as amount
    from journal_entries e
    join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where e.tenant_id = ${tenantId}
    order by e.year, e.seq, l.line_no`;
  const entries: PostedEntry[] = [];
  for (const r of rows) {
    let entry = entries.at(-1);
    if (entry?.number !== r.number) {
      entry = {
        number: r.number,
        sourceType: r.source_type,
        sourceId: r.source_id,
        total: Number(r.total),
        lines: [],
      };
      entries.push(entry);
    }
    entry.lines.push({
      code: r.code,
      debit: Number(r.debit),
      credit: Number(r.credit),
      currency: r.currency,
      amount: Number(r.amount),
    });
  }
  return entries;
}

/** Lines as [code, debit, credit] for compact expectations. */
export const compact = (entry: PostedEntry | undefined) =>
  entry?.lines.map((l) => [l.code, l.debit, l.credit] as const);

/** The balance of every account (debit − credit), and of its own currency, across all entries. */
export async function balances(tenantId: string): Promise<Map<string, { base: number; amount: number }>> {
  const rows = await ownerDb()<{ code: string; base: string; amount: string }[]>`
    select a.code, sum(l.debit_minor - l.credit_minor)::text as base, sum(l.amount_minor)::text as amount
    from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where l.tenant_id = ${tenantId}
    group by a.code`;
  return new Map(rows.map((r) => [r.code, { base: Number(r.base), amount: Number(r.amount) }]));
}
