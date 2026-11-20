import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  Cheque,
  PartyStatement,
  SupplierListResponse,
  SupplierOpeningBalanceResult,
  SupplierRow,
} from '@serva/core';
import { createUuidV7 } from '@serva/sync';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { checkIntegrity } from '../src/services/integrity';
import { withTenant } from '@serva/db';
import { appDb } from './helpers';

/**
 * Round 47: a supplier cheque dated ahead waits in 2150 «شيكات مستحقة الدفع» until it is marked cleared or
 * cancelled; a supplier's opening balance is posted against 3900. The test clock stands on 2026-10-30.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const newId = createUuidV7();
const as = (s: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${s.accessToken}` });
const post = (store: Store, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: as(store), payload: payload as object });
const get = (store: Store, url: string) => app.inject({ method: 'GET', url, headers: as(store) });

async function setUp() {
  const store = await openStore(app);
  const supplier = (await post(store, '/v1/suppliers', { name: 'معمل الأمل' })).json<SupplierRow>();
  return { store, supplierId: supplier.id };
}

const balanceOf = async (store: Store, supplierId: string) =>
  (await get(store, '/v1/suppliers')).json<SupplierListResponse>().items.find((s) => s.id === supplierId)!
    .balanceMinor;

/** The lines of every entry of a source, as «code side amount» in the order posted */
const linesOf = async (store: Store, sourceType: string) =>
  ownerDb()<{ code: string; debit: string; credit: string; party: string | null }[]>`
    select a.code, l.debit_minor::text as debit, l.credit_minor::text as credit, l.party_type as party
    from journal_lines l
    join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where e.tenant_id = ${store.tenantId} and e.source_type = ${sourceType}
    order by e.year, e.seq, l.line_no`;

const shape = (rows: Awaited<ReturnType<typeof linesOf>>) =>
  rows.map((r) => `${r.code} ${Number(r.debit) > 0 ? `Dr ${r.debit}` : `Cr ${r.credit}`}`);

const cheques = async (store: Store) => (await get(store, '/v1/cheques')).json<{ items: Cheque[] }>().items;

const payByCheque = (
  store: Store,
  supplierId: string,
  dueDate: string,
  extra: Record<string, unknown> = {},
) =>
  post(store, '/v1/supplier-payments', {
    supplierId,
    date: '2026-10-30',
    amountMinor: 40_000,
    method: 'bank',
    cheque: { bank: 'بنك بيمو', number: '55102', dueDate },
    advance: true,
    ...extra,
  });

const problems = async (store: Store) =>
  (await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId))).checks.flatMap(
    (c) => c.problems.map((p) => `${c.name}: ${p}`),
  );

