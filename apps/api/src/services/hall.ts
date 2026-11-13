import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  CANCELLABLE_AFTER_SEND,
  DEFAULT_SECTION,
  isPrepared,
  kitchenMayMove,
  type CancellationRow,
  type CancellationsResponse,
  type HallCommandData,
  type HallCommandResponse,
  type HallLine,
  type HallMenuItem,
  type HallMenuResponse,
  type HallOrder,
  type HallResponse,
  type KitchenCommandData,
  type KitchenResponse,
  type KitchenTicket,
  type LineStatus,
} from '@serva/core';
import {
  categories,
  devices,
  kitchenTickets,
  openOrderEvents,
  openOrderLines,
  openOrders,
  prices,
  products,
  roles,
  tenantSettings,
  userRoles,
  users,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import type { PasswordHasher } from '../auth/passwords';
import type { AccessClaims } from '../auth/tokens';
import { permissionScope, requirePermission } from '../auth/permissions';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { startStaffSession } from './staff';

/**
 * The hall and the kitchen on the server (packages/core › contracts/hall.ts). Every command runs
 * in one transaction under the order's row lock, so two screens adding to one table never
 * overwrite each other; each moves the order's `version` (a trigger on its row) and leaves an
 * event. Rules from 03 › المطاعم: a line is deleted freely until it is sent; after that it is
 * cancelled with a reason and a manager's code; the waiter never closes an order as paid.
 */

const conflict = (message: string) => new AppError(409, 'conflict', message);
const notFound = () => new AppError(404, 'not_found', 'هذا الطلب غير موجود.');
const refuse = (message: string) => new AppError(403, 'forbidden', message);

/** A ready line leaves the kitchen screen after this long if nobody served it */
const READY_STAYS_MINUTES = 15;

type OrderRow = typeof openOrders.$inferSelect;
type LineRow = typeof openOrderLines.$inferSelect;

async function deviceKind(tx: Transaction, device: DeviceClaims): Promise<string> {
  const [row] = await tx.select({ kind: devices.kind }).from(devices).where(eq(devices.id, device.deviceId));
  return row?.kind ?? 'cashier';
}

/** The person acting: an active user who may take orders (or sell) in the device's branch. */
async function actingUser(tx: Transaction, device: DeviceClaims, userId: string) {
  const [user] = await tx
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'active')));
  if (!user) throw refuse('هذا المستخدم غير معروف أو موقوف.');
  for (const permission of ['hall.order', 'sale.create'] as const) {
    const scope = await permissionScope(tx, userId, permission);
    if (scope.all || scope.branchIds.has(device.branchId)) return user;
  }
  throw refuse('ليس لهذا المستخدم صلاحية أخذ طلبات الصالة في هذا الفرع.');
}

async function namesOf(tx: Transaction, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

const lineOf = (r: LineRow, names: Map<string, string>): HallLine => ({
  id: r.id,
  productId: r.productId,
  variantId: r.variantId,
  name: r.name,
  qty: r.qty,
  choices: r.choices,
  note: r.note,
  seat: r.seat,
  section: r.section,
  status: r.status as LineStatus,
  ticketId: r.ticketId,
  addedByName: r.addedBy ? (names.get(r.addedBy) ?? null) : null,
  sentAt: iso(r.sentAt),
  readyAt: iso(r.readyAt),
  servedAt: iso(r.servedAt),
  cancelReason: r.cancelReason,
  cancelledAfterSend: r.cancelledAfterSend,
});

/** Lines deleted before the send are gone for every screen */
const visibleLine = (r: LineRow) => !(r.status === 'cancelled' && !r.cancelledAfterSend);

async function ordersWithLines(tx: Transaction, rows: OrderRow[]): Promise<HallOrder[]> {
  if (rows.length === 0) return [];
  const lineRows = await tx
    .select()
    .from(openOrderLines)
    .where(
      inArray(
        openOrderLines.orderId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(openOrderLines.createdAt), asc(openOrderLines.id));
  const names = await namesOf(tx, [...rows.map((r) => r.openedBy), ...lineRows.map((l) => l.addedBy)]);
  return rows.map((r) => ({
    id: r.id,
    table: r.tableName,
    guests: r.guests,
    status: r.status as HallOrder['status'],
    openedByName: r.openedBy ? (names.get(r.openedBy) ?? null) : null,
    openedAt: r.createdAt.toISOString(),
    billRequestedAt: iso(r.billRequestedAt),
    lines: lineRows.filter((l) => l.orderId === r.id && visibleLine(l)).map((l) => lineOf(l, names)),
    version: r.version,
  }));
}

async function tablesOf(tx: Transaction, tenantId: string): Promise<string[]> {
  const [settings] = await tx
    .select({ service: tenantSettings.service })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));
  return settings?.service?.tables ?? [];
}

