import { dayText } from '../../lib/dates';
import {
  AddIcon,
  BarcodeIcon,
  Button,
  CartLine,
  cn,
  displayNumber,
  formatQuantity,
  KeyIcon,
  Money,
  OfferIcon,
  PercentIcon,
  RemoveIcon,
  useDigits,
  WarningIcon,
  WeighedIcon,
} from '@serva/ui';
import { type BarcodeHit, type Catalog } from '../catalog';
import { ExactMoney } from '../ExactMoney';
import { isolateSizes } from '../format';
import type { planBatches } from './batches';
import { NEED_TEXT } from './AdjustPanel';
import {
  buyGetHint,
  customerPriceKind,
  shelfPriceOf,
  unitPriceOf,
  type ApprovalNeed,
  type Cart,
  type CartLine as Line,
  type PricedCart,
  type PricingContext,
} from './cart';
import type { modelPieces } from './models';
import { changeLabel, variantSplit } from './models';
import { serialLabel } from '@serva/core/contracts/warranty';
import { packLineText } from './packText';
import type { SaleMode } from './saleTypes';

export interface CartLinesProps {
  lineCount: number;
  cart: Cart;
  priced: PricedCart | null;
  catalog: Catalog;
  ctx: PricingContext;
  needs: Map<number, ApprovalNeed>;
  takePlan: ReturnType<typeof planBatches>;
  bump: number | null;
  packsByVariant: Map<string, BarcodeHit[]>;
  pieces: ReturnType<typeof modelPieces>;
  sectors: NonNullable<Catalog['settings']>['sectors'];
  selected: number | null;
  setSelected: (update: (selected: number | null) => number | null) => void;
  lineWarn: (line: Line) => 'danger' | 'warning' | null;
  remove: (lineNo: number) => void;
  changeQty: (line: Line, delta: number) => void;
  setMode: (mode: SaleMode) => void;
}

