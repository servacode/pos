import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  BROADCAST_FOOTER,
  MAX_BROADCAST_RECIPIENTS,
  type Broadcast,
  type BroadcastAudience,
  type broadcastInput,
} from '@serva/core';
import { broadcasts, withTenant, type Transaction } from '@serva/db';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

/**
 * Messages to the store's customers (03 › الألبسة: رسائل للزبائن). The phones are chosen when the
 * broadcast is made and kept with it; the server then sends them one at a time through the message
 * gateway, BROADCAST_DELAY_MS apart, counting what went and what failed, and carries on after a
 * restart. A customer marked «لا يريد رسائل» is never chosen; one broadcast per store at a time.
 */

const who = (audience: BroadcastAudience): SQL => {
  switch (audience.kind) {
    case 'all':
      return sql`true`;
    case 'category':
      return sql`exists (
        with recursive tree as (
          select id from categories where id = ${audience.categoryId}
          union all select c2.id from categories c2 join tree t on c2.parent_id = t.id
        )
        select 1 from invoices i
        join invoice_lines l on l.tenant_id = i.tenant_id and l.invoice_id = i.id
        join products p on p.id = l.product_id
        where i.customer_id = c.id and p.category_id in (select id from tree))`;
    case 'recent':
      return sql`exists (select 1 from invoices i where i.customer_id = c.id
        and i.business_date >= current_date - ${audience.days}::int)`;
  }
};

async function phonesOf(tx: Transaction, audience: BroadcastAudience): Promise<string[]> {
  const rows = await tx.execute<{ phone: string }>(sql`
    select distinct c.phone from customers c
    where c.archived_at is null and not c.no_messages and c.phone is not null and ${who(audience)}
    order by c.phone
    limit ${MAX_BROADCAST_RECIPIENTS + 1}`);
  return rows.map((r) => r.phone);
}

const viewOf = (r: typeof broadcasts.$inferSelect): Broadcast => ({
  id: r.id,
  text: r.text,
  audience: r.audience as BroadcastAudience,
  status: r.status as Broadcast['status'],
  total: r.phones.length,
  sent: r.sent,
  failed: r.failed,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

export function previewBroadcast(
  app: FastifyInstance,
  auth: AccessClaims,
  audience: BroadcastAudience,
): Promise<{ count: number }> {
  return withTenant(app.db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    return { count: Math.min((await phonesOf(tx, audience)).length, MAX_BROADCAST_RECIPIENTS) };
  });
}

export async function createBroadcast(
  app: FastifyInstance,
  auth: AccessClaims,
  input: z.output<typeof broadcastInput>,
  meta: RequestMeta,
): Promise<Broadcast> {
  if (!app.otpSender) {
    throw new AppError(503, 'unavailable', 'إرسال الرسائل غير مفعّل على هذا الخادم بعد.');
  }
  const made = await withTenant(app.db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [busy] = await tx
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(eq(broadcasts.status, 'sending'));
    if (busy) throw new AppError(409, 'conflict', 'رسالة سابقة ما زالت تُرسل. انتظر حتى تنتهي.');
    const phones = await phonesOf(tx, input.audience);
    if (phones.length === 0) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        audience: 'لا زبائن بأرقام جوال في هذا الاختيار.',
      });
    }
    if (phones.length > MAX_BROADCAST_RECIPIENTS) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        audience: `أكثر من ${MAX_BROADCAST_RECIPIENTS} زبون: اختر قسماً أو مدة أقصر.`,
      });
    }
    const [store] = await tx.execute<{ name: string }>(sql`select name from tenants limit 1`);
    const text = `${store?.name ?? ''}\n${input.text}\n\n${BROADCAST_FOOTER}`.trim();
    const [row] = await tx
      .insert(broadcasts)
      .values({ tenantId: auth.tenantId, text, audience: input.audience, phones, createdBy: auth.userId })
      .returning();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'broadcast.created',
        entity: 'broadcast',
        entityId: row!.id,
        data: { audience: input.audience, recipients: phones.length },
      },
      meta,
    );
    return row!;
  });
  void runBroadcast(app, auth.tenantId, made.id);
  return viewOf(made);
}

export function listBroadcasts(app: FastifyInstance, auth: AccessClaims): Promise<{ items: Broadcast[] }> {
  return withTenant(app.db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const rows = await tx.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50);
    return { items: rows.map(viewOf) };
  });
}

const running = new Map<string, Promise<void>>();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends what is left of one broadcast; a second call while it runs joins the first. */
export function runBroadcast(app: FastifyInstance, tenantId: string, id: string): Promise<void> {
  const already = running.get(id);
  if (already) return already;
  const run = (async () => {
    for (;;) {
      const [row] = await withTenant(app.db, tenantId, (tx) =>
        tx.select().from(broadcasts).where(eq(broadcasts.id, id)),
      );
      if (!row || row.status !== 'sending') return;
      if (row.nextIndex >= row.phones.length) {
        await withTenant(app.db, tenantId, (tx) =>
          tx
            .update(broadcasts)
            .set({ status: 'done', finishedAt: sql`now()` })
            .where(eq(broadcasts.id, id)),
        );
        return;
      }
      let ok = true;
      try {
        await app.otpSender!.send({
          phone: row.phones[row.nextIndex]!,
          code: '',
          purpose: 'broadcast',
          text: row.text,
        });
      } catch {
        ok = false;
      }
      await withTenant(app.db, tenantId, (tx) =>
        tx
          .update(broadcasts)
          .set({
            nextIndex: row.nextIndex + 1,
            ...(ok ? { sent: row.sent + 1 } : { failed: row.failed + 1 }),
          })
          .where(and(eq(broadcasts.id, id), eq(broadcasts.nextIndex, row.nextIndex))),
      );
      if (app.env.BROADCAST_DELAY_MS > 0) await pause(app.env.BROADCAST_DELAY_MS);
    }
  })()
    .catch((error: unknown) => app.log.warn({ err: (error as Error).message }, 'broadcast stopped'))
    .finally(() => running.delete(id));
  running.set(id, run);
  return run;
}

/** After a restart: carry on with every broadcast still sending. */
export async function resumeBroadcasts(app: FastifyInstance): Promise<void> {
  if (!app.otpSender) return;
  const rows = await app.db.execute<{ tenant_id: string; id: string }>(
    sql`select * from broadcasts_sending()`,
  );
  for (const r of rows) void runBroadcast(app, r.tenant_id, r.id);
}

/** Tests: wait until every broadcast running now has finished. */
export async function settledBroadcasts(): Promise<void> {
  while (running.size > 0) await Promise.all([...running.values()]);
}