/** GET /v1/device/hall: the branch's live orders and its tables */
export function hallState(db: Database, device: DeviceClaims, now: Date): Promise<HallResponse> {
  return withTenant(db, device.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(openOrders)
      .where(
        and(
          eq(openOrders.tenantId, device.tenantId),
          eq(openOrders.branchId, device.branchId),
          ne(openOrders.status, 'closed'),
        ),
      )
      .orderBy(asc(openOrders.createdAt));
    return {
      orders: await ordersWithLines(tx, rows),
      tables: await tablesOf(tx, device.tenantId),
      serverTime: now.toISOString(),
    };
  });
}

async function lockedOrder(tx: Transaction, device: DeviceClaims, orderId: string): Promise<OrderRow> {
  const [row] = await tx
    .select()
    .from(openOrders)
    .where(
      and(
        eq(openOrders.tenantId, device.tenantId),
        eq(openOrders.id, orderId),
        eq(openOrders.branchId, device.branchId),
      ),
    )
    .for('update');
  if (!row) throw notFound();
  return row;
}

const liveOrder = (row: OrderRow): OrderRow => {
  if (row.status === 'closed') throw conflict('أُغلق هذا الطلب. حدّث الصالة.');
  return row;
};

async function touch(tx: Transaction, orderId: string, set: Partial<OrderRow> = {}): Promise<void> {
  await tx
    .update(openOrders)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(openOrders.id, orderId));
}

async function event(
  tx: Transaction,
  device: DeviceClaims,
  orderId: string,
  type: string,
  userId: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  await tx
    .insert(openOrderEvents)
    .values({ tenantId: device.tenantId, orderId, type, data, userId, deviceId: device.deviceId });
}

/** Each category's top-level ancestor name: the kitchen section of its products */
async function sectionsOfProducts(tx: Transaction, productIds: string[]): Promise<Map<string, string>> {
  const cats = await tx
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rootName = (id: string | null): string => {
    let at = id ? byId.get(id) : undefined;
    for (let hops = 0; at?.parentId && hops < 10; hops++) at = byId.get(at.parentId);
    return at?.name ?? DEFAULT_SECTION;
  };
  const rows = await tx
    .select({ id: products.id, categoryId: products.categoryId })
    .from(products)
    .where(and(inArray(products.id, productIds), eq(products.sellOnPos, true)));
  return new Map(rows.map((p) => [p.id, rootName(p.categoryId)]));
}

async function nextTicketSeq(tx: Transaction, tenantId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kitchen_tickets'), hashtext(${tenantId}))`);
  const [last] = await tx.execute<{ seq: number | null }>(
    sql`select max(seq) as seq from kitchen_tickets where tenant_id = ${tenantId}`,
  );
  return (last?.seq ?? 0) + 1;
}

async function orderResponse(tx: Transaction, orderId: string): Promise<HallCommandResponse> {
  const [row] = await tx.select().from(openOrders).where(eq(openOrders.id, orderId));
  if (!row || row.status === 'closed') return { order: null };
  return { order: (await ordersWithLines(tx, [row]))[0]! };
}

