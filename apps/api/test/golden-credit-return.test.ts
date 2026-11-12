import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload, type CustomerDetail, type SalePayload } from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import { createDb, withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import {
  balances,
  cartLine,
  compact,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
} from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Golden case: a credit sale, a part of it returned to the customer's account, then a collection
 * (golden/credit-return/expected.json, written by hand from specs 08 and 10). The same day a cash
 * sale returned in cash shows that path is untouched.
 */

interface Expected {
  entries: { source: string; lines: [string, number, number][] }[];
  statementOfX: { source: string; debit: number; credit: number; balance: number }[];
  balances: Record<string, number>;
  customerBalanceX: number;
}
const expected = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../golden/credit-return/expected.json', import.meta.url)),
    'utf8',
  ),
) as Expected;

let app: FastifyInstance;
const owner = createDb(TEST_OWNER_URL, { max: 1 });
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await owner.client.end();
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

function returnDoc(
  doc: ReturnType<typeof documents>,
  payload: SalePayload,
  sold: SyncDocument,
  shiftId: string,
  userId: string,
  qty: number,
  refundMethod?: 'cash' | 'account',
) {
  const ret = buildReturnPayload({
    sale: payload,
    saleId: sold.id,
    saleNumber: sold.number!,
    shiftId,
    cashierId: userId,
    reason: 'الزبون غيّر رأيه',
    picks: [{ saleLineNo: 1, qty }],
    ...(refundMethod ? { refundMethod } : {}),
  });
  const { hash: _hash, ...body } = doc('return', ret);
  const withDeps = { ...body, deps: [sold.id] };
  return { ...withDeps, hash: payloadHash(withDeps) };
}

describe('golden: credit sale, return to the account, collection', () => {
  it('matches the hand-written journal, statement and balances, and the integrity checks stay green', async () => {
    const store = await openStore(app);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { authorization: `Bearer ${store.accessToken}` },
      payload: { name: 'زبون ذهبي' },
    });
    const customer = created.json<CustomerDetail>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));

    const s1 = sale(store, open.id, {
      lines: [cartLine(1, 10_000, { qty: 3000 })],
      payments: [{ method: 'credit', currency: 'SYP', amountMinor: 30_000 }],
      customerId: customer.id,
      customerName: 'زبون ذهبي',
    });
    const sold1 = doc('sale', s1);
    // No refund method asked: the sale was on account, so the default is the customer's account
    const r1 = returnDoc(doc, s1, sold1, open.id, store.userId, 1000);
    expect(r1.payload).toMatchObject({
      customerId: customer.id,
      refunds: [{ method: 'account', amountMinor: 10_000 }],
    });
    const c1 = doc('receipt', {
      customerId: customer.id,
      customerName: 'زبون ذهبي',
      shiftId: open.id,
      cashierId: store.userId,
      currency: 'SYP',
      amountMinor: 5_000,
      method: 'cash',
      reference: null,
      note: null,
    });
    const s2 = sale(store, open.id, {
      lines: [cartLine(1, 10_000)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 10_000 }],
    });
    const sold2 = doc('sale', s2);
    const r2 = returnDoc(doc, s2, sold2, open.id, store.userId, 1000);
    expect(r2.payload).toMatchObject({ refunds: [{ method: 'cash' }] });
    expect((r2.payload as Record<string, unknown>).customerId).toBeUndefined();

    const res = await push(app, store.device, [open, sold1, r1, c1, sold2, r2]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual(res.results.map(() => ['accepted', []]));

    const entries = await postedEntries(store.tenantId);
    expect(entries.map((e) => compact(e))).toEqual(expected.entries.map((e) => e.lines));

    const b = await balances(store.tenantId);
    for (const [code, base] of Object.entries(expected.balances)) expect(b.get(code)?.base, code).toBe(base);

    const detail = (
      await app.inject({
        method: 'GET',
        url: `/v1/customers/${customer.id}`,
        headers: { authorization: `Bearer ${store.accessToken}` },
      })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(expected.customerBalanceX);
    expect(
      detail.statement.map((l) => ({
        source: l.sourceType,
        debit: l.debitMinor,
        credit: l.creditMinor,
        balance: l.balanceMinor,
      })),
    ).toEqual(expected.statementOfX);

    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-30T12:00:00.000Z'),
    });
    expect(rebuilt).toMatchObject({ same: true, failed: [], replayed: 6 });
  });
});