/** The cart's lines (and the free pieces a promotion earned), each opening in place with its buttons */
export function CartLines({
  lineCount,
  cart,
  priced,
  catalog,
  ctx,
  needs,
  takePlan,
  bump,
  packsByVariant,
  pieces,
  sectors,
  selected,
  setSelected,
  lineWarn,
  remove,
  changeQty,
  setMode,
}: CartLinesProps) {
  const digits = useDigits();
  return (
    <div className="min-h-32 flex-1 overflow-y-auto pb-2">
      {lineCount === 0 ? (
        // One short hint line, not a big empty state: the items are one glance away
        <p className="flex items-center justify-center gap-2 px-4 py-6 text-center text-sm text-ink-muted">
          <BarcodeIcon size={20} className="shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold text-ink">السلة فارغة</span> · امسح الباركود أو اختر صنفاً.
          </span>
        </p>
      ) : (
        <ul aria-label="أسطر الفاتورة" className="flex flex-col gap-0.5 p-1">
          {cart.lines.map((line, i) => {
            const p = priced?.lines[i];
            const split = variantSplit(line.name, catalog.byVariant.get(line.variantId));
            const need = needs.get(line.lineNo);
            const adj = line.adjustment;
            const discounted = p !== undefined && p.priced.lineDiscountMinor > 0;
            const promoHint = buyGetHint(line, ctx);
            const percent =
              adj?.kind === 'discount' && adj.discount.type === 'percent' ? adj.discount.bp : null;
            const meta = [
              packLineText(line, (q) => formatQuantity(q, digits)) ?? (line.packName ? line.packName : null),
              adj?.kind === 'price' ? 'سعر معدّل' : null,
              // A batch line says which lots it takes and their dates
              ...(takePlan.allocations.get(line.lineNo) ?? [])
                .filter((b) => b.batchNo)
                .map((b) => (
                  <span key={`lot-${b.batchNo}`} className="whitespace-nowrap">
                    دفعة <bdi dir="ltr">{b.batchNo}</bdi>
                    {b.expiry ? ` · تنتهي ${dayText(b.expiry, digits)}` : ''}
                  </span>
                )),
              // A discount on the line: the price before it struck through, then what was taken off
              discounted && p ? (
                <span key="was" className="whitespace-nowrap text-ink-subtle">
                  <s>
                    <ExactMoney minor={p.priced.grossMinor} currency={ctx.currency} symbol={false} />
                  </s>
                </span>
              ) : null,
              discounted && p && adj?.kind === 'discount' ? (
                <span key="d" className="inline-flex items-center gap-1 font-semibold text-info-ink">
                  <PercentIcon size={16} className="shrink-0" aria-hidden="true" />
                  خصم{percent !== null ? ` ${displayNumber(String(percent / 100), digits)}%` : ''}{' '}
                  <ExactMoney minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                </span>
              ) : null,
              discounted && p && adj?.kind === 'price' ? (
                <span key="pd" className="font-semibold text-info-ink">
                  −<ExactMoney minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                </span>
              ) : null,
              p && p.priced.lineDiscountMinor > 0 && p.discount?.source === 'promotion' ? (
                <span key="o" className="font-semibold text-success-ink">
                  {p.discount.reason} −
                  <ExactMoney minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                </span>
              ) : null,
              promoHint ? (
                <span key="hint" className="font-semibold text-success-ink">
                  أضف قطعة تأخذ {promoHint.get === 1 ? 'واحدة' : displayNumber(String(promoHint.get), digits)}{' '}
                  مجاناً
                </span>
              ) : null,
              customerPriceKind(line) !== null ? (
                <span key="c" className="font-semibold text-info-ink">
                  {shelfPriceOf(line) !== undefined && shelfPriceOf(line)! > line.priceMinor ? (
                    <s className="me-1.5 font-normal text-ink-subtle">
                      <Money
                        minor={unitPriceOf(
                          { priceCurrency: line.priceCurrency, priceMinor: shelfPriceOf(line)! },
                          ctx,
                        )}
                        currency={ctx.currency}
                        symbol={false}
                      />
                    </s>
                  ) : null}
                  {customerPriceKind(line) === 'contract' ? 'سعر العقد' : 'سعر الجملة'}
                </span>
              ) : null,
              bump === line.lineNo ? (
                <span key="b" className="font-semibold text-brand-ink motion-safe:animate-pop">
                  +1
                </span>
              ) : null,
            ].filter(Boolean);
            return (
              <CartLine
                key={line.lineNo}
                id={`cart-line-${line.lineNo}`}
                name={isolateSizes(split.name)}
                {...(split.variant ? { variant: isolateSizes(split.variant) } : {})}
                qtyThousandths={line.qty}
                unit={line.unitSymbol ?? undefined}
                unitPriceMinor={p?.unitPriceMinor ?? 0}
                lineTotalMinor={p?.priced.totalMinor ?? 0}
                currency={ctx.currency}
                meta={
                  meta.length > 0 ? (
                    <>
                      {meta.map((m, k) => (
                        <span key={k} className="me-3 inline-block">
                          {m}
                        </span>
                      ))}
                    </>
                  ) : undefined
                }
                extra={
                  packsByVariant.has(line.variantId) || line.tracksSerial || pieces.has(line.productId) ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {pieces.has(line.productId) ? (
                        // A wrong size at the fitting: the same line takes another size or colour in place
                        <button
                          type="button"
                          className="min-h-11 rounded-small border border-line-control/50 bg-surface px-3 text-sm font-semibold text-ink"
                          onClick={() =>
                            setMode({
                              kind: 'pick',
                              productId: line.productId,
                              replaceLine: line.lineNo,
                              initial: Object.fromEntries(
                                (catalog.byVariant.get(line.variantId)?.attributes ?? []).map((a) => [
                                  a.name,
                                  a.value,
                                ]),
                              ),
                            })
                          }
                        >
                          {changeLabel(pieces.get(line.productId)!)} ▾
                        </button>
                      ) : null}
                      {packsByVariant.has(line.variantId) ? (
                        // The unit sold (piece or a box): one tap to change it, at the same quantity
                        <button
                          type="button"
                          aria-label="غيّر الوحدة"
                          className="min-h-11 rounded-small border border-line-control/50 bg-surface px-3 text-sm font-semibold text-ink"
                          onClick={() =>
                            setMode({ kind: 'unit', variantId: line.variantId, replaceLine: line.lineNo })
                          }
                        >
                          {line.packName ?? (line.packQty === 1000 ? 'قطعة' : 'علبة')} ▾
                        </button>
                      ) : null}
                      {line.tracksSerial ? (
                        <button
                          type="button"
                          className={cn(
                            'min-h-11 rounded-small underline-offset-4 hover:underline',
                            (line.serials?.length ?? 0) > 0
                              ? 'text-ink-muted'
                              : 'font-semibold text-danger-ink',
                          )}
                          onClick={() => setMode({ kind: 'serial', lineNo: line.lineNo })}
                        >
                          {line.serials?.length
                            ? `${serialLabel(sectors)} ${line.serials.join('، ')}`
                            : 'اكتب الرقم التسلسلي'}
                        </button>
                      ) : null}
                    </span>
                  ) : undefined
                }
                warning={lineWarn(line)}
                selected={selected === line.lineNo}
                onSelect={() => setSelected((s) => (s === line.lineNo ? null : line.lineNo))}
                onRemove={() => remove(line.lineNo)}
              >
                {need ? (
                  <p
                    role="alert"
                    className="flex w-full items-center gap-2 rounded-small bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-ink"
                  >
                    <WarningIcon size={16} className="shrink-0" />
                    {NEED_TEXT[need]}
                  </p>
                ) : null}
                {/* One row: the quantity, then «خصم / السعر» (they wrap only when a manager's code joins) */}
                <div className="flex w-full flex-wrap items-center gap-2">
                  <div className="flex shrink-0 items-center gap-2">
                    {line.weighed ? (
                      <Button
                        variant="secondary"
                        size="md"
                        icon={<WeighedIcon size={20} />}
                        onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'qty' })}
                      >
                        الوزن
                      </Button>
                    ) : (
                      <div
                        dir="ltr"
                        className="inline-flex items-stretch overflow-hidden rounded-control border border-line-control/50 bg-surface shadow-e1"
                      >
                        <button
                          type="button"
                          aria-label="أنقص الكمية"
                          onClick={() => changeQty(line, -1)}
                          className="grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink active:bg-surface-muted"
                        >
                          <RemoveIcon size={20} />
                        </button>
                        <button
                          type="button"
                          aria-label="اكتب الكمية"
                          onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'qty' })}
                          className="num min-w-14 border-x border-line px-2 text-center text-lg font-bold text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted"
                        >
                          {formatQuantity(line.qty, digits)}
                        </button>
                        <button
                          type="button"
                          aria-label="زِد الكمية"
                          onClick={() => changeQty(line, 1)}
                          className="grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink active:bg-surface-muted"
                        >
                          <AddIcon size={20} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid min-w-40 flex-1 auto-cols-fr grid-flow-col gap-2">
                    <Button
                      variant="secondary"
                      size="md"
                      icon={<PercentIcon size={20} />}
                      onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'percent' })}
                    >
                      خصم
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      icon={<OfferIcon size={20} />}
                      onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'price' })}
                    >
                      السعر
                    </Button>
                    {need ? (
                      <Button
                        variant="secondary"
                        size="md"
                        icon={<KeyIcon size={20} />}
                        onClick={() => setMode({ kind: 'approve', lineNo: line.lineNo, need })}
                      >
                        رمز المدير
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CartLine>
            );
          })}
          {/* The free pieces a promotion earned: derived from the cart, so they come and go with it */}
          {(priced?.lines.slice(cart.lines.length) ?? []).map((free) => (
            <li
              key={free.lineNo}
              aria-label={`مجاني: ${free.name}`}
              className="flex items-center gap-2 rounded-small bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink"
            >
              <span className="min-w-0 flex-1">
                {free.name} × {formatQuantity(free.qty, digits)}
              </span>
              <span className="shrink-0">مجاناً · {free.discount?.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
