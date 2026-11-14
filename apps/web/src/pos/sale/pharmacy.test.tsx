import { dayText } from '../../lib/dates';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { PharmacySettings, ShelfBatch } from '@serva/core/contracts/pharmacy';
import { stripBidiControls } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/** Pharmacies at the till: the scientific name finds the medicine, an expired shelf warns. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

function pharmacySets(nearestExpiry: string | null) {
  const sets = posSets();
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.tea.product.id ? { ...p, nameAr: 'بانادول 500', genericName: 'باراسيتامول' } : p,
  );
  sets.variants = sets.variants.map((v) => (v.id === PRODUCTS.tea.variant.id ? { ...v, nearestExpiry } : v));
  return sets;
}

describe('a pharmacy till', () => {
  it('finds the medicine by its scientific name', async () => {
    const { user } = await saleScreen({ sets: pharmacySets(null) });
    await user.type(screen.getByRole('searchbox'), 'باراسيتامول');
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    expect(plain(grid)).toContain('بانادول 500');
  });

  it('warns when the shelf has expired, and tells when it soon will', async () => {
    const { user } = await saleScreen({ sets: pharmacySets('2020-01-31') });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(/صلاحية «بانادول 500» انتهت في 31 كانون الثاني 2020/)).toBeInTheDocument();
    // It is still added: the cashier checks the box
    expect(plain(screen.getByRole('list', { name: 'أسطر الفاتورة' }))).toContain('بانادول 500');
  });

  it('says nothing for a far expiry', async () => {
    const { user } = await saleScreen({ sets: pharmacySets('2099-12-31') });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(screen.queryByText(/صلاحية/)).toBeNull();
  });
});

// ── Batches, prescriptions and controlled drugs ───────────────────────────────────────────────

const GOOD: ShelfBatch = { batchNo: 'B-07', expiry: '2099-01-01' };
const GONE: ShelfBatch = { batchNo: 'A-01', expiry: '2020-01-31' };

function shelfSets(options: {
  batches?: ShelfBatch[] | null;
  pharmacy?: PharmacySettings | null;
  requiresPrescription?: boolean;
  controlled?: boolean;
  pharmacist?: boolean;
}) {
  const sets = posSets();
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.tea.product.id
      ? {
          ...p,
          nameAr: 'بانادول 500',
          requiresPrescription: options.requiresPrescription ?? false,
          controlled: options.controlled ?? false,
        }
      : p,
  );
  sets.variants = sets.variants.map((v) =>
    v.id === PRODUCTS.tea.variant.id ? { ...v, shelfBatches: options.batches ?? null } : v,
  );
  sets.settings = sets.settings.map((s) => ({ ...s, pharmacy: options.pharmacy ?? null }));
  if (options.pharmacist) {
    sets.roles = sets.roles.map((r) =>
      r.id === ids.cashierRole ? { ...r, permissions: [...r.permissions, 'pharmacy.controlled'] } : r,
    );
  }
  return sets;
}

type Pos = Awaited<ReturnType<typeof saleScreen>>;

/** From the prescription (if asked) or the cart to «تمت البيعة» */
async function payExact(user: Pos['user']) {
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

const soldPayload = (outbox: Pos['outbox']) =>
  outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;

describe('the batch of a pharmacy sale', () => {
  it('takes the nearest batch that has not expired, and records it on the line', async () => {
    const { user, outbox } = await saleScreen({
      sets: shelfSets({ batches: [GONE, GOOD], pharmacy: { prescription: 'optional' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(screen.queryByText(/صلاحية/)).toBeNull();
    await user.keyboard('{F12}');
    await payExact(user);
    expect(soldPayload(outbox).lines[0]).toMatchObject({ batchNo: 'B-07', batchExpiry: '2099-01-01' });
  });

  it('refuses the line when every batch on the shelf has expired', async () => {
    const { user } = await saleScreen({
      sets: shelfSets({ batches: [GONE], pharmacy: { prescription: 'optional' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(
      await screen.findByText(/لا يُباع «بانادول 500».*منتهية الصلاحية.*2020-01-31/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).toBeNull();
  });

  it('tells when the batch it took is about to end', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { user } = await saleScreen({
      sets: shelfSets({
        batches: [{ batchNo: 'C-3', expiry: soon }, GOOD],
        pharmacy: { prescription: 'optional' },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(new RegExp(`دفعة C-3.*${dayText(soon)}`))).toBeInTheDocument();
    expect(plain(screen.getByRole('list', { name: 'أسطر الفاتورة' }))).toContain('بانادول 500');
  });

  it('sells the line as before when the store turned the batch picking off', async () => {
    const { user, outbox } = await saleScreen({
      sets: shelfSets({ batches: [GONE], pharmacy: { prescription: 'optional', autoBatch: false } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(plain(screen.getByRole('list', { name: 'أسطر الفاتورة' }))).toContain('بانادول 500');
    await user.keyboard('{F12}');
    await payExact(user);
    expect(soldPayload(outbox).lines[0]!.batchNo).toBeUndefined();
  });

  it('picks the batch for a medical-supplies store that turned it on', async () => {
    const { user, outbox } = await saleScreen({
      sets: shelfSets({ batches: [GONE, GOOD], pharmacy: { prescription: 'optional', autoBatch: true } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    await payExact(user);
    expect(soldPayload(outbox).lines[0]).toMatchObject({ batchNo: 'B-07' });
  });

  it('leaves a store that is not a pharmacy alone, whatever its items carry', async () => {
    const { user, outbox } = await saleScreen({ sets: shelfSets({ batches: [GONE], pharmacy: null }) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(plain(screen.getByRole('list', { name: 'أسطر الفاتورة' }))).toContain('بانادول 500');
    await user.keyboard('{F12}');
    await payExact(user);
    expect(soldPayload(outbox).lines[0]!.batchNo).toBeUndefined();
    expect(soldPayload(outbox).prescription).toBeUndefined();
  });
});

describe('the prescription at the till', () => {
  it('asks for the number and the doctor before payment when the store requires them', async () => {
    const { user, outbox } = await saleScreen({
      sets: shelfSets({ requiresPrescription: true, pharmacy: { prescription: 'required' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    const panel = await screen.findByRole('region', { name: 'وصفة طبية' });
    expect(within(panel).queryByLabelText('اسم المريض')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'تخطَّ' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'تابع إلى الدفع' }));
    expect(await within(panel).findByText('اكتب رقم الوصفة')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('رقم الوصفة'), 'RX-9');
    await user.type(within(panel).getByLabelText('اسم الطبيب'), 'د. سامر');
    await user.click(within(panel).getByRole('button', { name: 'تابع إلى الدفع' }));
    await payExact(user);
    expect(soldPayload(outbox).prescription).toEqual({
      ref: 'RX-9',
      doctor: 'د. سامر',
      patientName: null,
      patientId: null,
    });
  });

  it('may be skipped when the store makes it optional, and then the sale carries none', async () => {
    const { user, outbox } = await saleScreen({
      sets: shelfSets({ requiresPrescription: true, pharmacy: { prescription: 'optional' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    const panel = await screen.findByRole('region', { name: 'وصفة طبية' });
    await user.click(within(panel).getByRole('button', { name: 'تخطَّ' }));
    await payExact(user);
    expect(soldPayload(outbox).prescription).toBeUndefined();
  });

  it('goes back from the prescription to the items', async () => {
    const { user } = await saleScreen({
      sets: shelfSets({ requiresPrescription: true, pharmacy: { prescription: 'optional' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    const panel = await screen.findByRole('region', { name: 'وصفة طبية' });
    await user.click(within(panel).getByRole('button', { name: 'رجوع' }));
    expect(screen.queryByRole('region', { name: 'وصفة طبية' })).toBeNull();
    expect(screen.getByRole('list', { name: 'أسطر الفاتورة' })).toBeInTheDocument();
  });
});

describe('controlled drugs at the till', () => {
  it('are not sold by a cashier without the pharmacist permission', async () => {
    const { user } = await saleScreen({
      sets: shelfSets({ controlled: true, pharmacy: { prescription: 'optional' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(/«بانادول 500» دواء مراقَب، لا يبيعه إلا الصيدلاني/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).toBeNull();
  });

  it('are sold by the pharmacist with the prescription, doctor, patient and ID written', async () => {
    const { user, outbox } = await saleScreen({
      sets: shelfSets({ controlled: true, pharmacist: true, pharmacy: { prescription: 'optional' } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    const panel = await screen.findByRole('region', { name: 'دواء مراقَب' });
    expect(within(panel).queryByRole('button', { name: 'تخطَّ' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'تابع إلى الدفع' }));
    expect(await within(panel).findByText('اكتب اسم المريض')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('رقم الوصفة'), 'RX-5');
    await user.type(within(panel).getByLabelText('اسم الطبيب'), 'د. هالة');
    await user.type(within(panel).getByLabelText('اسم المريض'), 'ليلى');
    await user.type(within(panel).getByLabelText('رقم هوية المريض'), '01020304');
    await user.click(within(panel).getByRole('button', { name: 'تابع إلى الدفع' }));
    await payExact(user);
    expect(soldPayload(outbox)).toMatchObject({
      prescription: { ref: 'RX-5', doctor: 'د. هالة', patientName: 'ليلى', patientId: '01020304' },
    });
  });
});
