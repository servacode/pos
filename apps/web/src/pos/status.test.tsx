import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../offline/local';
import { ids, linkedDevice, PINS, PRODUCTS } from '../test/pos';
import { renderPos, saleScreen, scan } from '../test/renderPos';
import { connectionText, StatusBar } from './StatusBar';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('status bar (kit cashier/StatusBar)', () => {
  it('says what waits to be sent, online or not', () => {
    expect(connectionText(true, 0)).toBe('متصل · كل شيء أُرسل');
    expect(connectionText(true, 3)).toBe('متصل · 3 بانتظار الإرسال');
    expect(connectionText(false, 0)).toBe('دون إنترنت · البيع مستمر');
    expect(connectionText(false, 12)).toBe('دون إنترنت · البيع مستمر · 12 بانتظار الإرسال');
  });

  it('shows the last time the device sent its documents', () => {
    const at = new Date(2026, 9, 30, 16, 32).getTime();
    render(
      <StatusBar
        device={linkedDevice}
        persisted={true}
        online={false}
        outbox={{ pending: 2, lastSentAt: at }}
        user={{ name: 'سامر', detail: 'وردية منذ 8:10 ص' }}
      />,
    );
    expect(screen.getByText('دون إنترنت · البيع مستمر · 2 بانتظار الإرسال')).toBeInTheDocument();
    expect(screen.getByText('آخر إرسال 4:32 م')).toBeInTheDocument();
    expect(screen.getByText('وردية منذ 8:10 ص')).toBeInTheDocument();
  });
});

describe('selling without internet', () => {
  it('keeps selling, says the receipt waits on this device, and marks an approval as offline', async () => {
    const local = memoryLocal();
    // سامر and مريم each signed in online once on this device, so their codes work offline.
    (await saleScreen({ local })).view.unmount();
    {
      const once = renderPos({ local });
      const list = await screen.findByRole('list', { name: 'الموظفون' });
      await once.user.click(within(list).getByRole('button', { name: /مريم/ }));
      await once.user.keyboard(PINS[ids.maryam]!);
      await screen.findByRole('heading', { name: 'افتح الوردية' });
      once.view.unmount();
    }

    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { user, outbox } = await saleScreen({
      local,
      online: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await scan(user, PRODUCTS.sugar.barcode!.code);
    const lines = screen.getByRole('list', { name: 'أسطر الفاتورة' });
    await user.click(within(lines).getByRole('button', { name: /سكر أبيض/ }));
    await user.click(within(lines).getByRole('button', { name: 'خصم' }));
    const panel = await screen.findByRole('region', { name: 'خصم على السطر' });
    await user.keyboard('20');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });

    await user.keyboard('{F12}');
    await user.click(
      within(await screen.findByRole('region', { name: 'الدفع' })).getByRole('button', {
        name: /المبلغ تماماً/,
      }),
    );
    await user.keyboard('{Enter}');
    const done = await screen.findByRole('region', { name: 'تمت البيعة' });
    expect(stripBidiControls(done.textContent ?? '')).toContain(
      'دون إنترنت: الفاتورة محفوظة على هذا الجهاز، وتُرسل وحدها عند عودة الإنترنت.',
    );
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.lines[0]!.discount!.approval).toMatchObject({ userId: ids.maryam, offline: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('receipt widths (21 › 80 مم و58 مم)', () => {
  it('prints on 58 mm paper once chosen, and remembers the choice', async () => {
    const local = memoryLocal();
    const { user } = await saleScreen({ local });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    await user.click(
      within(await screen.findByRole('region', { name: 'الدفع' })).getByRole('button', {
        name: /المبلغ تماماً/,
      }),
    );
    await user.keyboard('{Enter}');
    const done = await screen.findByRole('region', { name: 'تمت البيعة' });
    expect(within(done).getByLabelText('إيصال 80 مم')).toBeInTheDocument();
    await user.click(within(done).getByRole('button', { name: '58 مم' }));
    expect(within(done).getByLabelText('إيصال 58 مم')).toBeInTheDocument();
    expect(await local.get('paperWidth')).toBe(58);
    await user.click(within(done).getByRole('button', { name: 'اطبع' }));
    const printed = document.querySelector('[data-print-receipt]')!;
    expect(within(printed as HTMLElement).getByLabelText('إيصال 58 مم')).toBeInTheDocument();
    expect(printed.querySelector('style')!.textContent).toBe('@page { size: 58mm auto; margin: 0 }');
  });
});
