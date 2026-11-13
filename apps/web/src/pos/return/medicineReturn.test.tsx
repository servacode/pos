import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReturnPayload } from '@serva/core/contracts/documents';
import type { PharmacySettings } from '@serva/core/contracts/pharmacy';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';
import { medicineRulesOf, sealedConfirmed } from './medicineReturn';

/** The medicine return policy on the till's return screen (03 › الصيدليات: مرتجع الأدوية). */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The oil of the test catalog is a medicine of this store: it is on the shelf with a batch and an
 * expiry date, or it is a controlled drug and the till's people may sell it.
 */
function pharmacySets(
  pharmacy: PharmacySettings | null,
  flags: { controlled?: boolean; medicine?: boolean } = {},
) {
  const sets = posSets();
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.oil.product.id ? { ...p, controlled: flags.controlled ?? false } : p,
  );
  if (flags.medicine) {
    sets.variants = sets.variants.map((v) =>
      v.id === PRODUCTS.oil.variant.id
        ? { ...v, shelfBatches: [{ batchNo: 'B-07', expiry: '2099-01-01' }] }
        : v,
    );
  }
  if (flags.controlled) {
    sets.roles = sets.roles.map((r) => ({ ...r, permissions: [...r.permissions, 'pharmacy.controlled'] }));
  }
  sets.settings = sets.settings.map((s) => ({ ...s, pharmacy }));
  return sets;
}

async function openReturn(sets: ReturnType<typeof posSets>) {
  const local = memoryLocal();
  await openShift(local, ids.maryam);
  const { user, outbox } = renderPos({ local, sets });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /مريم/ }));
  await user.keyboard(PINS[ids.maryam]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  await scan(user, PRODUCTS.oil.barcode!.code);
  await user.keyboard('{F12}');
  const panel = await screen.findByRole('region', { name: /الدفع|دواء مراقَب/ });
  if (panel.getAttribute('aria-label') === 'دواء مراقَب') {
    await user.type(within(panel).getByLabelText('رقم الوصفة'), 'RX-5');
    await user.type(within(panel).getByLabelText('اسم الطبيب'), 'د. هالة');
    await user.type(within(panel).getByLabelText('اسم المريض'), 'ليلى');
    await user.type(within(panel).getByLabelText('رقم هوية المريض'), '01020304');
    await user.click(within(panel).getByRole('button', { name: 'تابع إلى الدفع' }));
  }
  await screen.findByRole('region', { name: 'الدفع' });
  await user.keyboard('250{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
  await user.keyboard('{Alt>}r{/Alt}');
  await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
  return { user, outbox };
}

describe('«مرتجع» of a medicine', () => {
  it('by default takes a sealed box back only when the cashier ticks that it is sealed', async () => {
    const { user, outbox } = await openReturn(pharmacySets({ prescription: 'optional' }, { medicine: true }));
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    const record = screen.getByRole('button', { name: 'سجّل المرتجع' });
    expect(record).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /مغلقة وسليمة/ }));
    expect(record).toBeEnabled();
    await user.click(record);
    expect(await screen.findByRole('heading', { name: 'سُجّل المرتجع' })).toBeInTheDocument();
    expect((outbox.find((e) => e.type === 'return')!.doc.payload as unknown as ReturnPayload).lines).toEqual([
      expect.objectContaining({ saleLineNo: 1, qty: 1000 }),
    ]);
  });

  it('under «لا مرتجع للأدوية» does not let the line be returned', async () => {
    const { user, outbox } = await openReturn(
      pharmacySets({ prescription: 'optional', returns: 'none' }, { medicine: true }),
    );
    expect(screen.getByText('المحل لا يقبل مرتجع الأدوية.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /زد زيت/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'سجّل المرتجع' })).toBeDisabled();
    expect(outbox.some((e) => e.type === 'return')).toBe(false);
    void user;
  });

  it('under «مسموح» takes it back with no tick', async () => {
    const { user } = await openReturn(
      pharmacySets({ prescription: 'optional', returns: 'allowed' }, { medicine: true }),
    );
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    expect(screen.queryByRole('checkbox', { name: /مغلقة/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'سجّل المرتجع' })).toBeEnabled();
  });

  it('never takes a controlled drug back, whatever the policy, unless the store allows it', async () => {
    const { user } = await openReturn(
      pharmacySets({ prescription: 'optional', returns: 'allowed' }, { controlled: true }),
    );
    expect(screen.getByText(/دواء مراقَب/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /زد زيت/ })).toBeNull();
    void user;
  });

  it('takes a controlled drug back, sealed, when the store allows it explicitly', async () => {
    const { user } = await openReturn(
      pharmacySets({ prescription: 'optional', controlledReturns: true }, { controlled: true }),
    );
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    expect(screen.getByRole('button', { name: 'سجّل المرتجع' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /مغلقة وسليمة/ }));
    expect(screen.getByRole('button', { name: 'سجّل المرتجع' })).toBeEnabled();
  });

  it('leaves an ordinary item of a pharmacy, and any item of another store, alone', async () => {
    const { user } = await openReturn(pharmacySets({ prescription: 'optional', returns: 'none' }));
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    expect(screen.getByRole('button', { name: 'سجّل المرتجع' })).toBeEnabled();
  });
});

describe('the rule of each line', () => {
  const sale = {
    lines: [
      { lineNo: 1, variantId: 'v1', batchNo: 'B-1' },
      { lineNo: 2, variantId: 'v2' },
    ],
  };
  const catalog = {
    byVariant: new Map([['v2', { controlled: true }]]),
  } as unknown as Parameters<typeof medicineRulesOf>[1];

  it('treats a line with a batch as a medicine, a controlled item as controlled, and none with no settings', () => {
    const rules = medicineRulesOf(sale as unknown as Parameters<typeof medicineRulesOf>[0], catalog, {
      prescription: 'optional',
    });
    expect(rules.get(1)).toEqual({ kind: 'sealed' });
    expect(rules.get(2)?.kind).toBe('blocked');
    expect(
      medicineRulesOf(sale as unknown as Parameters<typeof medicineRulesOf>[0], catalog, null).size,
    ).toBe(0);
  });

  it('asks the tick only for the picked sealed lines', () => {
    const rules = new Map([[1, { kind: 'sealed' as const }]]);
    expect(sealedConfirmed([{ saleLineNo: 1, qty: 1000 }], rules, {})).toBe(false);
    expect(sealedConfirmed([{ saleLineNo: 1, qty: 1000 }], rules, { 1: true })).toBe(true);
    expect(sealedConfirmed([{ saleLineNo: 3, qty: 1000 }], rules, {})).toBe(true);
  });
});