/** POST /v1/device/hall: one command on a table's order */
export async function hallCommandRun(
  db: Database,
  passwords: PasswordHasher,
  device: DeviceClaims,
  command: HallCommandData,
  now: Date,
  meta: RequestMeta,
): Promise<HallCommandResponse> {
  // The manager's code is checked first and on its own (its failures are counted and kept even
  // when the rest of the command is refused), the same check as a cashier's sign-in.
  let approver: { id: string; fullName: string } | null = null;
  if (command.type === 'cancel') {
    const session = await startStaffSession(
      db,
      passwords,
      device,
      { userId: command.approverId, pin: command.approverPin },
      now,
      meta,
    );
    if (!session.permissions.includes('hall.cancel_approve')) {
      throw refuse('هذا المستخدم لا يملك صلاحية الموافقة على الإلغاء.');
    }
    approver = { id: session.userId, fullName: session.fullName };
  }

  return withTenant(db, device.tenantId, async (tx) => {
    const kind = await deviceKind(tx, device);
    if (kind === 'kitchen_screen') throw refuse('شاشة المطبخ لا تعدّل الطلبات.');
    const user = await actingUser(tx, device, command.userId);

    if (command.type === 'open') {
      const tables = await tablesOf(tx, device.tenantId);
      if (!tables.includes(command.table)) {
        throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
          table: 'هذه الطاولة غير موجودة في الصالة.',
        });
      }
      const [made] = await tx
        .insert(openOrders)
        .values({
          tenantId: device.tenantId,
          branchId: device.branchId,
          tableName: command.table,
          guests: command.guests ?? null,
          openedBy: user.id,
          deviceId: device.deviceId,
        })
        .onConflictDoNothing()
        .returning();
      const [live] = made
        ? [made]
        : await tx
            .select()
            .from(openOrders)
            .where(
              and(
                eq(openOrders.tenantId, device.tenantId),
                eq(openOrders.branchId, device.branchId),
                eq(openOrders.tableName, command.table),
                ne(openOrders.status, 'closed'),
              ),
            );
      if (made) await event(tx, device, made.id, 'opened', user.id, { table: command.table });
      return orderResponse(tx, live!.id);
    }

    const order = liveOrder(await lockedOrder(tx, device, command.orderId));

    switch (command.type) {
      case 'add': {
        const sections = await sectionsOfProducts(
          tx,
          command.lines.map((l) => l.productId),
        );
        const found = await tx
          .select({ id: variants.id, productId: variants.productId, archivedAt: variants.archivedAt })
          .from(variants)
          .where(
            inArray(
              variants.id,
              command.lines.map((l) => l.variantId),
            ),
          );
        const productOf = new Map(found.map((v) => [v.id, v.productId]));
        // The menu leaves archived items out (hallMenu); a till that still shows one is told so.
        const archivedProducts = new Set(
          (
            await tx
              .select({ id: products.id })
              .from(products)
              .where(
                and(
                  inArray(
                    products.id,
                    command.lines.map((l) => l.productId),
                  ),
                  isNotNull(products.archivedAt),
                ),
              )
          ).map((p) => p.id),
        );
        const archivedVariants = new Set(found.filter((v) => v.archivedAt).map((v) => v.id));
        const rows = command.lines.map((l, i) => {
          if (archivedProducts.has(l.productId) || archivedVariants.has(l.variantId)) {
            throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
              lines: `الصنف «${l.name}» مؤرشف ولم يعد في القائمة. حدّث القائمة واحذفه من الطلب.`,
            });
          }
          const section = sections.get(l.productId);
          if (!section || productOf.get(l.variantId) !== l.productId) {
            throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
              lines: 'صنف غير موجود في القائمة.',
            });
          }
          return {
            tenantId: device.tenantId,
            orderId: order.id,
            productId: l.productId,
            variantId: l.variantId,
            name: l.name,
            qty: l.qty,
            choices: l.choices,
            note: l.note || null,
            seat: l.seat ?? null,
            section,
            addedBy: user.id,
            createdAt: new Date(now.getTime() + i),
          };
        });
        await tx.insert(openOrderLines).values(rows);
        // New items after the bill was asked for put the table back to «مشغولة»
        await touch(tx, order.id, { status: 'open', billRequestedAt: null });
        await event(tx, device, order.id, 'added', user.id, { lines: rows.length });
        break;
      }
      case 'remove': {
        const [line] = await tx
          .select()
          .from(openOrderLines)
          .where(and(eq(openOrderLines.id, command.lineId), eq(openOrderLines.orderId, order.id)))
          .for('update');
        if (!line) throw new AppError(404, 'not_found', 'هذا البند غير موجود.');
        if (line.status === 'cancelled' && !line.cancelledAfterSend) break;
        if (line.status !== 'new') {
          throw conflict('أُرسل هذا البند للمطبخ. إلغاؤه يحتاج سبباً ورمز المدير.');
        }
        await tx
          .update(openOrderLines)
          .set({ status: 'cancelled', cancelledAt: now, cancelledBy: user.id, updatedAt: sql`now()` })
          .where(eq(openOrderLines.id, line.id));
        await touch(tx, order.id);
        await event(tx, device, order.id, 'removed', user.id, { lineId: line.id });
        break;
      }
      case 'send': {
        const fresh = await tx
          .select()
          .from(openOrderLines)
          .where(and(eq(openOrderLines.orderId, order.id), eq(openOrderLines.status, 'new')))
          .orderBy(asc(openOrderLines.createdAt), asc(openOrderLines.id))
          .for('update');
        if (fresh.length === 0) throw conflict('لا بنود جديدة للإرسال.');
        const [earlier] = await tx
          .select({ id: kitchenTickets.id })
          .from(kitchenTickets)
          .where(eq(kitchenTickets.orderId, order.id))
          .limit(1);
        const bySection = new Map<string, LineRow[]>();
        for (const line of fresh) bySection.set(line.section, [...(bySection.get(line.section) ?? []), line]);
        for (const [section, lines] of bySection) {
          const [ticket] = await tx
            .insert(kitchenTickets)
            .values({
              tenantId: device.tenantId,
              branchId: device.branchId,
              orderId: order.id,
              seq: await nextTicketSeq(tx, device.tenantId),
              section,
              tableName: order.tableName,
              kind: earlier ? 'add' : 'new',
              sentBy: user.id,
            })
            .returning({ id: kitchenTickets.id });
          await tx
            .update(openOrderLines)
            .set({ status: 'sent', ticketId: ticket!.id, sentAt: now, updatedAt: sql`now()` })
            .where(
              inArray(
                openOrderLines.id,
                lines.map((l) => l.id),
              ),
            );
        }
        await touch(tx, order.id);
        await event(tx, device, order.id, 'sent', user.id, {
          lines: fresh.length,
          sections: [...bySection.keys()],
        });
        break;
      }
      case 'bill': {
        const live = await tx
          .select({ id: openOrderLines.id, status: openOrderLines.status })
          .from(openOrderLines)
          .where(eq(openOrderLines.orderId, order.id));
        if (!live.some((l) => l.status !== 'cancelled'))
          throw conflict('لا بنود على هذه الطاولة لطلب الحساب.');
        if (order.status === 'open') {
          await touch(tx, order.id, { status: 'bill_requested', billRequestedAt: now });
          await event(tx, device, order.id, 'bill_requested', user.id);
        }
        break;
      }
      case 'serve': {
        const served = await tx
          .update(openOrderLines)
          .set({ status: 'served', servedAt: now, updatedAt: sql`now()` })
          .where(
            and(
              eq(openOrderLines.orderId, order.id),
              inArray(openOrderLines.id, command.lineIds),
              eq(openOrderLines.status, 'ready'),
            ),
          )
          .returning({ id: openOrderLines.id });
        if (served.length === 0) throw conflict('لا بنود جاهزة بين المحدّدة.');
        await touch(tx, order.id);
        await event(tx, device, order.id, 'served', user.id, { lines: served.length });
        break;
      }
      case 'cancel': {
        const [line] = await tx
          .select()
          .from(openOrderLines)
          .where(and(eq(openOrderLines.id, command.lineId), eq(openOrderLines.orderId, order.id)))
          .for('update');
        if (!line) throw new AppError(404, 'not_found', 'هذا البند غير موجود.');
        if (line.status === 'new') throw conflict('لم يُرسل هذا البند بعد: احذفه دون موافقة.');
        if (!CANCELLABLE_AFTER_SEND.includes(line.status as LineStatus)) {
          throw conflict(line.status === 'served' ? 'قُدِّم هذا البند للزبون.' : 'أُلغي هذا البند من قبل.');
        }
        const stage = isPrepared(line.status as LineStatus) ? 'after_prep' : 'before_prep';
        await tx
          .update(openOrderLines)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            cancelReason: command.reason,
            cancelledBy: user.id,
            approvedBy: approver!.id,
            cancelledAfterSend: true,
            cancelStage: stage,
            updatedAt: sql`now()`,
          })
          .where(eq(openOrderLines.id, line.id));
        await touch(tx, order.id);
        await event(tx, device, order.id, 'cancelled', user.id, {
          lineId: line.id,
          item: line.name,
          reason: command.reason,
          stage,
          approvedBy: approver!.id,
        });
        break;
      }
      case 'close': {
        if (command.reason === 'paid' && kind === 'waiter') {
          throw refuse('النادل لا يقبض: الدفع على جهاز الكاشير.');
        }
        const lines = await tx
          .select()
          .from(openOrderLines)
          .where(eq(openOrderLines.orderId, order.id))
          .for('update');
        if (command.reason === 'empty' && lines.some((l) => l.status !== 'new' && l.status !== 'cancelled')) {
          throw conflict('وصلت بنود للمطبخ: ألغِها بموافقة المدير أو ادفع الطلب.');
        }
        // Items never sent are dropped with the order
        await tx
          .update(openOrderLines)
          .set({ status: 'cancelled', cancelledAt: now, cancelledBy: user.id, updatedAt: sql`now()` })
          .where(and(eq(openOrderLines.orderId, order.id), eq(openOrderLines.status, 'new')));
        await touch(tx, order.id, {
          status: 'closed',
          closedAt: now,
          closedReason: command.reason,
          closedRef: command.ref || null,
        });
        await event(tx, device, order.id, 'closed', user.id, {
          reason: command.reason,
          ref: command.ref ?? null,
        });
        break;
      }
    }
    return orderResponse(tx, order.id);
  });
}

