import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';
import { whatsappNumber } from './whatsapp';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the WhatsApp number', () => {
  it('turns a Syrian phone in any common form into the 963 form wa.me takes', () => {
    expect(whatsappNumber('0933 123 456')).toBe('963933123456');
    expect(whatsappNumber('+963933123456')).toBe('963933123456');
    expect(whatsappNumber('933123456')).toBe('963933123456');
    expect(whatsappNumber('٠٩٣٣١٢٣٤٥٦')).toBe('963933123456');
  });
  it('has none for text that is not a phone', () => {
    expect(whatsappNumber('abc')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
});

async function sold() {
  const local = memoryLocal();
  await openShift(local);
  const pos = renderPos({ local });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
  await pos.user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  await scan(pos.user, PRODUCTS.sugar.barcode!.code);
  await pos.user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await pos.user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
  await pos.user.keyboard('790{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
  return pos;
}

describe('«أرسل على واتساب» on the finished sale', () => {
  it('asks for a number when the sale has no customer, then opens the chat with the receipt as text', async () => {
    const { user } = await sold();
    await user.click(screen.getByRole('button', { name: 'أرسل على واتساب' }));
    // A wrong number is said, nothing opens
    await user.type(screen.getByLabelText('رقم جوال الزبون'), '123');
    await user.click(screen.getByRole('button', { name: 'أرسل على واتساب' }));
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.getByText(/رقم الجوال غير صحيح/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('رقم جوال الزبون'));
    await user.type(screen.getByLabelText('رقم جوال الزبون'), '0933123456');
    await user.click(screen.getByRole('button', { name: 'أرسل على واتساب' }));
    await waitFor(() => expect(window.open).toHaveBeenCalledOnce());
    const url = vi.mocked(window.open).mock.calls[0]![0] as string;
    expect(url.startsWith('https://wa.me/963933123456?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]!);
    expect(text).toContain('فاتورة رقم INV-001-002-');
    expect(text).toContain('سكر أبيض 1 كغ');
    expect(text).toContain('الإجمالي');
  });
});

describe('after the link opened (round 18)', () => {
  it('says «فُتح واتساب ✓» on the button', async () => {
    const { user } = await sold();
    await user.click(screen.getByRole('button', { name: 'أرسل على واتساب' }));
    await user.clear(screen.getByLabelText('رقم جوال الزبون'));
    await user.type(screen.getByLabelText('رقم جوال الزبون'), '0933123456');
    await user.click(screen.getByRole('button', { name: 'أرسل على واتساب' }));
    expect(await screen.findByRole('button', { name: /فُتح واتساب/ })).toBeInTheDocument();
  });
});
