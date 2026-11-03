/**
 * Task M0-3: received is not posted.
 *
 * A document whose type has no processor used to be stored as accepted and stamped processed_at
 * on arrival, so 18 of the 22 types looked handled with nothing behind them: no entry, no stock,
 * no drawer. Now such a document is stored whole and stays accepted (the device stops resending
 * it), carries the flag held_for_processing, and keeps processed_at null. processed_at is set only
 * when a processor has run.
 *
 * DOC_SERIES has 22 types: 4 posted today, 18 held. Covered here, for every one of them: the answer the device gets, what the inbox keeps,
 * what is posted and what is not; a resend, a duplicate, an interrupted push and a processor added
 * later; and the migration that corrects the rows stored before this change.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload } from '@serva/core';
import { DOC_TYPES, payloadHash, type DocType, type PushResponse, type SyncDocument } from '@serva/sync';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import type { SyncProcessors } from '../src/services/sync-push';
import {
  documents,
  goldenFirstSale,
  movement,
  openStore,
  shiftClose,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** The types this server posts today; every other type in DOC_SERIES is held. */
const PROCESSED = Object.keys(DOCUMENT_PROCESSORS).sort() as DocType[];
const HELD = DOC_TYPES.filter((t) => !PROCESSED.includes(t));

let app: FastifyInstance;
const extraApps: FastifyInstance[] = [];
async function appWith(syncProcessors: SyncProcessors): Promise<FastifyInstance> {
  const made = await makeApp({}, { syncProcessors });
  extraApps.push(made);
  return made;
}

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await Promise.all([app, ...extraApps].map((a) => a.close()));
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

async function push(on: FastifyInstance, store: Store, docs: SyncDocument[]): Promise<PushResponse> {
  const res = await on.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: { authorization: store.device.authorization },
    payload: { contractVersion: 1, appVersion: '1.0.0', sentAt: '2026-10-30T09:00:00.000Z', documents: docs },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PushResponse>();
}

interface InboxRow {
  doc_id: string;
  doc_type: string;
  status: string;
  flags: string[];
  processed_at: Date | null;
  payload_hash: string;
}
const inbox = async (tenantId: string) =>
  new Map(
    (
      await ownerDb()<InboxRow[]>`
        select doc_id, doc_type, status, flags, processed_at, payload_hash
        from sync_inbox where tenant_id = ${tenantId}`
    ).map((r) => [r.doc_id, r]),
  );

/** Every row any processor writes for a document, keyed by the document's own id. */
async function postedFor(tenantId: string, ids: string[]) {
  const [row] = await ownerDb()<{ invoices: number; shifts: number; movements: number; entries: number }[]>`
    select
      (select count(*) from invoices where tenant_id = ${tenantId} and id = any(${ids}::uuid[]))::int as invoices,
      (select count(*) from shifts where tenant_id = ${tenantId}
         and (id = any(${ids}::uuid[]) or close_doc_id = any(${ids}::uuid[])))::int as shifts,
      (select count(*) from cash_movements where tenant_id = ${tenantId} and id = any(${ids}::uuid[]))::int as movements,
      (select count(*) from journal_entries where tenant_id = ${tenantId} and source_id = any(${ids}::uuid[]))::int as entries`;
  return row!;
}

/** The same document, depending on others (the device hashes what it sends, deps included). */
function dependingOn(doc: SyncDocument, deps: string[]): SyncDocument {
  const { hash: _old, ...body } = doc;
  const next = { ...body, deps };
  return { ...next, hash: payloadHash(next) };
}

/** A shift opened and closed with every drawer balanced: its close posts no entry. */
function balancedShift(store: Store, doc: ReturnType<typeof documents>) {
  const open = doc('shift_open', shiftOpen(store.userId));
  const close = doc(
    'shift_close',
    shiftClose(store.userId, open.id, [{ currency: 'SYP', opening: 100_000, counted: 100_000 }], {
      shiftNumber: open.number!,
    }),
  );
  return [open, close];
}

