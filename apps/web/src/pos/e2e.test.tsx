import 'fake-indexeddb/auto';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocumentPayload, type SalePayload } from '@serva/core/contracts/documents';
import { verifySalePayload } from '@serva/core/sale';
import { stripBidiControls } from '@serva/core/text';
import { deviceStore, resetDeviceStore } from '../offline/database';
import { ids, linkedDevice, PINS, posSets, PRODUCTS, staffServer } from '../test/pos';
import { renderApp } from '../test/renderApp';
import '../test/renderPos';

let print: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  print = vi.fn();
  vi.spyOn(window, 'print').mockImplementation(print);
  const staff = staffServer();
  // The staff route answers; the sync routes are out of reach, so the sale stays in the outbox.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/v1/device/staff-sessions') return staff(url, init);
      throw new TypeError('Failed to fetch');
    }),
  );
  const store = deviceStore();
  await store.putDevice(linkedDevice);
  await store.applySnapshot(
    {
      sets: posSets() as unknown as Record<string, Array<Record<string, unknown> & { id: string }>>,
      cursors: {},
    },
    Date.now(),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetDeviceStore();
});

describe('a sale end to end, through the real device database (@serva/sync Dexie store)', () => {
  it('signs in, opens the shift, sells, and leaves numbered, valid documents in the outbox', async () => {
    const { user } = renderApp('/pos');
    const staff = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(staff).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);

    await user.click(await screen.findByRole('button', { name: 'افتح الوردية' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    for (const p of [PRODUCTS.milk, PRODUCTS.sugar]) {
      (document.activeElement as HTMLElement | null)?.blur();
      await user.keyboard(`${p.barcode!.code}{Enter}`);
    }
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    const done = await screen.findByRole('region', { name: 'تمت البيعة' });
    expect(stripBidiControls(done.textContent ?? '')).toContain('INV-001-002-0000001');
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());

    const pending = await deviceStore().listPending();
    expect(pending.map((e) => [e.type, e.doc.number])).toEqual([
      ['shift_open', 'SFT-001-002-0000001'],
      ['sale', 'INV-001-002-0000001'],
    ]);
    for (const entry of pending) {
      expect(validateDocumentPayload(entry.type, entry.doc.payload)).toEqual({ ok: true, checked: true });
    }
    const sale = pending[1]!.doc.payload as unknown as SalePayload;
    expect(sale.shiftId).toBe(pending[0]!.doc.id);
    expect(sale.totals.totalMinor).toBe(129_000);
    expect(verifySalePayload(sale)).toEqual([]);
    expect(pending[1]!.doc.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pending[1]!.doc.engineVersion).toBe('1.0.0');
    // The journal keeps the second copy, written in the same transaction.
    expect(await deviceStore().db.doc_journal.get(pending[1]!.id)).toMatchObject({ seq: pending[1]!.seq });
    // The status bar counts what waits to be sent.
    expect(await screen.findByText('متصل · 2 بانتظار الإرسال')).toBeInTheDocument();
  });
});
