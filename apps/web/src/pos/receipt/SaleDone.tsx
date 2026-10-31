import type { SalePayload } from '@serva/core/contracts/documents';
import { Button, CheckIcon, cn, Money, PrintIcon } from '@serva/ui';
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
  onNewSale,
}: {
  data: ReceiptData;
  online: boolean;
  width: PaperWidth;
  onWidth: (width: PaperWidth) => void;
  onPrint: () => void;
  onNewSale: () => void;
}) {
  const sale = data.doc.payload as unknown as SalePayload;
  const change = sale.change;
  const notes = change ? changeNotes(change.amountMinor, DENOMINATIONS[change.currency] ?? []) : [];
  const methods = [...new Set(sale.payments.map((p) => methodLabel(p.method, p.currency, sale.currency)))];

  return (
    <section
      aria-label="تمت البيعة"
      className="flex min-h-0 flex-1 overflow-hidden rounded-card border border-line bg-surface shadow-e3 motion-safe:animate-rise"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-7">
        <span className="grid size-16 place-items-center rounded-full bg-success-soft text-success-ink motion-safe:animate-pop">
          <CheckIcon size={32} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold text-ink">تمت البيعة</h2>
          <p className="text-ink-muted">
            فاتورة رقم{' '}
            <bdi dir="ltr" className="num">
              {data.doc.number}
            </bdi>{' '}
            · {methods.join(' + ')} · <Money minor={sale.totals.totalMinor} currency={sale.currency} />
          </p>
        </div>
        {change ? (
          <div
            role="status"
            className="flex flex-col rounded-card border border-line bg-surface-total px-6 py-4"
          >
            <span className="font-semibold text-ink-muted">الباقي للزبون</span>
            <Money
              minor={change.amountMinor}
              currency={change.currency}
              className="text-display font-bold text-ink"
            />
            {notes.length > 0 ? (
              <span className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                أعطه:
                {notes.map((note, i) => (
                  <Money
                    key={i}
                    minor={note}
                    currency={change.currency}
                    symbol={false}
                    className="rounded-small border border-line bg-surface px-2 font-semibold text-ink"
                  />
                ))}
              </span>
            ) : null}
          </div>
        ) : (
          <div
            role="status"
            className="rounded-card bg-surface-total px-5 py-4 text-lg font-semibold text-ink"
          >
            لا باقي · المبلغ مدفوع تماماً
          </div>
        )}
        {!online ? (
          <p className="rounded-control bg-warning-soft px-4 py-3 text-sm text-warning-ink">
            <strong>دون إنترنت:</strong> الفاتورة محفوظة على هذا الجهاز، وتُرسل وحدها عند عودة الإنترنت.
          </p>
        ) : null}
        <span className="flex-1" />
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" icon={<PrintIcon />} onClick={onPrint}>
            اطبع
          </Button>
          <Button size="pay" onClick={onNewSale} className="flex-1 justify-center">
            بيعة جديدة
          </Button>
        </div>
      </div>
      <aside
        aria-label="معاينة الإيصال"
        className="hidden w-[25rem] shrink-0 flex-col items-center gap-3 overflow-y-auto border-s border-line bg-surface-muted px-4 py-5 xl:flex"
      >
        <div role="group" aria-label="عرض الورق" className="flex gap-1 rounded-control bg-surface p-1">
          {([80, 58] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={width === w}
              onClick={() => onWidth(w)}
              className={cn(
                'min-h-12 rounded-xl px-4 text-sm font-semibold',
                width === w ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted',
              )}
            >
              {w} مم
            </button>
          ))}
        </div>
        <div className="shadow-e2">
          <Receipt data={data} width={width} />
        </div>
      </aside>
    </section>
  );
}