/** One valid document of each processed type, in an order the processors accept. */
function processedDocs(store: Store, doc: ReturnType<typeof documents>) {
  const open = doc('shift_open', shiftOpen(store.userId));
  const golden = goldenFirstSale(store, open.id);
  const sold = doc('sale', golden);
  const customer = doc('customer', { name: 'أبو خالد', phone: null, createdBy: store.userId });
  return [
    open,
    sold,
    doc('cash_movement', movement(store.userId, open.id, 'pay_in', 50_000)),
    doc(
      'shift_close',
      shiftClose(store.userId, open.id, [{ currency: 'SYP', opening: 100_000, counted: 150_000 }]),
    ),
    doc(
      'return',
      buildReturnPayload({
        sale: golden,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'تالف',
        picks: [{ saleLineNo: 3, qty: 1000 }],
      }),
    ),
    customer,
    doc('receipt', {
      customerId: customer.id,
      customerName: 'أبو خالد',
      shiftId: open.id,
      cashierId: store.userId,
      currency: 'SYP',
      amountMinor: 5_000,
      method: 'wallet',
      reference: 'W-1',
      note: null,
    }),
  ];
}

describe('which types are posted today', () => {
  it('splits DOC_SERIES into the 8 types with a processor and the 15 held ones', () => {
    expect(PROCESSED).toEqual([
      'cash_movement',
      'customer',
      'gift_voucher',
      'receipt',
      'return',
      'sale',
      'shift_close',
      'shift_open',
    ]);
    expect(DOC_TYPES).toHaveLength(23);
    // When a phase adds a processor this number drops: the held documents of that type are then
    // the catch-up of that phase (M1), never posted here on their own.
    expect(HELD).toHaveLength(15);
  });
});

describe('a type with no processor', () => {
  it.each(HELD)('%s: accepted and kept whole, flagged held, never posted', async (type) => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const sent = doc(type, { total: 1500, note: `${type} document` });

    const res = await push(app, store, [sent]);
    expect(res.results).toEqual([
      { id: sent.id, status: 'accepted', flags: ['held_for_processing'], receivedAt: expect.any(String) },
    ]);
    const row = (await inbox(store.tenantId)).get(sent.id)!;
    expect(row).toMatchObject({
      doc_type: type,
      status: 'accepted',
      flags: ['held_for_processing'],
      processed_at: null,
      payload_hash: sent.hash,
    });
    expect(await postedFor(store.tenantId, [sent.id])).toEqual({
      invoices: 0,
      shifts: 0,
      movements: 0,
      entries: 0,
    });
  });
});

describe('a type with a processor', () => {
  it('sale, shift_open, cash_movement and shift_close are posted, stamped and never flagged held', async () => {
    const store = await openStore(app);
    const docs = processedDocs(store, documents(store.device));

    const res = await push(app, store, docs);
    for (const result of res.results) {
      expect(result.status).toBe('accepted');
      expect(result.flags).not.toContain('held_for_processing');
    }
    const rows = await inbox(store.tenantId);
    for (const d of docs) {
      expect(rows.get(d.id)!.processed_at, d.type).toBeInstanceOf(Date);
      expect(rows.get(d.id)!.flags, d.type).not.toContain('held_for_processing');
    }
    const posted = await postedFor(
      store.tenantId,
      docs.map((d) => d.id),
    );
    expect(posted.invoices).toBe(1);
    expect(posted.movements).toBe(1);
    expect(posted.shifts).toBe(1);
    expect(posted.entries).toBeGreaterThan(0);
  });

  it('a rejected document is neither posted nor stamped, and is not mistaken for a held one', async () => {
    const store = await openStore(app);
    const bad = documents(store.device)('sale', { not: 'a sale' });
    const res = await push(app, store, [bad]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'invalid_payload', flags: [] });
    expect((await inbox(store.tenantId)).get(bad.id)).toMatchObject({ processed_at: null, flags: [] });
  });
});

