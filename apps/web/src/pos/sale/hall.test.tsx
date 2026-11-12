import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HallCommandResponse, HallOrder, HallResponse } from '@serva/core';
import type { SalePayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { PRODUCTS, posSets, staffServer } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/**
 * The till and the server's open orders (03 › وضع النادل): the table board shows orders a waiter
 * started, a table charged at the till closes its order, «للمطبخ» reaches the server, and a till
 * that cannot reach it works exactly as before.
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
  return sets;
}

const TEA = PRODUCTS.tea;

/** A waiter's order for table 2: two teas, already with the kitchen */
function waiterOrder(): HallOrder {
  return {
    id: '0192a000-0000-7000-8000-0000000000a1',
    table: '2',
    guests: 2,
    status: 'open',
    openedByName: 'نادل أول',
    openedAt: '2026-11-12T10:00:00.000Z',
    billRequestedAt: null,
    version: 3,
    lines: [
      {
        id: '0192a000-0000-7000-8000-0000000000b1',
        productId: TEA.product.id,
        variantId: TEA.variant.id,
        name: 'شاي أحمر 400 غ',
        qty: 2,
        choices: [],
        note: null,
        seat: null,
        section: 'مشروبات',
        status: 'sent',
        ticketId: 't1',
        addedByName: 'نادل أول',
        sentAt: '2026-11-12T10:01:00.000Z',
        readyAt: null,
        servedAt: null,
        cancelReason: null,
        cancelledAfterSend: false,
      },
    ],
  };
}

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

/** The till's staff sign-in plus an in-memory hall */
function hallServer(initial: HallOrder[] = [], control: { down: boolean } = { down: false }) {
  const staff = staffServer(cafeSets());
  let orders = initial;
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path !== '/v1/device/hall') return staff(url, init);
    if (control.down) throw new TypeError('Failed to fetch');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: path, body });
    if (!body) {
      const state: HallResponse = { orders, tables: ['1', '2', 'VIP'], serverTime: new Date().toISOString() };
      return new Response(JSON.stringify(state), { status: 200 });
    }
    let answer: HallCommandResponse = { order: null };
    if (body.type === 'open') {
      const made: HallOrder = {
        id: '0192a000-0000-7000-8000-0000000000c1',
        table: String(body.table),
        guests: null,
        status: 'open',
        openedByName: 'سامر',
        openedAt: '2026-11-12T10:05:00.000Z',
        billRequestedAt: null,
        version: 1,
        lines: [],
      };
      orders = [...orders, made];
      answer = { order: made };
    } else if (body.type === 'close') {
      orders = orders.filter((o) => o.id !== body.orderId);
    } else {
      answer = { order: orders.find((o) => o.id === body.orderId) ?? null };
    }
    return new Response(JSON.stringify(answer), { status: 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls, commands: () => calls.filter((c) => c.body) };
}