/** The root categories: the sections a kitchen screen can choose to show */
async function sectionNames(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ name: categories.name })
    .from(categories)
    .where(and(isNull(categories.parentId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map((r) => r.name);
}

/** GET /v1/device/kitchen: tickets with something still to prepare, oldest first */
export function kitchenState(db: Database, device: DeviceClaims, now: Date): Promise<KitchenResponse> {
  return withTenant(db, device.tenantId, async (tx) => {
    const readyCutoff = new Date(now.getTime() - READY_STAYS_MINUTES * 60_000);
    const live = await tx
      .selectDistinct({ ticketId: openOrderLines.ticketId })
      .from(openOrderLines)
      .innerJoin(
        openOrders,
        and(eq(openOrders.tenantId, openOrderLines.tenantId), eq(openOrders.id, openOrderLines.orderId)),
      )
      .where(
        and(
          eq(openOrders.branchId, device.branchId),
          or(
            inArray(openOrderLines.status, ['sent', 'preparing']),
            and(eq(openOrderLines.status, 'ready'), gte(openOrderLines.readyAt, readyCutoff)),
            and(
              eq(openOrderLines.status, 'cancelled'),
              eq(openOrderLines.cancelledAfterSend, true),
              isNull(openOrderLines.kitchenAckAt),
            ),
          ),
        ),
      );
    const ids = live.flatMap((r) => (r.ticketId ? [r.ticketId] : []));
    const tickets = ids.length
      ? await tx
          .select()
          .from(kitchenTickets)
          .where(inArray(kitchenTickets.id, ids))
          .orderBy(asc(kitchenTickets.createdAt), asc(kitchenTickets.seq))
      : [];
    const lineRows = ids.length
      ? await tx
          .select()
          .from(openOrderLines)
          .where(inArray(openOrderLines.ticketId, ids))
          .orderBy(asc(openOrderLines.createdAt), asc(openOrderLines.id))
      : [];
    const out: KitchenTicket[] = tickets.map((t) => ({
      id: t.id,
      seq: t.seq,
      section: t.section,
      table: t.tableName,
      kind: t.kind as 'new' | 'add',
      createdAt: t.createdAt.toISOString(),
      lines: lineRows
        .filter((l) => l.ticketId === t.id && visibleLine(l))
        .map((l) => ({
          id: l.id,
          name: l.name,
          qty: l.qty,
          choices: l.choices.map((c) => c.name),
          note: l.note,
          seat: l.seat,
          status: l.status as LineStatus,
          readyAt: iso(l.readyAt),
          cancelReason: l.cancelReason,
        })),
    }));
    const sections = [...new Set([...(await sectionNames(tx)), ...out.map((t) => t.section)])];
    return { tickets: out, sections, serverTime: now.toISOString() };
  });
}

/** POST /v1/device/kitchen: a line moves along, or a cancellation is seen */
export async function kitchenCommandRun(
  db: Database,
  device: DeviceClaims,
  command: KitchenCommandData,
  now: Date,
): Promise<KitchenResponse> {
  await withTenant(db, device.tenantId, async (tx) => {
    if ((await deviceKind(tx, device)) !== 'kitchen_screen') {
      throw refuse('هذا الجهاز ليس شاشة مطبخ.');
    }
    const rows = await tx
      .select({ line: openOrderLines })
      .from(openOrderLines)
      .innerJoin(
        openOrders,
        and(eq(openOrders.tenantId, openOrderLines.tenantId), eq(openOrders.id, openOrderLines.orderId)),
      )
      .where(and(inArray(openOrderLines.id, command.lineIds), eq(openOrders.branchId, device.branchId)))
      .for('update', { of: openOrderLines });
    if (rows.length !== new Set(command.lineIds).size)
      throw new AppError(404, 'not_found', 'هذا البند غير موجود.');
    const touched = new Set<string>();
    for (const { line } of rows) {
      if (command.type === 'ack') {
        if (!line.cancelledAfterSend || line.kitchenAckAt) continue;
        await tx
          .update(openOrderLines)
          .set({ kitchenAckAt: now, updatedAt: sql`now()` })
          .where(eq(openOrderLines.id, line.id));
        continue;
      }
      const from = line.status as LineStatus;
      if (from === command.status) continue;
      if (!kitchenMayMove(from, command.status)) throw conflict('تغيّرت حالة هذا البند. حدّث الشاشة.');
      await tx
        .update(openOrderLines)
        .set({
          status: command.status,
          preparingAt:
            command.status === 'preparing' ? now : command.status === 'sent' ? null : line.preparingAt,
          readyAt: command.status === 'ready' ? now : null,
          updatedAt: sql`now()`,
        })
        .where(eq(openOrderLines.id, line.id));
      touched.add(line.orderId);
    }
    // The tills and waiter screens read the order's version, so a progress moves it too
    for (const orderId of touched) await touch(tx, orderId);
  });
  return kitchenState(db, device, now);
}

/** GET /v1/device/menu: what the waiter orders from, and who can sign in to do it */
export function hallMenu(db: Database, device: DeviceClaims): Promise<HallMenuResponse> {
  return withTenant(db, device.tenantId, async (tx) => {
    const [settings] = await tx
      .select({ base: tenantSettings.baseCurrency, service: tenantSettings.service })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, device.tenantId));
    const base = settings?.base ?? 'SYP';
    const rows = await tx
      .select({
        productId: products.id,
        variantId: variants.id,
        nameAr: products.nameAr,
        label: variants.label,
        categoryId: products.categoryId,
        modifiers: products.modifiers,
        priceMinor: prices.priceMinor,
      })
      .from(products)
      .innerJoin(
        variants,
        and(
          eq(variants.tenantId, products.tenantId),
          eq(variants.productId, products.id),
          isNull(variants.archivedAt),
        ),
      )
      .innerJoin(
        prices,
        and(eq(prices.tenantId, variants.tenantId), eq(prices.id, variants.id), eq(prices.currency, base)),
      )
      .where(and(eq(products.sellOnPos, true), isNull(products.archivedAt)))
      .orderBy(asc(products.nameAr), asc(variants.sortOrder))
      .limit(2000);
    const sections = await sectionsOfProducts(tx, [...new Set(rows.map((r) => r.productId))]);
    const cats = await tx.select({ id: categories.id, name: categories.name }).from(categories);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    const items: HallMenuItem[] = rows.map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      name: r.label ? `${r.nameAr} · ${r.label}` : r.nameAr,
      category: (r.categoryId ? catName.get(r.categoryId) : null) ?? DEFAULT_SECTION,
      section: sections.get(r.productId) ?? DEFAULT_SECTION,
      priceMinor: r.priceMinor,
      modifiers: r.modifiers,
    }));

    const people = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        pinLength: users.pinLength,
        hasPin: users.pinHash,
        permissions: roles.permissions,
        branchId: userRoles.branchId,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.status, 'active')))
      .orderBy(asc(users.fullName));
    const here = people.filter((p) => p.branchId === null || p.branchId === device.branchId);
    const staff = new Map<string, { id: string; fullName: string; pinLength: 4 | 6 }>();
    const approvers = new Map<string, { id: string; fullName: string }>();
    for (const p of here) {
      if (!p.hasPin) continue;
      if (p.permissions.includes('hall.order') || p.permissions.includes('sale.create')) {
        staff.set(p.id, { id: p.id, fullName: p.fullName, pinLength: p.pinLength === 6 ? 6 : 4 });
      }
      if (p.permissions.includes('hall.cancel_approve'))
        approvers.set(p.id, { id: p.id, fullName: p.fullName });
    }
    return {
      currency: base,
      items,
      staff: [...staff.values()],
      approvers: [...approvers.values()],
      tables: settings?.service?.tables ?? [],
    };
  });
}