describe('waiting for a document of another device (pending_link)', () => {
  // processed_at must not claim more than happened. The processors never read deps or the
  // status (processors.ts), and linking a waiting document only changes its status and flags
  // (linkWaiting in sync-push.ts): every financial effect is written when the processor runs, on
  // arrival. So a waiting document with a processor is posted in full, and one without stays held.
  it('a waiting sale is posted in full on arrival, and linking it later adds nothing', async () => {
    const store = await openStore(app);
    const other = { ...store, device: await createDevice(store.tenantId) };
    const missing = documents(other.device)('cart_event', { name: 'زبون' });
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = dependingOn(doc('sale', goldenFirstSale(store, open.id)), [missing.id]);

    const early = await push(app, store, [open, sold]);
    expect(early.results[1]).toMatchObject({ status: 'pending_link', flags: ['pending_link'] });
    const before = (await inbox(store.tenantId)).get(sold.id)!;
    expect(before.processed_at).toBeInstanceOf(Date);
    const posted = await postedFor(store.tenantId, [sold.id]);
    expect(posted).toMatchObject({ invoices: 1, entries: 1 });

    await push(app, other, [missing]);
    const after = (await inbox(store.tenantId)).get(sold.id)!;
    expect(after).toMatchObject({ status: 'accepted', flags: [] });
    expect(after.processed_at).toEqual(before.processed_at);
    expect(await postedFor(store.tenantId, [sold.id])).toEqual(posted);
  });

  it('a waiting document with no processor stays held before and after it is linked', async () => {
    const store = await openStore(app);
    const other = { ...store, device: await createDevice(store.tenantId) };
    const missing = documents(other.device)('cart_event', { name: 'زبون' });
    const ret = dependingOn(documents(store.device)('trade_in', { total: 500 }), [missing.id]);

    await push(app, store, [ret]);
    expect((await inbox(store.tenantId)).get(ret.id)).toMatchObject({
      status: 'pending_link',
      flags: ['pending_link', 'held_for_processing'],
      processed_at: null,
    });
    await push(app, other, [missing]);
    expect((await inbox(store.tenantId)).get(ret.id)).toMatchObject({
      status: 'accepted',
      flags: ['held_for_processing'],
      processed_at: null,
    });
    expect(await postedFor(store.tenantId, [ret.id])).toMatchObject({ entries: 0 });
  });
});

describe('resend and duplicate', () => {
  it('all 22 types sent twice: the second answer is the first, and nothing is posted twice', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const docs = [...processedDocs(store, doc), ...HELD.map((type) => doc(type, { total: 1500 }))];
    expect(new Set(docs.map((d) => d.type)).size).toBe(22);

    const first = await push(app, store, docs);
    const before = await inbox(store.tenantId);
    const postedBefore = await postedFor(
      store.tenantId,
      docs.map((d) => d.id),
    );

    const again = await push(app, store, docs);
    for (const [i, result] of again.results.entries()) {
      const original = first.results[i]!;
      expect(result).toMatchObject({
        id: original.id,
        status: 'duplicate',
        outcome: original.status,
        flags: original.flags,
        receivedAt: original.receivedAt,
      });
    }
    // The held ones are still held, the posted ones keep the stamp they had.
    const after = await inbox(store.tenantId);
    for (const d of docs) {
      expect(after.get(d.id)!.processed_at, d.type).toEqual(before.get(d.id)!.processed_at);
      expect(after.get(d.id)!.flags, d.type).toEqual(before.get(d.id)!.flags);
    }
    expect(
      await postedFor(
        store.tenantId,
        docs.map((d) => d.id),
      ),
    ).toEqual(postedBefore);
  });
});

