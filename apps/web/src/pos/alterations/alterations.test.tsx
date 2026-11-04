import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlterationTicket } from '@serva/core/contracts/alterations';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, staffServer } from '../../test/pos';
import { openShift, renderPos } from '../../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const TICKET: AlterationTicket = {
  id: 't-1',
  number: 'ALT-000001',
  status: 'received',
  customerName: 'سلمى',
  phone: '+963933111222',
  item: 'بنطال جينز أسود',
  work: 'تقصير 3 سم',
  currency: 'SYP',
  priceMinor: 150_000,
  dueDate: '2026-11-06',
  note: null,
  createdAt: '2026-11-04T10:00:00.000Z',
  readyAt: null,
  deliveredAt: null,
  version: 1,
};

function server() {
  const staff = staffServer();
  let list: AlterationTicket[] = [];
  const sent: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (!path.startsWith('/v1/device/alterations')) return staff(url, init);
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    sent.push({ url: path, body });
    if (path === '/v1/device/alterations' && !body) {
      return new Response(JSON.stringify({ items: list }), { status: 200 });
    }
    if (path === '/v1/device/alterations') {
      list = [TICKET];
      return new Response(JSON.stringify(TICKET), { status: 201 });
    }
    const ready = { ...TICKET, status: 'ready' as const, version: 2 };
    list = [ready];
    return new Response(JSON.stringify(ready), { status: 200 });
  });
  return { fetch: fn as unknown as typeof fetch, sent };
}

describe('«التعديلات» on the till (03 › الألبسة: التعديل والتقصير)', () => {
  it('makes a ticket, prints its slip, and marks it ready', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server();
    const { user } = renderPos({ local, fetch });
    const staffList = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(staffList).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'التعديلات' }));
    expect(await screen.findByText('لا تعديلات مفتوحة.')).toBeInTheDocument();

    const form = screen.getByRole('region', { name: 'تذكرة جديدة' });
    await user.type(within(form).getByLabelText('اسم الزبون'), 'سلمى');
    await user.type(within(form).getByLabelText('جوال الزبون'), '0933111222');
    await user.type(within(form).getByLabelText('القطعة'), 'بنطال جينز أسود');
    await user.type(within(form).getByLabelText('المطلوب'), 'تقصير 3 سم');
    await user.type(within(form).getByLabelText('الأجرة'), '1500');
    await user.click(within(form).getByRole('button', { name: 'سجّل واطبع التذكرة' }));

    const row = await screen.findByRole('listitem', { name: 'التذكرة ALT-000001' });
    expect(row).toHaveTextContent('قيد التعديل');
    expect(window.print).toHaveBeenCalled();
    const slip = document.querySelector('[data-print-receipt]') as HTMLElement;
    expect(within(slip).getByRole('region', { name: 'تذكرة التعديل' })).toHaveTextContent('تقصير 3 سم');
    expect(sent.find((s) => s.body)?.body).toMatchObject({
      customerName: 'سلمى',
      item: 'بنطال جينز أسود',
      priceMinor: 150_000,
    });

    await user.click(within(row).getByRole('button', { name: 'جاهزة' }));
    expect(
      await within(await screen.findByRole('listitem', { name: 'التذكرة ALT-000001' })).findByText(
        'جاهزة للاستلام',
      ),
    ).toBeInTheDocument();
    expect(sent.at(-2)).toMatchObject({
      url: '/v1/device/alterations/t-1/status',
      body: { status: 'ready', version: 1 },
    });
  });
});
