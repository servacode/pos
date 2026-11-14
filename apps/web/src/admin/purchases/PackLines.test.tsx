import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierListResponse } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';
import { baseQtyOf, moneyText, packSummary, withPackChange } from './packLines';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    branches: [
      { id: 'b-main', code: '001', name: 'الفرع الرئيسي' },
      { id: 'b-mall', code: '002', name: 'فرع المول' },
    ],
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'purchases.manage', 'cost.view', 'inventory.adjust'],
    },
  };
}

const suppliers: SupplierListResponse = {
  items: [{ id: 's-1', name: 'شركة الدواء', phone: null, notes: null, balanceMinor: 0, archived: false }],
  totalOwedMinor: 0,
  baseCurrency: 'SYP',
};

const barcode = (code: string, packQty: number, packName: string | null) => ({
  id: `bc-${code}`,
  code,
  kind: 'standard',
  packQty,
  packName,
  packPriceMinor: null,
});

/** Amoxil: one piece, a box of 100 and a carton of 10 boxes (1000 pieces). */
function drugs() {
  return mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
    'GET /v1/purchases': () => ({ status: 200, body: { items: [], baseCurrency: 'SYP' } }),
    'GET /v1/transfers': () => ({ status: 200, body: { items: [] } }),
    'GET /v1/supplier-returns': () => ({ status: 200, body: { items: [] } }),
    [`GET ${productsPath({ q: 'أموكسيل' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-9', nameAr: 'أموكسيل', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-9': () => ({
      status: 200,
      body: {
        id: 'p-9',
        nameAr: 'أموكسيل',
        variants: [
          {
            id: 'v-9',
            label: null,
            archivedAt: null,
            attributes: [],
            barcodes: [
              barcode('6281000000011', 1000, null),
              barcode('6281000000028', 100_000, 'علبة'),
              barcode('6281000000035', 1_000_000, 'كرتونة'),
            ],
          },
        ],
      },
    }),
    'POST /v1/purchases': () => ({ status: 201, body: { id: 'pu-1', number: 'PUR-2026-000001' } }),
    'POST /v1/transfers': () => ({
      status: 201,
      body: {
        id: 't-1',
        number: 'TRF-2026-000001',
        date: '2026-11-03',
        fromBranchId: 'b-main',
        toBranchId: 'b-mall',
        lines: [],
        valueMinor: 160_000,
        baseCurrency: 'SYP',
      },
    }),
  });
}

describe('lines typed in packs', () => {
  it('reads 50 boxes of 100 as 5000 pieces, and a unit cost of a box as the line total', async () => {
    const { requestsTo } = drugs();
    const { user } = renderApp('/purchases');
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'أموكسيل');
    await user.click(await screen.findByRole('button', { name: 'أموكسيل' }));
    await user.selectOptions(await screen.findByLabelText('وحدة أموكسيل'), 'علبة 100');
    await user.type(screen.getByLabelText('كمية أموكسيل'), '50');
    await user.type(screen.getByLabelText('كلفة وحدة أموكسيل'), '2500');
    // 50 boxes at 2,500 each: the total follows, and the line says what it comes to in pieces
    expect(screen.getByLabelText('كلفة أموكسيل')).toHaveValue('125000');
    expect(screen.getByText('50 علبة (5,000 قطعة)')).toBeInTheDocument();
    expect(screen.getByText(/كلفة القطعة/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    await screen.findByText(/سُجّلت الفاتورة/);
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      lines: [{ variantId: 'v-9', qty: 5_000_000, costMinor: 12_500_000 }],
    });
  });

  it('keeps pieces as pieces for an item with no packs choice made, and a typed total wins over a unit cost', async () => {
    const { requestsTo } = drugs();
    const { user } = renderApp('/purchases');
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'أموكسيل');
    await user.click(await screen.findByRole('button', { name: 'أموكسيل' }));
    await user.type(await screen.findByLabelText('كمية أموكسيل'), '30');
    await user.type(screen.getByLabelText('كلفة وحدة أموكسيل'), '10');
    expect(screen.getByLabelText('كلفة أموكسيل')).toHaveValue('300');
    await user.clear(screen.getByLabelText('كلفة أموكسيل'));
    await user.type(screen.getByLabelText('كلفة أموكسيل'), '250');
    expect(screen.getByLabelText('كلفة وحدة أموكسيل')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    await screen.findByText(/سُجّلت الفاتورة/);
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      lines: [{ qty: 30_000, costMinor: 25_000 }],
    });
  });

  it('sends a transfer of cartons as pieces', async () => {
    const { requestsTo } = drugs();
    const { user } = renderApp('/transfers');
    await user.type(await screen.findByLabelText('أضف صنفاً بالاسم أو الباركود'), 'أموكسيل');
    await user.click(await screen.findByRole('button', { name: 'أموكسيل' }));
    await user.selectOptions(await screen.findByLabelText('وحدة أموكسيل'), 'كرتونة 1000');
    await user.type(screen.getByLabelText('كمية أموكسيل'), '2');
    expect(screen.getByText('2 كرتونة (2,000 قطعة)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل التحويل' }));
    await screen.findByText(/سُجّل التحويل TRF-2026-000001/);
    expect(requestsTo('POST', '/v1/transfers')[0]?.body).toMatchObject({
      lines: [{ variantId: 'v-9', qty: 2_000_000 }],
    });
  });
});

describe('pack line helpers', () => {
  it('turns packs into pieces, refusing what has no whole thousandth', () => {
    expect(baseQtyOf({ qty: '50', packQty: 100_000 })).toBe(5_000_000);
    expect(baseQtyOf({ qty: '0.5', packQty: 100_000 })).toBe(50_000);
    expect(baseQtyOf({ qty: '', packQty: 100_000 })).toBeNull();
    expect(baseQtyOf({ qty: '0.001', packQty: 500 })).toBeNull();
  });

  it('writes a total from a unit cost, and clears the unit cost when a total is typed', () => {
    const line = { qty: '50', packQty: 100_000, unitCost: '', cost: '' };
    expect(withPackChange(line, { unitCost: '2500' })).toMatchObject({ cost: '125000', unitCost: '2500' });
    const typed = withPackChange({ ...line, unitCost: '2500', cost: '125000' }, { cost: '99' });
    expect(typed).toMatchObject({ cost: '99', unitCost: '' });
    // A quantity changed later moves the total with the unit cost
    expect(withPackChange({ ...line, unitCost: '2500' }, { qty: '2' })).toMatchObject({ cost: '5000' });
    // Nothing to compute from
    expect(withPackChange({ ...line, unitCost: 'x' }, { qty: '2' }).cost).toBe('');
    expect(withPackChange({ ...line, qty: 'x', unitCost: '5' }, { qty: 'y' }).cost).toBe('');
    // A quantity no pack can hold leaves the total as it was
    expect(withPackChange({ ...line, packQty: 500, unitCost: '5', cost: '7' }, { qty: '0.001' }).cost).toBe(
      '7',
    );
  });

  it('shows a fractional total without float noise, and the summary of a pack and of a piece', () => {
    expect(moneyText(12_500_000)).toBe('125000');
    expect(moneyText(950)).toBe('9.5');
    const fmt = (q: number) => String(q / 1000);
    expect(packSummary(2000, { name: 'علبة', qty: 100_000 }, fmt)).toBe('2 علبة (200 قطعة)');
    expect(packSummary(2000, null, fmt)).toBe('2');
    expect(packSummary(2000, { name: 'قطعة', qty: 1000 }, fmt)).toBe('2');
    expect(packSummary(1, { name: 'علبة', qty: 500 }, fmt)).toBe('0.001');
  });
});
