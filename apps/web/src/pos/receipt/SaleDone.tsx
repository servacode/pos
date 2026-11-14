import type { SalePayload } from '@serva/core/contracts/documents';
import { Button, CartIcon, CheckIcon, cn, Money, OfflineIcon, PrintIcon } from '@serva/ui';
import { DENOMINATIONS } from '../shift/shift';
import { changeNotes } from '../pay/payment';
import { methodLabel, Receipt, type PaperWidth, type ReceiptData } from './Receipt';

/**
 * «تمت البيعة» (kit cashier/PaymentDone): the change in large type with the notes to hand back,
 * the number the sale took, print and «بيعة جديدة», and the receipt as it prints. The next scan
 * starts the next sale on its own.
 */
export function SaleDone({
  data,
  online,
  width,
  onWidth,
  onPrint,
  onPrintWarranty,
  onPrintA4,
  onNewSale,
}: {
  data: ReceiptData;
  online: boolean;
  width: PaperWidth;
  onWidth: (width: PaperWidth) => void;
  onPrint: () => void;
  /** «اطبع شهادة الكفالة» (A4), when the sale has devices with a warranty */
  onPrintWarranty?: () => void;
  /** «اطبع A4» and «إشعار تسليم»: the invoice (a tax invoice when the store has a tax number) or its delivery note on A4 */
  onPrintA4?: (kind: 'invoice' | 'delivery') => void;
  onNewSale: () => void;
}) {
  const sale = data.doc.payload as unknown as SalePayload;
  const change = sale.change;
  const notes = change ? changeNotes(change.amountMinor, DENOMINATIONS[change.currency] ?? []) : [];
  // A sale on account or by cheque has no change: it says what stays with the customer instead
  const onAccount = (['credit', 'cheque'] as const).flatMap((method) => {
    const parts = sale.payments.filter((p) => p.method === method);
    return parts.length > 0
      ? [{ method, currency: parts[0]!.currency, amountMinor: parts.reduce((s, p) => s + p.amountMinor, 0) }]
      : [];
  });
  const methods = [...new Set(sale.payments.map((p) => methodLabel(p.method, p.currency, sale.currency)))];

  return (
    <section
      aria-label="تمت البيعة"
      className="flex min-h-0 flex-1 overflow-hidden rounded-panel border border-line bg-surface shadow-e1 motion-safe:animate-rise"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6 xl:p-8">
        <div className="flex flex-col items-start gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-full bg-success-soft text-success-ink ring-8 ring-success-soft/40 motion-safe:animate-pop">
            <CheckIcon size={32} strokeWidth={2.5} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-3xl font-bold text-ink">تمت البيعة</h2>
            <p className="text-ink-muted">
              فاتورة رقم{' '}
              <bdi dir="ltr" className="num font-semibold text-ink">
                {data.doc.number}
              </bdi>{' '}
              · {methods.join(' + ')} ·{' '}
              <Money
                minor={sale.totals.totalMinor}
                currency={sale.currency}
                className="font-semibold text-ink"
              />
            </p>
          </div>
        </div>
        {change ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-card border border-line bg-surface-total px-6 py-5"
          >
            <span className="text-sm font-semibold text-ink-muted">الباقي للزبون</span>
            <Money
              minor={change.amountMinor}
              currency={change.currency}
              className="text-display font-bold tracking-tight text-ink"
              unitClassName="text-2xl font-semibold text-ink-subtle"
            />
            {notes.length > 0 ? (
              <span className="flex flex-wrap items-center gap-2 pt-1 text-sm text-ink-muted">
                أعطه:
                {notes.map((note, i) => (
                  <Money
                    key={i}
                    minor={note}
                    currency={change.currency}
                    symbol={false}
                    className="rounded-small border border-line-control/50 bg-surface px-2.5 py-1 font-bold text-ink shadow-e1"
                  />
                ))}
              </span>
            ) : null}
          </div>
        ) : (
          <div
            role="status"
            className="flex items-center gap-3 rounded-card border border-line bg-surface-total px-6 py-5 text-lg font-semibold text-ink"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-soft text-success-ink">
              <CheckIcon size={20} />
            </span>
            {onAccount.length > 0 ? (
              <span className="flex flex-col gap-1">
                {onAccount.map((p) => (
                  <span key={p.method}>
                    {p.method === 'credit' ? 'على حساب الزبون: ' : 'بشيك: '}
                    <Money minor={p.amountMinor} currency={p.currency} />
                  </span>
                ))}
              </span>
            ) : (
              'لا باقي · المبلغ مدفوع تماماً'
            )}
          </div>
        )}
        {!online ? (
          <p className="flex items-start gap-2.5 rounded-card border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
            <OfflineIcon size={20} className="shrink-0" />
            <span>
              <strong className="font-semibold">دون إنترنت:</strong> الفاتورة محفوظة على هذا الجهاز، وتُرسل
              وحدها عند عودة الإنترنت.
            </span>
          </p>
        ) : null}
        <span className="flex-1" />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            variant="secondary"
            size="lg"
            icon={<PrintIcon />}
            onClick={onPrint}
            className="sm:min-w-36"
          >
            اطبع
          </Button>
          {onPrintA4 ? (
            <Button variant="secondary" size="lg" icon={<PrintIcon />} onClick={() => onPrintA4('invoice')}>
              اطبع A4
            </Button>
          ) : null}
          {onPrintA4 ? (
            <Button variant="secondary" size="lg" icon={<PrintIcon />} onClick={() => onPrintA4('delivery')}>
              إشعار تسليم
            </Button>
          ) : null}
          {onPrintWarranty ? (
            <Button variant="secondary" size="lg" icon={<PrintIcon />} onClick={onPrintWarranty}>
              اطبع شهادة الكفالة
            </Button>
          ) : null}
          <Button size="pay" onClick={onNewSale} className="min-w-60 flex-1 sm:basis-full">
            بيعة جديدة
            <CartIcon size={24} />
          </Button>
        </div>
      </div>
      <aside
        aria-label="معاينة الإيصال"
        className="hidden w-100 shrink-0 flex-col items-center gap-4 overflow-y-auto border-s border-line bg-surface-muted/60 px-4 py-5 xl:flex"
      >
        <div role="group" aria-label="عرض الورق" className="flex gap-1 rounded-control bg-surface-muted p-1">
          {([80, 58] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={width === w}
              onClick={() => onWidth(w)}
              className={cn(
                'min-h-12 rounded-small px-5 text-base font-semibold transition-[background-color,color,box-shadow] duration-120 ease-standard',
                width === w
                  ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {w} مم
            </button>
          ))}
        </div>
        <div className="rounded-small shadow-e2 ring-1 ring-line">
          <Receipt data={data} width={width} />
        </div>
      </aside>
    </section>
  );
}