/** GET /v1/hall/cancellations: every line cancelled after the kitchen, with who and why */
export function cancellationsReport(
  db: Database,
  auth: AccessClaims,
  query: { from?: string; to?: string },
  now: Date,
): Promise<CancellationsResponse> {
  const to = query.to ?? now.toISOString().slice(0, 10);
  const from = query.from ?? new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'report.view');
    const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000);
    const rows = await tx
      .select({ line: openOrderLines, table: openOrders.tableName, branchId: openOrders.branchId })
      .from(openOrderLines)
      .innerJoin(
        openOrders,
        and(eq(openOrders.tenantId, openOrderLines.tenantId), eq(openOrders.id, openOrderLines.orderId)),
      )
      .where(
        and(
          eq(openOrderLines.cancelledAfterSend, true),
          gte(openOrderLines.cancelledAt, new Date(`${from}T00:00:00Z`)),
          lt(openOrderLines.cancelledAt, nextDay),
        ),
      )
      .orderBy(desc(openOrderLines.cancelledAt))
      .limit(500);
    const allowed = rows.filter((r) => scope.all || scope.branchIds.has(r.branchId));
    const names = await namesOf(
      tx,
      allowed.flatMap((r) => [r.line.cancelledBy, r.line.approvedBy]),
    );
    const items: CancellationRow[] = allowed.map((r) => ({
      at: r.line.cancelledAt!.toISOString(),
      table: r.table,
      item: r.line.name,
      qty: r.line.qty,
      reason: r.line.cancelReason ?? '',
      stage: r.line.cancelStage === 'after_prep' ? 'after_prep' : 'before_prep',
      waiterName: r.line.cancelledBy ? (names.get(r.line.cancelledBy) ?? null) : null,
      approverName: r.line.approvedBy ? (names.get(r.line.approvedBy) ?? null) : null,
    }));
    return { items, from, to };
  });
}
