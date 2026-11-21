import { useMemo, useState } from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import { promotionActive, type PromotionAudience } from '@serva/core/promotions';
import { normalizeArabic } from '@serva/core/text';
import {
  Alert,
  Button,
  formatQuantity,
  IconButton,
  AddIcon,
  Money,
  RemoveIcon,
  SearchIcon,
  TextField,
} from '@serva/ui';
import type { Catalog, CatalogItem } from '../pos/catalog';
import { DateField } from '../lib/DateField';
import { priceCart, type PricingContext } from '../pos/sale/cart';
import { cartonText, packsOf } from './packs';
import { salesOrderCart } from './orderCart';
import { ScreenHead } from './parts';
import { useRepRequired } from './state';

interface Line {
  item: CatalogItem;
  /** Base units, thousandths */
  qty: number;
  /** One base unit, in the order's currency */
  unitPriceMinor: number;
}

/** The price a customer is given for one unit: his contract price, else wholesale if he is on it, else the shelf */
export function orderPrice(
  item: CatalogItem,
  tier: 'retail' | 'wholesale',
  contract: number | undefined,
): number {
  if (contract !== undefined && contract > 0) return contract;
  if (tier === 'wholesale' && item.price.wholesalePriceMinor) return item.price.wholesalePriceMinor;
  return item.price.priceMinor;
}

/**
 * «طلبية»: the rep promises goods to a customer without selling them now (pre-sale). Nothing is
 * posted and no stock moves; the shop fills the order later and the sale that delivers it names it.
 * Taken offline it waits on the phone and leaves when the server can be reached.
 */
