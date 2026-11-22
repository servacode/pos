import type { CurrencyCode } from '@serva/core/currencies';
import { convert } from '@serva/core/money';
import { rateFor } from '@serva/core/sale';
import {
  Button,
  ClockIcon,
  displayNumber,
  formatQuantity,
  Money,
  PercentIcon,
  SearchIcon,
  TotalPanel,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { ExactMoney } from '../ExactMoney';
import { counted } from '../format';
import { CartWarnings } from './CartWarnings';
import { BatchBanner } from './BatchBanner';
import type { batchGuard } from './batches';
import { restoreLine, type Cart, type CartLine as Line, type PricedCart, type PricingContext } from './cart';
import { clearInvoiceDiscount } from './groupDiscount';
import { CART_QUICK, type SaleMode, type SaleScreenProps } from './saleTypes';

export interface CartTotalsProps {
  cart: Cart;
  setCart: SaleScreenProps['setCart'];
  setMode: (mode: SaleMode) => void;
  totals: PricedCart['priced']['totals'] | undefined;
  ctx: PricingContext;
  totalMinor: number;
  planFeeMinor: number;
  contractSaved: number;
  taxInclusive: boolean;
  pharmacy: unknown;
  foreign: CurrencyCode | null;
  shownRate: Catalog['rates'][number] | undefined;
  guard: ReturnType<typeof batchGuard>;
  batchWaits: boolean;
  warnRows: number;
  warnDanger: boolean;
  removed: { line: Line; index: number } | null;
  setRemoved: (removed: { line: Line; index: number } | null) => void;
  lineCount: number;
  heldCount: number;
  onResume: SaleScreenProps['onResume'];
  selected: number | null;
  payBlock: { text: string; go: () => void } | null;
  canPay: boolean;
  startPay: () => void;
}

/** The invoice discount chip, the undo toast for a removed line, and the total with «ادفع» */
export function CartTotals({
  cart,
  setCart,
  setMode,
  totals,
  ctx,
  totalMinor,
  planFeeMinor,
  contractSaved,
  taxInclusive,
  pharmacy,
  foreign,
  shownRate,
  guard,
  batchWaits,
  warnRows,
  warnDanger,
  removed,
  setRemoved,
  lineCount,
  heldCount,
  onResume,
  selected,
  payBlock,
  canPay,
  startPay,
}: CartTotalsProps) {
  const digits = useDigits();
  // With three quiet actions (a pharmacy's «بدائل») each one is narrower, so «ادفع» and its amount keep their room
  const quick = pharmacy ? CART_QUICK.replace('w-16', 'w-12') : CART_QUICK;
  return (
    <>
      {cart.invoiceDiscount && totals && totals.invoiceDiscountMinor > 0 ? (
        <div
          role="status"
          aria-label="خصم الفاتورة"
          title={`يشمل كل الأسطر${cart.lines.some((l) => l.isService) ? ' ما عدا الخدمات' : ''}، وما تضيفه بعد الآن.`}
          className="mx-3 mb-1.5 flex shrink-0 items-center gap-3 rounded-card border border-info/20 bg-info-soft py-0.5 ps-3 pe-1 text-sm text-info-ink"
        >
          <PercentIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">
              {cart.invoiceGroup ? `خصم المجموعة ${cart.invoiceGroup.name}` : 'خصم الفاتورة'}{' '}
              {cart.invoiceDiscount.type === 'percent'
                ? `${displayNumber(String(cart.invoiceDiscount.bp / 100), digits)}%`
                : ''}{' '}
              <ExactMoney minor={totals.invoiceDiscountMinor} currency={ctx.currency} symbol={false} />
            </span>
            <span className={cart.lines.some((l) => l.isService) ? 'block text-xs' : 'sr-only'}>
              {cart.lines.some((l) => l.isService)
                ? 'ما عدا الخدمات، وما تضيفه بعد الآن'
                : 'يشمل كل الأسطر، وما تضيفه بعد الآن.'}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setCart(clearInvoiceDiscount)}>
            أزله
          </Button>
        </div>
      ) : null}
      {cart.coupon ? (
        <div
          role="status"
          aria-label="كود الخصم"
          className="mx-3 mb-1.5 flex shrink-0 items-center gap-3 rounded-card border border-info/20 bg-info-soft py-0.5 ps-3 pe-1 text-sm text-info-ink"
        >
          <PercentIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate font-semibold">
            كود الخصم <bdi dir="ltr">{cart.coupon.code}</bdi> · {cart.coupon.name}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setCart((c) => {
                const { coupon: _gone, ...rest } = c;
                return rest;
              })
            }
          >
            أزله
          </Button>
        </div>
      ) : null}
      {removed ? (
        <div
          role="status"
          className="mx-3 mb-3 flex shrink-0 items-center gap-3 rounded-card bg-ink py-1 ps-4 pe-1 text-sm text-surface shadow-e3 motion-safe:animate-rise"
        >
          <span className="min-w-0 flex-1 truncate">حُذف «{removed.line.name}»</span>
          <button
            type="button"
            onClick={() => {
              setCart((c) => restoreLine(c, removed.line, removed.index));
              setRemoved(null);
            }}
            className="flex min-h-12 items-center gap-1.5 rounded-small px-3 font-bold text-brand-soft transition-colors duration-120 ease-standard hover:bg-surface/10"
          >
            <UndoIcon size={16} />
            تراجع
          </button>
        </div>
      ) : null}
      <TotalPanel
        totalMinor={totalMinor + planFeeMinor}
        currency={ctx.currency}
        label={planFeeMinor > 0 ? 'المطلوب مع رسم التقسيط' : 'المطلوب'}
        breakdown={[
          ...(totals && totals.discountMinor > 0
            ? [
                { label: 'المجموع قبل الخصم', minor: totals.grossMinor },
                { label: 'الخصم · وفّر الزبون', minor: totals.discountMinor, tone: 'info' as const },
              ]
            : []),
          ...(contractSaved > 0 ? [{ label: 'وفّرت', minor: contractSaved, tone: 'info' as const }] : []),
          ...(totals && !taxInclusive && totals.taxMinor > 0
            ? [{ label: 'الضريبة', minor: totals.taxMinor }]
            : []),
          ...(planFeeMinor > 0 ? [{ label: 'رسم التقسيط', minor: planFeeMinor }] : []),
        ]}
        note={
          foreign ? (
            <>
              ≈{' '}
              <Money
                minor={convert(totalMinor, ctx.currency, foreign, rateFor(ctx.rates, foreign, ctx.currency))}
                currency={foreign}
              />{' '}
              · سعر الصرف <bdi className="num">{displayNumber(shownRate!.rate, digits)}</bdi>
            </>
          ) : undefined
        }
        notice={
          guard.blocks.length + guard.stockBlocks.length + guard.stockWarns.length > 0 || batchWaits ? (
            // One collapsible row: two warnings must not push the cart's lines out of the panel
            <CartWarnings
              title={counted(warnRows, ['تنبيه واحد', 'تنبيهان', 'تنبيهات', 'تنبيهاً'], digits)}
              danger={warnDanger}
              forceOpen={Boolean(batchWaits)}
            >
              <BatchBanner
                blocks={guard.blocks}
                approvals={batchWaits ? guard.approvals : []}
                stockBlocks={guard.stockBlocks}
                stockWarns={guard.stockWarns}
                fmt={(q) => formatQuantity(q, digits)}
                onApprove={() => setMode({ kind: 'batchApprove' })}
                {...(pharmacy
                  ? {
                      onAlternatives: (of: { lineNo: number } | { variantId: string }) => {
                        const line =
                          'lineNo' in of ? cart.lines.find((l) => l.lineNo === of.lineNo) : undefined;
                        const variantId = 'variantId' in of ? of.variantId : line?.variantId;
                        if (variantId)
                          setMode({
                            kind: 'alternatives',
                            variantId,
                            ...(line ? { lineNo: line.lineNo } : {}),
                          });
                      },
                    }
                  : {})}
              />
            </CartWarnings>
          ) : undefined
        }
        actions={
          <>
            <button
              type="button"
              aria-label={lineCount === 0 && heldCount > 0 ? 'استرجع المعلّقة' : 'علّق'}
              aria-keyshortcuts="F4"
              title="ضع هذه الفاتورة جانباً وأكمل غيرها، ثم استرجعها (F4)"
              onClick={() => {
                if (lineCount > 0) setMode({ kind: 'holdName' });
                else if (heldCount === 1) onResume(0);
                else setMode({ kind: 'heldList' });
              }}
              disabled={lineCount === 0 && heldCount === 0}
              className={quick}
            >
              {lineCount === 0 && heldCount > 0 ? <UndoIcon size={20} /> : <ClockIcon size={20} />}
              <span>{lineCount === 0 && heldCount > 0 ? 'استرجع' : 'علّق'}</span>
            </button>
            {/* One «خصم» in view: while a line is open its own «خصم» is the one; Alt+1 still opens the invoice's */}
            {selected === null ? (
              <button
                type="button"
                aria-label="خصم"
                aria-keyshortcuts="Alt+1"
                title="خصم على الفاتورة (Alt+1)"
                onClick={() => setMode({ kind: 'invoice' })}
                disabled={lineCount === 0}
                className={quick}
              >
                <PercentIcon size={20} />
                <span>خصم</span>
              </button>
            ) : null}
            {/* A pharmacy: the same medicine in another brand, in stock, for the line in hand (round 38) */}
            {pharmacy ? (
              <button
                type="button"
                aria-label="بدائل الصنف"
                title="بدائل بنفس المادة الفعالة، متوفرة الآن"
                onClick={() => {
                  const line =
                    cart.lines.find((l) => l.lineNo === selected) ?? cart.lines[cart.lines.length - 1];
                  if (line) setMode({ kind: 'alternatives', variantId: line.variantId, lineNo: line.lineNo });
                }}
                disabled={lineCount === 0}
                className={quick}
              >
                <SearchIcon size={20} />
                <span>بدائل</span>
              </button>
            ) : null}
          </>
        }
        onPay={startPay}
        payDisabled={!canPay}
        blockedReason={payBlock?.text}
        onBlockedTap={payBlock?.go}
        payShortcut="F12"
      />
    </>
  );
}