describe('an interrupted push', () => {
  it('a processor that fails mid-batch keeps nothing of that document, and the held ones beside it are safe', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc('sale', goldenFirstSale(store, open.id));
    const held = doc('trade_in', { total: 500 });

    let fail = true;
    const flaky = await appWith({
      ...DOCUMENT_PROCESSORS,
      sale: async (ctx) => {
        if (fail) throw new Error('connection lost mid-posting');
        return DOCUMENT_PROCESSORS.sale!(ctx);
      },
    });

    const cut = await push(flaky, store, [open, sold, held]);
    expect(cut.results.map((r) => [r.id, r.status])).toEqual([
      [open.id, 'accepted'],
      [sold.id, 'retry'],
      [held.id, 'accepted'],
    ]);
    const rows = await inbox(store.tenantId);
    expect(rows.has(sold.id)).toBe(false);
    expect(await postedFor(store.tenantId, [sold.id])).toMatchObject({ invoices: 0, entries: 0 });
    expect(rows.get(held.id)).toMatchObject({ flags: ['held_for_processing'], processed_at: null });

    // The device sends the batch again: the sale is posted once, the rest answer as before.
    fail = false;
    const resent = await push(flaky, store, [open, sold, held]);
    expect(resent.results.map((r) => [r.id, r.status])).toEqual([
      [open.id, 'duplicate'],
      [sold.id, 'accepted'],
      [held.id, 'duplicate'],
    ]);
    expect(await postedFor(store.tenantId, [sold.id])).toMatchObject({ invoices: 1, entries: 1 });
    expect((await inbox(store.tenantId)).get(held.id)).toMatchObject({
      flags: ['held_for_processing'],
      processed_at: null,
    });
  });

  it('a lost answer: the device resends a held document and is told again it is held', async () => {
    const store = await openStore(app);
    const held = documents(store.device)('quotation', { total: 900 });
    await push(app, store, [held]); // the answer never reached the device
    const replay = await push(app, store, [held]);
    expect(replay.results[0]).toMatchObject({
      status: 'duplicate',
      outcome: 'accepted',
      flags: ['held_for_processing'],
    });
  });
});

describe('a processor added later (the boundary of the M1 catch-up)', () => {
  it('a new server posts new documents of the type, and never silently posts the held ones', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const old = doc('quotation', { total: 900 });
    await push(app, store, [old]);

    const ran: string[] = [];
    const upgraded = await appWith({
      ...DOCUMENT_PROCESSORS,
      quotation: async ({ doc: d }) => {
        ran.push(d.id);
      },
    });

    // The old quotation arrives again after the upgrade: it is a duplicate, its processor does not run.
    const replay = await push(upgraded, store, [old]);
    expect(replay.results[0]).toMatchObject({ status: 'duplicate', flags: ['held_for_processing'] });
    expect(ran).toEqual([]);

    // A new quotation is posted by the new processor.
    const fresh = doc('quotation', { total: 400 });
    const res = await push(upgraded, store, [fresh]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: [] });
    expect(ran).toEqual([fresh.id]);

    // What the catch-up will have to post is exactly the held set, kept whole.
    const waiting = await ownerDb()<{ doc_id: string; payload_hash: string }[]>`
      select doc_id, payload_hash from sync_inbox
      where tenant_id = ${store.tenantId} and processed_at is null and 'held_for_processing' = any(flags)`;
    expect(waiting).toEqual([{ doc_id: old.id, payload_hash: old.hash }]);
    const rows = await inbox(store.tenantId);
    expect(rows.get(fresh.id)!.processed_at).toBeInstanceOf(Date);
  });
});

describe('what the merchant sees', () => {
  it('the evidence screen counts held documents apart from what arrived', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    await push(app, store, [...processedDocs(store, doc), ...HELD.map((type) => doc(type, { total: 1 }))]);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/evidence?deviceId=${store.device.deviceId}&date=2026-10-30`,
      headers: { authorization: `Bearer ${store.accessToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ sent: 22, accepted: 22, heldForProcessing: 15 });
  });
});

