import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import type { OutboxEntry } from '@serva/sync';
import { DigitsProvider, NameText } from '@serva/ui';
import { buildCatalog } from './catalog';
import { posSets } from '../test/pos';
import { ExactMoney } from './ExactMoney';
import { withLocalSales } from './localStock';
import { Receipt, type ReceiptData } from './receipt/Receipt';
import { receiptText } from './receipt/whatsapp';
import { bestSellers } from './sale/bestSellers';
import {
  addItem,
  applyContractPrices,
  contractSavingMinor,
  contractSavingsOf,
  customerPriceKind,
  EMPTY_CART,
  priceTagsOf,
  setPriceTier,
} from './sale/cart';

const catalog = buildCatalog(posSets());
const item = catalog.items[0]!;

describe('customer prices are tagged and counted against the shelf price (round 20)', () => {
  const wholesaleItem = {
    ...item,
    price: { ...item.price, wholesalePriceMinor: item.price.priceMinor - 100 },
  };
  const ctx = { currency: item.price.currency, taxInclusive: true, rates: [] } as never;

  it('tags a wholesale line and counts what it saved', () => {
    const cart = setPriceTier(addItem(EMPTY_CART, wholesaleItem, undefined, 2000), 'wholesale');
    const line = cart.lines[0]!;
    expect(customerPriceKind(line)).toBe('wholesale');
    expect(contractSavingMinor(line, ctx)).toBe(200);
    expect(priceTagsOf(cart)).toEqual({ [line.lineNo]: 'wholesale' });
    const sale = {
      lines: [{ lineNo: line.lineNo, priced: { grossMinor: (item.price.priceMinor - 100) * 2 } }],
    };
    expect(contractSavingsOf(cart, sale)).toEqual({ [line.lineNo]: 200 });
  });

  it('keeps the shelf price, not the wholesale one, when a contract price follows', () => {
    const wholesale = setPriceTier(addItem(EMPTY_CART, wholesaleItem, undefined, 1000), 'wholesale');
    const priced = applyContractPrices(wholesale, [
      { variantId: item.variantId, currency: item.price.currency, priceMinor: item.price.priceMinor - 300 },
    ]);
    const line = priced.lines[0]!;
    expect(customerPriceKind(line)).toBe('contract');
    expect(line.shelfPriceMinor).toBe(item.price.priceMinor);
    expect(contractSavingMinor(line, ctx)).toBe(300);
  });

  it('leaves a shelf-priced line untagged', () => {
    const cart = addItem(EMPTY_CART, wholesaleItem, undefined, 1000);
    expect(customerPriceKind(cart.lines[0]!)).toBeNull();
    expect(priceTagsOf(cart)).toEqual({});
  });
});

const settings = {
  timezone: 'Asia/Damascus',
  businessDayCutoff: '00:00',
  sectors: [],
  storeName: 'مركز',
  baseCurrency: 'SYP',
  enabledCurrencies: ['SYP'],
} as unknown as SettingsRow;

function receipt(totals: Record<string, number>, extra: Partial<ReceiptData> = {}): ReceiptData {
  return {
    doc: {
      number: 'INV-1',
      deviceTime: '2026-10-30T09:00:00.000Z',
      payload: {
        currency: 'SYP',
        taxInclusive: true,
        exchangeRates: [{ unit: 'USD', quote: 'SYP', rate: '13000' }],
        lines: [
          {
            lineNo: 1,
            variantId: 'v1',
            name: 'حقنة',
            qty: 1000,
            unitName: null,
            packQty: 1000,
            unitPriceMinor: 71_250,
            baseQty: 1000,
            priced: { totalMinor: 71_250, grossMinor: 71_250, lineDiscountMinor: 0 },
          },
        ],
        totals: {
          grossMinor: 71_250,
          lineDiscountMinor: 0,
          invoiceDiscountMinor: 0,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 71_250,
          ...totals,
        },
        payments: [{ paymentNo: 1, method: 'cash', currency: 'SYP', amountMinor: 71_000 }],
        cashRounding: {
          currency: 'SYP',
          stepMinor: 500,
          exactMinor: 71_250,
          dueMinor: 71_000,
          roundingMinor: -250,
        },
      },
    } as unknown as ReceiptData['doc'],
    settings,
    branch: null,
    storeName: 'مركز',
    branchName: 'الرئيسي',
    deviceName: 'كاشير الجهاز',
    cashierName: 'ليلى',
    ...extra,
  };
}

const view = (data: ReceiptData) =>
  render(
    <DigitsProvider digits="latn">
      <Receipt data={data} />
    </DigitsProvider>,
  );

