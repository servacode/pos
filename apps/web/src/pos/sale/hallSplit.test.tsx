import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HallCommandResponse, HallOrder, HallResponse } from '@serva/core';
import type { SalePayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { ids, PRODUCTS, posSets, staffServer } from '../../test/pos';
import { saleScreen } from '../../test/renderPos';

/**
 * The till and a table's order on the server (03 › المطاعم): splitting the bill by items or equally,
 * moving and merging tables, and cancelling a line the kitchen already has.
 */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const due = () => screen.getByRole('status', { name: 'المطلوب' });

function cafeSets() {
  const sets = posSets();
  sets.settings = [
    {
      ...sets.settings[0]!,
      service: { tables: ['1', '2', 'VIP'], orderNumbers: true, kitchenTickets: true },
    },
  ];
  // The branch manager may approve cancelling a line after the kitchen
  sets.roles = sets.roles.map((r) =>
    r.key === 'manager' ? { ...r, permissions: [...r.permissions, 'hall.cancel_approve'] } : r,
  ) as typeof sets.roles;
  return sets;
}

const TEA = PRODUCTS.tea;
const OIL = PRODUCTS.oil;
const ORDER_ID = '0192a000-0000-7000-8000-0000000000a1';
const OTHER_ID = '0192a000-0000-7000-8000-0000000000a2';

const lineOf = (n: number, item: typeof TEA, qty: number, seat: number | null) => ({
  id: `0192a000-0000-7000-8000-0000000000b${n}`,
  productId: item.product.id,
  variantId: item.variant.id,
  name: item.product.nameAr,
  qty,
  choices: [],
  note: null,
  seat,
  section: 'مشروبات',
  status: 'sent' as const,
  ticketId: 't1',
  addedByName: 'نادل أول',
  sentAt: '2026-11-12T10:01:00.000Z',
  readyAt: null,
  servedAt: null,
  cancelReason: null,
  cancelledAfterSend: false,
});

const orderOf = (id: string, table: string, lines: HallOrder['lines'], extra: Partial<HallOrder> = {}) =>
  ({
    id,
    table,
    guests: 2,
    status: 'open',
    openedByName: 'نادل أول',
    openedAt: '2026-11-12T10:00:00.000Z',
    billRequestedAt: null,
    paidLineIds: [],
    equal: null,
    version: 3,
    lines,
    ...extra,
  }) satisfies HallOrder;

/** Table 2: two teas for seat 1 and a bottle of oil for seat 2, all with the kitchen */
const tableTwo = (extra: Partial<HallOrder> = {}) =>
  orderOf(ORDER_ID, '2', [lineOf(1, TEA, 2, 1), lineOf(2, OIL, 1, 2)], extra);

interface Call {
  body: Record<string, unknown> | null;
}

function hallServer(initial: HallOrder[]) {
  const staff = staffServer(cafeSets());
  let orders = initial;
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path !== '/v1/device/hall') return staff(url, init);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ body });
    if (!body) {
      const state: HallResponse = { orders, tables: ['1', '2', 'VIP'], serverTime: new Date().toISOString() };
      return new Response(JSON.stringify(state), { status: 200 });
    }
    let answer: HallCommandResponse = { order: null };
    const order = orders.find((o) => o.id === body.orderId) ?? null;
    if (body.type === 'move' && order) {
      orders = orders.map((o) => (o.id === order.id ? { ...o, table: String(body.table) } : o));
      answer = { order: orders.find((o) => o.id === order.id)! };
    } else if (body.type === 'merge' && order) {
      const from = orders.find((o) => o.id === body.fromOrderId)!;
      orders = orders
        .filter((o) => o.id !== from.id)
        .map((o) => (o.id === order.id ? { ...o, lines: [...o.lines, ...from.lines] } : o));
      answer = { order: orders.find((o) => o.id === order.id)! };
    } else if (body.type === 'cancel') {
      if (body.approverPin === '000000') {
        return new Response(JSON.stringify({ error: { code: 'pin_invalid', message: 'رمز غير صحيح' } }), {
          status: 401,
        });
      }
      answer = { order };
    } else {
      answer = { order };
    }
    return new Response(JSON.stringify(answer), { status: 200 });
  });
  return {
    fetch: fn as unknown as typeof fetch,
    commands: () => calls.filter((c) => c.body).map((c) => c.body!),
  };
}