describe('migration 0013: the rows stored before this change', () => {
  const MIGRATION = readFileSync(
    new URL('../../../packages/db/drizzle/0013_held_for_processing.sql', import.meta.url),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  const migrate = async () => {
    for (const statement of MIGRATION) await ownerDb().unsafe(statement);
  };
  /** What the old code stored: every row stamped on arrival, nothing flagged held. */
  const restoreOldState = (tenantId: string) =>
    ownerDb()`
      update sync_inbox set processed_at = received_at, flags = array_remove(flags, 'held_for_processing')
      where tenant_id = ${tenantId}`;

  it('turns the old rows into exactly what the new code stores, and processes nothing', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    // 0013 knew the four processors of its day; a return was held then.
    const docs = [
      ...processedDocs(store, doc).slice(0, 4),
      ...balancedShift(store, doc),
      ...HELD.map((type) => doc(type, { total: 1500 })),
      doc('sale', { not: 'a sale' }), // rejected
    ];
    await push(app, store, docs);
    const expected = await inbox(store.tenantId);
    const posted = await postedFor(
      store.tenantId,
      docs.map((d) => d.id),
    );

    await restoreOldState(store.tenantId);
    const old = await inbox(store.tenantId);
    expect([...old.values()].every((r) => r.processed_at !== null)).toBe(true);

    await migrate();
    const corrected = await inbox(store.tenantId);
    for (const [id, row] of expected) {
      expect(corrected.get(id)!.flags, row.doc_type).toEqual(row.flags);
      expect(corrected.get(id)!.processed_at === null, row.doc_type).toBe(row.processed_at === null);
    }
    // Nothing was posted by the migration.
    expect(
      await postedFor(
        store.tenantId,
        docs.map((d) => d.id),
      ),
    ).toEqual(posted);
  });

  // Phase 1 step 2 had the four processors but no posting: invoices, cash movements and shifts
  // were written, journal entries came with step 3 (0012_accounting) with no backfill. A row alone
  // does not prove the document was posted.
  it('holds what a step-2 database posted without an entry, and keeps what needs none', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const [open, sold, moved, closed] = processedDocs(store, doc);
    const [balancedOpen, balancedClose] = balancedShift(store, doc);
    await push(app, store, [open!, sold!, moved!, closed!, balancedOpen!, balancedClose!]);
    expect(await postedFor(store.tenantId, [balancedClose!.id])).toMatchObject({ entries: 0 });

    // The database as step 2 left it: every row a processor wrote, and no entry at all.
    // (Entries are append-only; TRUNCATE skips the row triggers, as resetDatabase does.)
    await ownerDb().unsafe('truncate table journal_lines, journal_entries');
    await restoreOldState(store.tenantId);
    await migrate();

    const rows = await inbox(store.tenantId);
    const held = (d: SyncDocument) => rows.get(d.id)!.processed_at === null;
    expect(held(sold!), 'sale with an invoice but no entry').toBe(true);
    expect(held(moved!), 'cash movement with no entry').toBe(true);
    expect(held(closed!), 'unbalanced close with no entry').toBe(true);
    expect(held(open!), 'an opening posts no entry').toBe(false);
    expect(held(balancedOpen!)).toBe(false);
    expect(held(balancedClose!), 'a balanced close posts no entry').toBe(false);
    expect(rows.get(sold!.id)!.flags).toContain('held_for_processing');
  });

  it('holds a phase-0 sale stored before its processor existed, and runs twice without harm', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const early = doc('sale', goldenFirstSale(store, open.id));
    const phaseZero = await appWith({}); // no processor at all: nothing was posted
    await push(phaseZero, store, [open, early]);
    await restoreOldState(store.tenantId);

    await migrate();
    await migrate();
    const rows = await inbox(store.tenantId);
    for (const d of [open, early]) {
      expect(rows.get(d.id), d.type).toMatchObject({
        status: 'accepted',
        flags: ['held_for_processing'],
        processed_at: null,
      });
    }
  });
});