async function payExact(user: Awaited<ReturnType<typeof saleScreen>>['user']) {
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

describe('the table board with the server', () => {
  it('shows a waiter’s order as an occupied table, brings it into the cart and closes it when charged', async () => {
    const server = hallServer([waiterOrder()]);
    const { user, outbox } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    const board = await screen.findByRole('region', { name: 'الطاولات' });
    // The waiter's table 2 is occupied, with its total from this till's own prices (2 × 350)
    const table = await within(board).findByRole('button', { name: 'طاولة 2 مشغولة' });
    expect(plain(table)).toContain('700');
    expect(within(board).getByRole('button', { name: 'طاولة 1 فارغة' })).toBeInTheDocument();

    await user.click(table);
    expect(screen.getByRole('button', { name: 'طاولة 2' })).toBeInTheDocument();
    expect(plain(due())).toContain('700 ل.س');
    // Already with the kitchen: nothing new to send
    expect(screen.queryByRole('button', { name: 'للمطبخ' })).toBeNull();

    await payExact(user);
    const sale = outbox.find((e) => e.type === 'sale')!;
    expect((sale.doc.payload as unknown as SalePayload).service).toMatchObject({ table: '2' });
    await waitFor(() => expect(server.commands().some((c) => c.body!.type === 'close')).toBe(true));
    const close = server.commands().find((c) => c.body!.type === 'close')!.body!;
    expect(close).toMatchObject({
      type: 'close',
      orderId: waiterOrder().id,
      reason: 'paid',
      ref: sale.doc.number,
    });
    expect(close.userId).toBeTruthy();
  });

  it('keeps what the waiter added when the till already held that table’s cart', async () => {
    const server = hallServer([waiterOrder()]);
    const { user } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    // Typed at the till first: a bottle of oil, no table yet
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    const board = await screen.findByRole('region', { name: 'الطاولات' });
    await user.click(await within(board).findByRole('button', { name: 'طاولة 2 مشغولة' }));
    // The server's two teas and the oil: 700 + 250
    expect(plain(due())).toContain('950 ل.س');
    // Only the oil is new for the kitchen
    expect(screen.getByRole('button', { name: 'للمطبخ' })).toBeInTheDocument();
  });
});

describe('«للمطبخ» reaches the server', () => {
  it('opens the table’s order, adds the new lines, sends them, and closes it on payment', async () => {
    const server = hallServer();
    const { user, outbox } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    await user.click(
      within(await screen.findByRole('region', { name: 'الطاولات' })).getByRole('button', {
        name: 'طاولة VIP فارغة',
      }),
    );
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'للمطبخ' }));
    await waitFor(() => expect(server.commands().map((c) => c.body!.type)).toEqual(['open', 'add', 'send']));
    const [open, add] = server.commands().map((c) => c.body!);
    expect(open).toMatchObject({ type: 'open', table: 'VIP' });
    expect(add).toMatchObject({ type: 'add', orderId: '0192a000-0000-7000-8000-0000000000c1' });
    expect((add!.lines as { variantId: string; qty: number }[]).map((l) => [l.variantId, l.qty])).toEqual([
      [PRODUCTS.oil.variant.id, 1],
    ]);

    await payExact(user);
    expect(outbox.some((e) => e.type === 'sale')).toBe(true);
    await waitFor(() =>
      expect(server.commands().at(-1)!.body).toMatchObject({
        type: 'close',
        orderId: '0192a000-0000-7000-8000-0000000000c1',
        reason: 'paid',
      }),
    );
  });

  it('works on its own when the server cannot be reached: the board is the till’s own, the paper ticket prints, a charge queues its close', async () => {
    const server = hallServer([waiterOrder()], { down: true });
    const { user, local, outbox } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    const board = await screen.findByRole('region', { name: 'الطاولات' });
    expect(within(board).getByRole('button', { name: 'طاولة 2 فارغة' })).toBeInTheDocument();
    await user.click(within(board).getByRole('button', { name: 'طاولة 1 فارغة' }));
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'للمطبخ' }));
    // The ticket went to the printer queue and the till stays usable
    expect(window.print).toHaveBeenCalled();
    await payExact(user);
    expect(outbox.some((e) => e.type === 'sale')).toBe(true);
    // No order on the server for this table, so nothing is waiting to be closed
    expect(await local.get('hallPendingClose')).toBeNull();
  });

  it('closes a paid table later when the connection dropped between opening and charging it', async () => {
    const control = { down: false };
    const server = hallServer([waiterOrder()], control);
    const { user, local } = await saleScreen({ sets: cafeSets(), fetch: server.fetch });
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    const board = await screen.findByRole('region', { name: 'الطاولات' });
    await user.click(await within(board).findByRole('button', { name: 'طاولة 2 مشغولة' }));
    control.down = true;
    await payExact(user);
    await waitFor(async () =>
      expect(await local.get('hallPendingClose')).toEqual([
        expect.objectContaining({ orderId: waiterOrder().id }),
      ]),
    );
    // The server is back: the next read finds it and the waiting close goes through
    control.down = false;
    await waitFor(() => expect(server.commands().some((c) => c.body!.type === 'close')).toBe(true), {
      timeout: 9_000,
    });
    await waitFor(async () => expect(await local.get('hallPendingClose')).toEqual([]));
  }, 20_000);
});