describe('a supplier cheque dated ahead', () => {
  it('issue posts Dr supplier / Cr 2150 and the bank is untouched; clearing posts Dr 2150 / Cr bank', async () => {
    const { store, supplierId } = await setUp();
    const paid = await payByCheque(store, supplierId, '2026-12-15');
    expect(paid.statusCode, paid.body).toBe(201);
    expect(shape(await linesOf(store, 'supplier_payment'))).toEqual(['2100 Dr 40000', '2150 Cr 40000']);
    const [row] = await cheques(store);
    expect(row).toMatchObject({ direction: 'out', payable: true, status: 'pending', amountMinor: 40_000 });
    // The money has not left the bank in any report: 1130 has no line
    const bankLines = (await linesOf(store, 'supplier_payment')).filter((l) => l.code === '1130');
    expect(bankLines).toHaveLength(0);

    // Not before its due day
    const early = await post(store, '/v1/cheques/actions', {
      sourceType: 'supplier_payment',
      sourceId: row!.sourceId,
      paymentNo: 1,
      action: 'cleared',
      date: '2026-11-01',
    });
    expect(early.statusCode).toBe(400);

    const cleared = await post(store, '/v1/cheques/actions', {
      sourceType: 'supplier_payment',
      sourceId: row!.sourceId,
      paymentNo: 1,
      action: 'cleared',
      date: '2026-12-15',
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json<Cheque>()).toMatchObject({ status: 'cleared', actionDate: '2026-12-15' });
    expect(shape(await linesOf(store, 'cheque'))).toEqual(['2150 Dr 40000', '1130 Cr 40000']);
    // Once only
    const again = await post(store, '/v1/cheques/actions', {
      sourceType: 'supplier_payment',
      sourceId: row!.sourceId,
      paymentNo: 1,
      action: 'cleared',
      date: '2026-12-16',
    });
    expect(again.statusCode).toBe(409);
    expect(await problems(store)).toEqual([]);
  });

  it('cancelled before clearing: Dr 2150 / Cr the supplier, the supplier is owed again', async () => {
    const { store, supplierId } = await setUp();
    await payByCheque(store, supplierId, '2026-12-15');
    expect(await balanceOf(store, supplierId)).toBe(-40_000);
    const [row] = await cheques(store);
    const bounced = await post(store, '/v1/cheques/actions', {
      sourceType: 'supplier_payment',
      sourceId: row!.sourceId,
      paymentNo: 1,
      action: 'bounced',
      date: '2026-11-05',
    });
    expect(bounced.statusCode, bounced.body).toBe(200);
    expect(bounced.json<Cheque>().status).toBe('bounced');
    const lines = await linesOf(store, 'cheque');
    expect(shape(lines)).toEqual(['2150 Dr 40000', '2100 Cr 40000']);
    expect(lines[1]!.party).toBe('supplier');
    expect(await balanceOf(store, supplierId)).toBe(0);
    expect(await problems(store)).toEqual([]);
  });

  it('a cheque dated today or earlier still leaves the bank at once, and an old one cannot be acted on', async () => {
    const { store, supplierId } = await setUp();
    await payByCheque(store, supplierId, '2026-10-30');
    await payByCheque(store, supplierId, '2026-10-01', {
      cheque: { bank: 'بنك', number: '7', dueDate: '2026-10-01' },
    });
    expect(shape(await linesOf(store, 'supplier_payment'))).toEqual([
      '2100 Dr 40000',
      '1130 Cr 40000',
      '2100 Dr 40000',
      '1130 Cr 40000',
    ]);
    const items = await cheques(store);
    expect(items.every((c) => !c.payable)).toBe(true);
    const act = await post(store, '/v1/cheques/actions', {
      sourceType: 'supplier_payment',
      sourceId: items[0]!.sourceId,
      paymentNo: 1,
      action: 'cleared',
      date: '2026-11-02',
    });
    expect(act.statusCode).toBe(404);
  });

  it('a cheque action on a supplier cheque needs purchases.manage and an open period', async () => {
    const { store, supplierId } = await setUp();
    await payByCheque(store, supplierId, '2026-11-10', { date: '2026-10-20' });
    const [row] = await cheques(store);
    const closed = await post(store, '/v1/period-close/close', { through: '2026-10-25' });
    expect(closed.statusCode, closed.body).toBe(200);
    const refused = await post(store, '/v1/cheques/actions', {
      sourceType: 'supplier_payment',
      sourceId: row!.sourceId,
      paymentNo: 1,
      action: 'bounced',
      date: '2026-10-25',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('period_closed');
  });
});

describe("a supplier's opening balance", () => {
  const open = (store: Store, supplierId: string, body: Record<string, unknown>) =>
    post(store, `/v1/suppliers/${supplierId}/opening-balance`, body);

  it('a debt posts Dr 3900 / Cr 2100, once per id, and shows in the statement as its own line', async () => {
    const { store, supplierId } = await setUp();
    const id = newId();
    const first = await open(store, supplierId, { id, kind: 'debt', amountMinor: 250_000 });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<SupplierOpeningBalanceResult>()).toMatchObject({
      kind: 'debt',
      date: '2026-10-30',
      balanceBeforeMinor: 0,
      balanceAfterMinor: 250_000,
    });
    const again = await open(store, supplierId, { id, kind: 'debt', amountMinor: 250_000 });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<SupplierOpeningBalanceResult>().number).toBe(
      first.json<SupplierOpeningBalanceResult>().number,
    );
    expect(shape(await linesOf(store, 'manual'))).toEqual(['3900 Dr 250000', '2100 Cr 250000']);
    expect(await balanceOf(store, supplierId)).toBe(250_000);
    const statement = (
      await get(store, `/v1/suppliers/${supplierId}/statement?from=2026-10-01&to=2026-11-30`)
    ).json<PartyStatement>();
    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0]).toMatchObject({
      sourceType: 'manual',
      memo: 'رصيد افتتاحي — معمل الأمل',
      creditMinor: 250_000,
      balanceMinor: 250_000,
    });
    expect(await problems(store)).toEqual([]);
  });

  it('a credit posts Dr 2100 / Cr 3900', async () => {
    const { store, supplierId } = await setUp();
    const res = await open(store, supplierId, { kind: 'credit', amountMinor: 90_000, date: '2026-10-20' });
    expect(res.statusCode, res.body).toBe(201);
    expect(shape(await linesOf(store, 'manual'))).toEqual(['2100 Dr 90000', '3900 Cr 90000']);
    expect(await balanceOf(store, supplierId)).toBe(-90_000);
  });

  it('refuses a day in a closed period, and an unknown supplier, and a wrong amount', async () => {
    const { store, supplierId } = await setUp();
    expect((await post(store, '/v1/period-close/close', { through: '2026-10-25' })).statusCode).toBe(200);
    const refused = await open(store, supplierId, { kind: 'debt', amountMinor: 1_000, date: '2026-10-20' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('period_closed');
    expect((await open(store, newId(), { kind: 'debt', amountMinor: 1_000 })).statusCode).toBe(404);
    expect((await open(store, supplierId, { kind: 'debt', amountMinor: -5 })).statusCode).toBe(400);
    expect(await linesOf(store, 'manual')).toHaveLength(0);
  });

  it('a dollar debt is kept in dollars at the rate, like any dollar debt, and the credit reverses it', async () => {
    const store = await openStore(app);
    const enable = await app.inject({
      method: 'PUT',
      url: '/v1/store/currency',
      headers: as(store),
      payload: { usdEnabled: true, usdRate: '120' },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    const supplierId = (await post(store, '/v1/suppliers', { name: 'مورد' })).json<SupplierRow>().id;
    const res = await open(store, supplierId, {
      kind: 'debt',
      amountMinor: 10_000,
      currency: 'USD',
      rate: '150',
    });
    expect(res.statusCode, res.body).toBe(201);
    const rowOf = async () =>
      (await get(store, '/v1/suppliers'))
        .json<SupplierListResponse>()
        .items.find((x) => x.id === supplierId)!;
    let row = await rowOf();
    expect(row).toMatchObject({ usdBalanceMinor: 10_000, usdBookMinor: 1_500_000, balanceMinor: 1_500_000 });
    const back = await open(store, supplierId, {
      kind: 'credit',
      amountMinor: 10_000,
      currency: 'USD',
      rate: '150',
    });
    expect(back.statusCode, back.body).toBe(201);
    row = await rowOf();
    expect(row).toMatchObject({ usdBalanceMinor: 0, balanceMinor: 0 });
    expect(await problems(store)).toEqual([]);
  });
});