export function OrderScreen({
  customerId,
  customerName,
  catalog,
  warehouseBranchId,
  onDone,
  onBack,
}: {
  customerId: string;
  customerName: string;
  catalog: Catalog;
  /** Where the order is filled from: the van's own branch, or the home branch of a rep who carries nothing */
  warehouseBranchId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const rep = useRepRequired();
  const base = (catalog.settings?.baseCurrency ?? 'SYP') as CurrencyCode;
  const holdDays = rep.sheet?.settings.orderHoldDays ?? 7;
  const customer = rep.sheet?.customers.find((c) => c.id === customerId);
  const tier = customer?.priceTier ?? 'retail';
  const contract = useMemo(
    () =>
      new Map(
        (rep.sheet?.contractPrices ?? [])
          .filter((p) => p.customerId === customerId && p.currency === base)
          .map((p) => [p.variantId, p.priceMinor]),
      ),
    [rep.sheet, customerId, base],
  );
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'sent' | 'queued' | 'refused'; text: string } | null>(null);

  const found = useMemo(() => {
    const q = normalizeArabic(search);
    if (!q) return [];
    return catalog.items
      .filter((i) => !i.isService && i.price.currency === base && i.searchKey.includes(q))
      .slice(0, 8);
  }, [search, catalog.items, base]);

  const packs = useMemo(() => packsOf(catalog), [catalog]);

  // What the delivery will charge: the same promotion engine as the sale screen, for the customer
  // and the rep's phone. Display only: the order itself carries the quantities and the promised
  // prices, and the offers are applied when the sale delivers it.
  const preview = useMemo(() => {
    if (lines.length === 0 || !catalog.settings) return null;
    const now = new Date();
    const known = catalog.customers.find((c) => c.id === customerId);
    const audience: PromotionAudience = {
      customerKind: known?.kind ?? null,
      priceTier: tier,
      rep: true,
    };
    const ctx: PricingContext = {
      currency: base,
      taxInclusive: catalog.settings.taxInclusive,
      rates: catalog.rates,
      promotions: catalog.promotions.filter((p) => promotionActive(p, now, catalog.settings!.timezone)),
      audience,
      variants: catalog.byVariant,
    };
    const { cart } = salesOrderCart(
      {
        id: '',
        number: '',
        currency: base,
        lines: lines.map((l) => ({
          variantId: l.item.variantId,
          qty: l.qty,
          deliveredQty: 0,
          unitPriceMinor: l.unitPriceMinor,
        })),
      } as Parameters<typeof salesOrderCart>[0],
      { id: customerId, name: customerName },
      catalog,
    );
    try {
      return priceCart(cart, ctx);
    } catch {
      return null;
    }
  }, [lines, catalog, customerId, customerName, tier, base]);
  const plain = lines.reduce((n, l) => n + Math.round((l.qty * l.unitPriceMinor) / 1000), 0);
  const total = preview ? preview.priced.totals.totalMinor : plain;
  const saved = Math.max(0, plain - total);
  const freeLines = preview ? preview.lines.slice(lines.length) : [];

  function add(item: CatalogItem) {
    setSearch('');
    setLines((list) => {
      const same = list.find((l) => l.item.variantId === item.variantId);
      if (same) return list.map((l) => (l === same ? { ...l, qty: l.qty + 1000 } : l));
      return [
        ...list,
        { item, qty: 1000, unitPriceMinor: orderPrice(item, tier, contract.get(item.variantId)) },
      ];
    });
  }
  const step = (variantId: string, by: number) =>
    setLines((list) =>
      list
        .map((l) => (l.item.variantId === variantId ? { ...l, qty: l.qty + by } : l))
        .filter((l) => l.qty > 0),
    );

  async function save() {
    if (lines.length === 0 || saving) return;
    setSaving(true);
    const answer = await rep.submitOrder({
      customerId,
      warehouseBranchId,
      repId: rep.sheet?.rep.id ?? null,
      currency: base,
      lines: lines.map((l) => ({
        variantId: l.item.variantId,
        qty: l.qty,
        deliveredQty: 0,
        unitPriceMinor: l.unitPriceMinor,
      })),
      deliveryDate: date || null,
      note: note.trim() || null,
    });
    setSaving(false);
    if (answer.kind === 'sent') setResult({ kind: 'sent', text: `سُجّلت الطلبية ${answer.number}.` });
    else if (answer.kind === 'queued')
      setResult({ kind: 'queued', text: 'حُفظت الطلبية على الجهاز وتُرسل عند عودة الاتصال.' });
    else setResult({ kind: 'refused', text: answer.message });
  }

  if (result && result.kind !== 'refused') {
    return (
      <div className="flex flex-col gap-4">
        <ScreenHead title="طلبية" onBack={onDone} />
        <Alert tone={result.kind === 'sent' ? 'success' : 'info'}>{result.text}</Alert>
        <Button size="lg" onClick={onDone}>
          عودة إلى الزبون
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title={`طلبية · ${customerName}`} onBack={onBack} />
      <p className="text-sm text-ink-muted">
        لا يُسجَّل بيع ولا يتحرك مخزون. تُحجز الأصناف للزبون {holdDays} أيام ثم تنتهي الطلبية.
      </p>
      <TextField
        label="ابحث عن صنف"
        value={search}
        onChange={(e) => setSearch(e.target.value.slice(0, 60))}
        startAdornment={<SearchIcon className="ms-4 shrink-0" />}
      />
      {found.length > 0 ? (
        <ul aria-label="الأصناف" className="flex flex-col gap-1">
          {found.map((item) => (
            <li key={item.variantId}>
              <button
                type="button"
                onClick={() => add(item)}
                className="flex min-h-14 w-full items-center gap-3 rounded-control border border-line bg-surface px-3 text-start hover:bg-surface-muted"
              >
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{item.name}</span>
                <Money
                  minor={orderPrice(item, tier, contract.get(item.variantId))}
                  currency={base}
                  className="text-sm text-ink-muted"
                />
                <AddIcon className="shrink-0 text-brand-ink" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul aria-label="بنود الطلبية" className="flex flex-col gap-2">
        {lines.map((l, index) => (
          <li
            key={l.item.variantId}
            className="flex items-center gap-2 rounded-card border border-line bg-surface p-3"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold text-ink">{l.item.name}</span>
              <Money minor={l.unitPriceMinor} currency={base} className="text-xs text-ink-muted" />
              {cartonText(l.qty, packs.get(l.item.variantId)) ? (
                <span className="num text-xs text-ink-muted">
                  {cartonText(l.qty, packs.get(l.item.variantId))}
                </span>
              ) : null}
              {preview &&
              preview.lines[index]?.discount?.source === 'promotion' &&
              preview.lines[index]!.priced.lineDiscountMinor > 0 ? (
                <span className="text-xs font-semibold text-success-ink">
                  {preview.lines[index]!.discount!.reason} −{' '}
                  <Money
                    minor={preview.lines[index]!.priced.lineDiscountMinor}
                    currency={base}
                    symbol={false}
                  />
                </span>
              ) : null}
            </span>
            <IconButton label="أنقص" icon={<RemoveIcon />} onClick={() => step(l.item.variantId, -1000)} />
            <span className="num min-w-8 text-center font-bold">{formatQuantity(l.qty)}</span>
            <IconButton label="زد" icon={<AddIcon />} onClick={() => step(l.item.variantId, 1000)} />
            {packs.get(l.item.variantId) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => step(l.item.variantId, packs.get(l.item.variantId)!.packQty)}
              >
                + {packs.get(l.item.variantId)!.name}
              </Button>
            ) : null}
          </li>
        ))}
        {freeLines.map((f) => (
          <li
            key={`free-${f.lineNo}`}
            className="flex items-center gap-2 rounded-card border border-dashed border-line bg-surface p-3"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold text-ink">{f.name}</span>
              <span className="text-xs font-semibold text-success-ink">مجاناً · {f.discount?.reason}</span>
            </span>
            <span className="num font-bold">{formatQuantity(f.qty)}</span>
          </li>
        ))}
      </ul>
      <DateField label="موعد التسليم (اختياري)" value={date} onChange={setDate} />
      <TextField
        label="ملاحظة (اختياري)"
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 300))}
      />
      {result?.kind === 'refused' ? <Alert tone="error">{result.text}</Alert> : null}
      {saved > 0 || freeLines.length > 0 ? (
        <p className="text-xs text-ink-muted">
          الأسعار بعد العروض للعرض فقط. تُطبَّق العروض عند التسليم، وقد يختلف المبلغ إن تغيّرت.
        </p>
      ) : null}
      <div className="flex items-center gap-3 border-t border-line pt-3">
        <span className="flex-1 text-ink-muted">الإجمالي بعد العروض</span>
        <Money minor={total} currency={base} className="text-lg font-bold text-ink" />
      </div>
      <Button size="lg" loading={saving} disabled={lines.length === 0} onClick={() => void save()}>
        احفظ الطلبية
      </Button>
    </div>
  );
}