describe('the receipt shows half units and drops noise (round 20)', () => {
  it('prints 712.50 and the rounding −2.50 so the lines add up to the total', () => {
    view(receipt({}));
    const paper = screen.getByLabelText(/إيصال/);
    expect(paper).toHaveTextContent('712.50');
    expect(paper).toHaveTextContent('2.50');
  });

  it('says the cashier only, never the device', () => {
    view(receipt({}));
    const paper = screen.getByLabelText(/إيصال/);
    expect(paper).toHaveTextContent('الكاشير: ليلى');
    expect(paper).not.toHaveTextContent('كاشير الجهاز');
  });

  it('hides a tax under 1% of the total, shows a real one', () => {
    const { unmount } = view(receipt({ taxMinor: 3 }));
    expect(screen.queryByText('منها ضريبة')).not.toBeInTheDocument();
    unmount();
    view(receipt({ taxMinor: 9_000 }));
    expect(screen.getByText('منها ضريبة')).toBeInTheDocument();
  });

  it('hides the dollar equivalent while the store does not offer dollars', () => {
    const { unmount } = view(receipt({}));
    expect(screen.queryByText(/يعادل/)).not.toBeInTheDocument();
    unmount();
    view(receipt({}, { settings: { ...settings, enabledCurrencies: ['SYP', 'USD'] } as SettingsRow }));
    expect(screen.getByText(/يعادل/)).toBeInTheDocument();
  });

  it('tags a wholesale line and says «وفّرت» once on paper and in the WhatsApp text', () => {
    const data = receipt({}, { priceTags: { 1: 'wholesale' }, contractSavings: { 1: 5_000 } });
    view(data);
    const paper = screen.getByLabelText(/إيصال/);
    expect(paper).toHaveTextContent('سعر الجملة');
    expect(paper).toHaveTextContent('وفّرت');
    const text = receiptText(data);
    expect(text).toContain('سعر الجملة (بدل');
    expect(text).toContain('وفّرت 50 ل.س');
    expect(text).toContain('712.50');
  });
});

describe('ExactMoney (round 20)', () => {
  it('shows the fraction only when there is one', () => {
    const { container } = render(
      <DigitsProvider digits="latn">
        <ExactMoney minor={71_250} currency="SYP" />
        <ExactMoney minor={71_000} currency="SYP" />
      </DigitsProvider>,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('712.50');
    expect(text).toContain('710');
    expect(text).not.toContain('710.00');
  });
});

describe('a product name keeps its closing bracket whole (round 20)', () => {
  it('puts «(3 أزواج)» in one unbroken piece', () => {
    render(<NameText name="جوارب قطن (3 أزواج)" />);
    expect(screen.getByText('(3 أزواج)')).toHaveClass('whitespace-nowrap');
  });
});

describe('the stock a device shows after its own sales (round 20)', () => {
  it('takes the unsent sale off the tile and its batch, and keeps the catalog as pulled', () => {
    const stocked = {
      ...item,
      stockQty: 5000,
      stockBatches: [
        { batchNo: 'A', expiry: '2027-01-01', qty: 3000 },
        { batchNo: 'B', expiry: '2027-06-01', qty: 2000 },
      ],
    };
    const base = { ...catalog, items: [stocked], byVariant: new Map([[stocked.variantId, stocked]]) };
    const sold = {
      qty: new Map([[stocked.variantId, 2000]]),
      batches: new Map([[stocked.variantId, [{ batchNo: 'A', expiry: '2027-01-01', qty: 2000 }]]]),
    };
    const shown = withLocalSales(base, sold);
    expect(shown.byVariant.get(stocked.variantId)!.stockQty).toBe(3000);
    expect(shown.items[0]!.stockQty).toBe(3000);
    expect(shown.items[0]!.stockBatches!.map((b) => b.qty)).toEqual([1000, 2000]);
    expect(shown.original).toBe(base);
    expect(base.items[0]!.stockQty).toBe(5000);
    const none = { qty: new Map(), batches: new Map() };
    expect(withLocalSales(base, none)).toBe(base);
  });
});

describe('best sellers (round 20)', () => {
  const sale = (variantId: string, baseQty: number): OutboxEntry =>
    ({
      type: 'sale',
      doc: { payload: { lines: [{ variantId, baseQty }] } },
    }) as unknown as OutboxEntry;

  it('lists the products sold most, none before there is any history', () => {
    expect(bestSellers(catalog, [])).toEqual([]);
    expect(bestSellers(catalog, [sale(item.variantId, 1000)])).toEqual([]);
    expect(bestSellers(catalog, [sale(item.variantId, 2000), sale(item.variantId, 2000)])).toEqual([
      item.productId,
    ]);
  });
});