async function openTable(
  user: Awaited<ReturnType<typeof saleScreen>>['user'],
  table: string,
  state = 'مشغولة',
) {
  await user.click(screen.getByRole('button', { name: 'الطاولات' }));
  const board = await screen.findByRole('region', { name: 'الطاولات' });
  await user.click(await within(board).findByRole('button', { name: `طاولة ${table} ${state}` }));
}

async function payExact(user: Awaited<ReturnType<typeof saleScreen>>['user']) {
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

describe('splitting the bill at the till', () => {
  it('charges the picked seat as its own sale and tells the server which lines were paid', async () => {
    const server = hallServer([tableTwo()]);
    const { user, outbox } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await openTable(user, '2');
    expect(plain(due())).toContain('950 ل.س');

    await user.click(screen.getByRole('button', { name: 'قسّم الحساب' }));
    const panel = await screen.findByRole('region', { name: 'تقسيم الحساب' });
    await user.click(within(panel).getByRole('button', { name: 'مقعد 1' }));
    await user.click(within(panel).getByRole('button', { name: /ادفع المحدد/ }));
    // Only the two teas are this sale
    expect(plain(due())).toContain('700 ل.س');

    await payExact(user);
    const sale = outbox.find((e) => e.type === 'sale')!;
    expect((sale.doc.payload as unknown as SalePayload).lines).toHaveLength(1);
    await waitFor(() => expect(server.commands().some((c) => c.type === 'part')).toBe(true));
    expect(server.commands().find((c) => c.type === 'part')).toMatchObject({
      type: 'part',
      orderId: ORDER_ID,
      lineIds: [tableTwo().lines[0]!.id],
      ref: sale.doc.number,
    });
    // It is a part: the table is not closed by the till itself
    expect(server.commands().some((c) => c.type === 'close')).toBe(false);
  });

  it('brings back only what is unpaid after a part was charged', async () => {
    const server = hallServer([tableTwo({ paidLineIds: [tableTwo().lines[0]!.id] })]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await openTable(user, '2');
    // The teas were paid in an earlier part: only the oil is left
    expect(plain(due())).toContain('250 ل.س');
  });

  it('charges the first of three equal shares of the whole table', async () => {
    const server = hallServer([tableTwo()]);
    const { user, outbox } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await openTable(user, '2');
    await user.click(screen.getByRole('button', { name: 'قسّم الحساب' }));
    const panel = await screen.findByRole('region', { name: 'تقسيم الحساب' });
    await user.click(within(panel).getByRole('button', { name: 'بالتساوي' }));
    await user.click(within(panel).getByRole('button', { name: 'زِد' }));
    expect(within(panel).getByLabelText('عدد الأجزاء')).toHaveTextContent('3');
    await user.click(within(panel).getByRole('button', { name: /ابدأ: الجزء الأول من 3/ }));
    await payExact(user);
    const lines = (outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload).lines;
    // 2 teas and 1 oil, a third each (thousandths of a pack)
    expect(lines.map((l) => l.qty)).toEqual([666, 333]);
    await waitFor(() => expect(server.commands().some((c) => c.type === 'part')).toBe(true));
    expect(server.commands().find((c) => c.type === 'part')).toMatchObject({
      type: 'part',
      orderId: ORDER_ID,
      equal: { parts: 3 },
    });
  });

  it('refuses to split while the cart holds lines the kitchen has not got', async () => {
    const server = hallServer([tableTwo()]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await openTable(user, '2');
    await user.keyboard('{F2}');
    await user.keyboard(`${PRODUCTS.milk.barcode!.code}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'قسّم الحساب' }));
    const panel = await screen.findByRole('region', { name: 'تقسيم الحساب' });
    expect(within(panel).getByText(/لم تُرسل بعد/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'مقعد 1' }));
    expect(within(panel).getByRole('button', { name: /ادفع المحدد/ })).toBeDisabled();
  });
});

describe('moving and merging tables at the till', () => {
  it('moves an order to a free table and merges it into a busy one', async () => {
    const other = orderOf(OTHER_ID, '1', [lineOf(3, OIL, 1, null)]);
    const server = hallServer([tableTwo(), other]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    const board = await screen.findByRole('region', { name: 'الطاولات' });
    await within(board).findByRole('button', { name: 'طاولة 2 مشغولة' });
    await user.click(within(board).getByRole('button', { name: 'نقل / دمج' }));
    await user.click(within(board).getByRole('button', { name: 'طاولة VIP فارغة' }));
    expect(within(board).getByText(/الطاولة VIP فارغة: لا طلب لنقله/)).toBeInTheDocument();
    await user.click(within(board).getByRole('button', { name: 'طاولة 2 مشغولة' }));
    await user.click(within(board).getByRole('button', { name: 'طاولة VIP فارغة' }));
    await waitFor(() =>
      expect(server.commands().find((c) => c.type === 'move')).toMatchObject({
        orderId: ORDER_ID,
        table: 'VIP',
      }),
    );

    await user.click(await within(board).findByRole('button', { name: 'نقل / دمج' }));
    await user.click(within(board).getByRole('button', { name: 'طاولة VIP مشغولة' }));
    await user.click(within(board).getByRole('button', { name: 'طاولة 1 مشغولة' }));
    await waitFor(() =>
      expect(server.commands().find((c) => c.type === 'merge')).toMatchObject({
        orderId: OTHER_ID,
        fromOrderId: ORDER_ID,
      }),
    );
  });
});

describe('cancelling a line the kitchen has, from the till', () => {
  async function removeTea(user: Awaited<ReturnType<typeof saleScreen>>['user']) {
    await openTable(user, '2');
    const cart = await screen.findByRole('list', { name: 'أسطر الفاتورة' });
    await user.click(within(cart).getByText('شاي أحمر 400 غ'));
    const minus = await screen.findByRole('button', { name: 'أنقص الكمية' });
    await user.click(minus);
    await user.click(screen.getByRole('button', { name: 'أنقص الكمية' }));
  }

  it('asks for a reason and the manager’s code and sends the server’s cancel for the line', async () => {
    const server = hallServer([tableTwo()]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await removeTea(user);
    const panel = await screen.findByRole('region', { name: 'إلغاء بند بعد المطبخ' });
    await user.type(within(panel).getByLabelText('سبب الإلغاء'), 'غيّر الزبون رأيه');
    await user.click(within(panel).getByRole('radio', { name: 'مريم' }));
    for (const digit of '147258') await user.click(within(panel).getByRole('button', { name: digit }));
    await waitFor(() => expect(server.commands().some((c) => c.type === 'cancel')).toBe(true));
    expect(server.commands().find((c) => c.type === 'cancel')).toMatchObject({
      type: 'cancel',
      orderId: ORDER_ID,
      lineId: tableTwo().lines[0]!.id,
      reason: 'غيّر الزبون رأيه',
      approverId: ids.maryam,
      approverPin: '147258',
    });
    // The line left the cart, with no «تراجع» to bring it back
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'أسطر الفاتورة' })).queryByText('شاي أحمر 400 غ'),
      ).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'تراجع' })).toBeNull();
  });

  it('keeps today’s way when asked: the line leaves this cart only', async () => {
    const server = hallServer([tableTwo()]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await removeTea(user);
    await user.click(await screen.findByRole('button', { name: /احذفه من هنا فقط/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'أسطر الفاتورة' })).queryByText('شاي أحمر 400 غ'),
      ).toBeNull(),
    );
    expect(server.commands().some((c) => c.type === 'cancel')).toBe(false);
  });

  it('shows a wrong code and does not remove the line', async () => {
    const server = hallServer([tableTwo()]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await removeTea(user);
    const panel = await screen.findByRole('region', { name: 'إلغاء بند بعد المطبخ' });
    await user.type(within(panel).getByLabelText('سبب الإلغاء'), 'خطأ في الطلب');
    await user.click(within(panel).getByRole('radio', { name: 'مريم' }));
    for (const digit of '000000') await user.click(within(panel).getByRole('button', { name: digit }));
    await waitFor(() => expect(server.commands().some((c) => c.type === 'cancel')).toBe(true));
    expect(screen.getByRole('region', { name: 'إلغاء بند بعد المطبخ' })).toBeInTheDocument();
  });
});
