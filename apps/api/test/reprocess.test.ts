import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auditLogs } from '@serva/db';
import { DocumentRejection, type DocumentProcessor } from '../src/services/sync-push';
import { reprocessHeld } from '../src/services/reprocess';
import { documents, openStore, push, type Store } from './accounting-fixtures';
import { createDevice, type TestDevice } from './devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Task M1-4: the catch-up of held documents. Customers have no processor yet, so they arrive held
 * (M0-3); a processor added later posts them, in each till's order, each on its own, once.
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

const META = { ip: '127.0.0.1', userAgent: 'test' };
const NOW = new Date('2026-11-03T10:00:00.000Z');

interface Row {
  doc_id: string;
  status: string;
  result_code: string | null;
  flags: string[];
  processed_at: Date | null;
}
const inbox = async (tenantId: string) =>
  ownerDb()<Row[]>`select doc_id, status, result_code, flags, processed_at from sync_inbox
    where tenant_id = ${tenantId} order by device_id, device_seq`;

let store: Store;
let second: TestDevice;
let ids: Record<'a1' | 'a2' | 'a3' | 'b1' | 'b2', string>;

beforeEach(async () => {
  await resetDatabase();
  store = await openStore(app, '0912121212');
  second = await createDevice(store.tenantId);
  const a = documents(store.device);
  const b = documents(second);
  const docs = {
    a1: a('customer', { name: 'أحمد' }),
    a2: a('customer', { name: 'bad' }),
    a3: a('customer', { name: 'سامر' }),
    b1: b('customer', { name: 'invalid' }),
    b2: b('customer', { name: 'ليلى' }),
  };
  // Sent out of order: the catch-up must still follow each till's own order
  await push(app, store.device, [docs.a3, docs.a1, docs.a2]);
  await push(app, second, [docs.b2, docs.b1]);
  ids = { a1: docs.a1.id, a2: docs.a2.id, a3: docs.a3.id, b1: docs.b1.id, b2: docs.b2.id };
});

/** Posts nothing but records the order; "bad" fails after writing, "invalid" is rejected. */
function fakeProcessor(seen: string[]): DocumentProcessor {
  return async ({ tx, doc }) => {
    seen.push(doc.id);
    const name = (doc.payload as { name: string }).name;
    await tx
      .insert(auditLogs)
      .values({ tenantId: store.tenantId, action: `posted ${name}`, actorType: 'system' });
    if (name === 'bad') throw new Error('database said no');
    if (name === 'invalid') throw new DocumentRejection('customer_invalid');
    return { flags: name === 'ليلى' ? ['permission_stale'] : [] };
  };
}

describe('the catch-up of held documents', () => {
  it('starts from documents that arrived held, with no processor', async () => {
    const rows = await inbox(store.tenantId);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.status).toBe('accepted');
      expect(r.flags).toContain('held_for_processing');
      expect(r.processed_at).toBeNull();
    }
  });

  it('posts them in each till’s order, each on its own: one failure stays held, one is rejected', async () => {
    const seen: string[] = [];
    const report = await reprocessHeld(
      appDb().db,
      { tenantId: store.tenantId, type: 'customer', processors: { customer: fakeProcessor(seen) }, now: NOW },
      META,
    );
    const firstTill = [ids.a1, ids.a2, ids.a3];
    const secondTill = [ids.b1, ids.b2];
    // Each till in its own order, whatever order they arrived in
    expect(seen.filter((id) => firstTill.includes(id))).toEqual(firstTill);
    expect(seen.filter((id) => secondTill.includes(id))).toEqual(secondTill);

    expect(report).toMatchObject({ found: 5, processed: 3 });
    expect(report.rejected).toEqual([{ docId: ids.b1, code: 'customer_invalid' }]);
    expect(report.failed.map((f) => f.docId)).toEqual([ids.a2]);

    const rows = Object.fromEntries((await inbox(store.tenantId)).map((r) => [r.doc_id, r]));
    for (const id of [ids.a1, ids.a3]) {
      expect(rows[id]!.flags).not.toContain('held_for_processing');
      expect(rows[id]!.processed_at).toEqual(NOW);
    }
    expect(rows[ids.b2]!.flags).toEqual(['permission_stale']);
    expect(rows[ids.b1]).toMatchObject({
      status: 'rejected',
      result_code: 'customer_invalid',
      processed_at: null,
    });
    expect(rows[ids.b1]!.flags).not.toContain('held_for_processing');
    // The failure left nothing behind, and stays held for the next run
    expect(rows[ids.a2]).toMatchObject({ status: 'accepted', processed_at: null });
    expect(rows[ids.a2]!.flags).toContain('held_for_processing');
    const posted = await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${store.tenantId} and action like 'posted %' order by action`;
    expect(posted.map((p) => p.action).sort()).toEqual(['posted أحمد', 'posted سامر', 'posted ليلى']);
  });

  it('posts nothing twice when run again, and only retries what is still held', async () => {
    const first: string[] = [];
    await reprocessHeld(
      appDb().db,
      {
        tenantId: store.tenantId,
        type: 'customer',
        processors: { customer: fakeProcessor(first) },
        now: NOW,
      },
      META,
    );
    const again: string[] = [];
    const report = await reprocessHeld(
      appDb().db,
      {
        tenantId: store.tenantId,
        type: 'customer',
        processors: { customer: fakeProcessor(again) },
        now: NOW,
      },
      META,
    );
    expect(again).toEqual([ids.a2]);
    expect(report).toMatchObject({ found: 1, processed: 0 });
  });

  it('a till resending its documents after the catch-up changes nothing', async () => {
    await reprocessHeld(
      appDb().db,
      { tenantId: store.tenantId, type: 'customer', processors: { customer: fakeProcessor([]) }, now: NOW },
      META,
    );
    const before = await inbox(store.tenantId);
    const a = documents(store.device);
    const res = await push(app, store.device, [a('customer', { name: 'أحمد' }, ids.a1)]);
    expect(res.results[0]!.status).toBe('duplicate');
    expect(await inbox(store.tenantId)).toEqual(before);
  });

  it('touches no other store and no other type', async () => {
    const other = await openStore(app, '0913131313');
    const o = documents(other.device);
    await push(app, other.device, [o('customer', { name: 'غريب' })]);
    await reprocessHeld(
      appDb().db,
      { tenantId: store.tenantId, type: 'customer', processors: { customer: fakeProcessor([]) }, now: NOW },
      META,
    );
    const [row] = await inbox(other.tenantId);
    expect(row!.flags).toContain('held_for_processing');
    expect(row!.processed_at).toBeNull();
  });

  it('writes the run to the audit log', async () => {
    await reprocessHeld(
      appDb().db,
      { tenantId: store.tenantId, type: 'customer', processors: { customer: fakeProcessor([]) }, now: NOW },
      META,
    );
    const [entry] = await ownerDb()<{ actor_type: string; data: Record<string, number | string> }[]>`
      select actor_type, data from audit_logs where tenant_id = ${store.tenantId} and action = 'documents.reprocess_held'`;
    expect(entry!.actor_type).toBe('system');
    expect(entry!.data).toEqual({ type: 'customer', found: 5, processed: 3, rejected: 1, failed: 1 });
  });

  it('refuses a type that still has no processor', async () => {
    await expect(
      reprocessHeld(
        appDb().db,
        { tenantId: store.tenantId, type: 'customer', processors: {}, now: NOW },
        META,
      ),
    ).rejects.toThrow(/No processor for customer/);
  });
});
