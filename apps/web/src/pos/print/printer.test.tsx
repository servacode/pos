import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';
import { PRINTER_KEY } from './PrinterScreen';

/** A canvas 2D context that draws nothing: jsdom has none */
function fakeCanvas() {
  const ctx = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (t: string) => ({ width: t.length * 10 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
}

const transferOut = vi.fn(async () => ({}));
const device = {
  productName: 'XP-80',
  opened: true,
  configuration: {
    interfaces: [
      {
        interfaceNumber: 0,
        alternate: { interfaceClass: 7, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] },
      },
    ],
  },
  open: vi.fn(),
  selectConfiguration: vi.fn(),
  claimInterface: vi.fn(async () => undefined),
  transferOut,
};

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
  transferOut.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as unknown as { usb?: unknown }).usb;
});

async function signIn(user: ReturnType<typeof renderPos>['user']) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /سامر/ }));
  await user.keyboard(PINS[ids.samer]!);
}

describe('«الطابعة» on the till', () => {
  it('prints from the browser by default; USB needs Chrome or Edge', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'الطابعة' }));
    expect(await screen.findByRole('heading', { name: 'الطابعة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /من المتصفح/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /طابعة حرارية USB/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /58 مم/ }));
    expect(await local.get('paperWidth')).toBe(58);
  });

  it('sends a cash sale straight to the USB printer with the drawer pulse, no dialog', async () => {
    fakeCanvas();
    (navigator as unknown as { usb: unknown }).usb = {
      getDevices: async () => [device],
      requestDevice: async () => device,
    };
    const local = memoryLocal();
    await openShift(local);
    await local.set(PRINTER_KEY, { mode: 'usb', name: 'XP-80', drawer: true });
    const { user } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    await screen.findByRole('region', { name: 'الدفع' });
    await user.keyboard('250{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    await vi.waitFor(() => expect(transferOut).toHaveBeenCalled());
    const sent = transferOut.mock.calls.map((c) => [...(c as unknown as [number, Uint8Array])[1]]);
    expect(sent[0]).toEqual([0x1b, 0x40]);
    expect(sent.at(-1)).toEqual([0x1b, 0x70, 0, 25, 250]);
    expect(window.print).not.toHaveBeenCalled();
  });
});
