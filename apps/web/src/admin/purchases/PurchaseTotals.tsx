import type { CurrencyCode, PurchaseCurrencyCode, PurchasePayment, SupplierRow } from '@serva/core';
import { Button, Card, formatQuantity, Money, Switch, useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { PAYMENT_TEXT } from './pui';
import { SummaryRow } from './PurchasesShared';

/** The totals of a purchase form: they stay in view beside the form on a wide screen, over the bottom edge on a phone. */
export function PurchaseTotals({
  supplier,
  base,
  usd,
  rate,
  payment,
  dueDate,
  adjusted,
  gross,
  discountN,
  chargesN,
  invoiceCurrency,
  usedCount,
  pieces,
  total,
  totalBase,
  saving,
  ready,
  notReadyWhy,
  onCancel,
  pastNames,
  pastOk,
  onPastOk,
  skipped,
  fromOrder,
}: {
  supplier: SupplierRow | undefined;
  base: CurrencyCode;
  usd: boolean;
  rate: string;
  payment: PurchasePayment;
  dueDate: string | null;
  adjusted: boolean;
  gross: number;
  discountN: number | null;
  chargesN: number | null;
  invoiceCurrency: PurchaseCurrencyCode;
  usedCount: number;
  pieces: number;
  total: number;
  totalBase: number;
  saving: boolean;
  ready: boolean;
  notReadyWhy: string | null;
  onCancel: () => void;
  pastNames: string[];
  pastOk: boolean;
  onPastOk: (v: boolean) => void;
  skipped: number;
  fromOrder: boolean;
}) {
  const digits = useDigits();
  return (
    <div className="sticky z-10 max-lg:bottom-3 max-lg:rounded-card max-lg:shadow-e3 lg:top-24">
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-ink max-lg:hidden">ملخص الفاتورة</h2>
        <dl className="flex flex-col gap-3 text-sm max-lg:hidden">
          <SummaryRow term="المورد">{supplier?.name ?? '—'}</SummaryRow>
          {supplier ? (
            <SummaryRow term="له عليك الآن">
              <Money minor={supplier.balanceMinor} currency={base} />
            </SummaryRow>
          ) : null}
          {supplier?.usdBalanceMinor ? (
            <SummaryRow term="منه بالدولار">
              <Money minor={supplier.usdBalanceMinor} currency="USD" />
            </SummaryRow>
          ) : null}
          {usd ? (
            <SummaryRow term="سعر الدولار">{rate ? <span className="num">{rate}</span> : '—'}</SummaryRow>
          ) : null}
          <SummaryRow term="الدفع">{PAYMENT_TEXT[payment]}</SummaryRow>
          {dueDate ? <SummaryRow term="تستحق في">{dayText(dueDate, digits)}</SummaryRow> : null}
          {adjusted ? (
            <SummaryRow term="مجموع الورقة">
              <Money minor={gross} currency={invoiceCurrency} />
            </SummaryRow>
          ) : null}
          {(discountN ?? 0) > 0 ? (
            <SummaryRow term="خصم المورد">
              −<Money minor={discountN ?? 0} currency={invoiceCurrency} />
            </SummaryRow>
          ) : null}
          {(chargesN ?? 0) > 0 ? (
            <SummaryRow term="رسوم إضافية">
              +<Money minor={chargesN ?? 0} currency={invoiceCurrency} />
            </SummaryRow>
          ) : null}
          <SummaryRow term="الأصناف">
            <span className="num">{usedCount}</span>
          </SummaryRow>
          <SummaryRow term="الكمية">
            <span className="num">{formatQuantity(pieces, digits)}</span>
          </SummaryRow>
        </dl>
        <div className="flex items-center justify-between gap-x-3 gap-y-1 rounded-control bg-surface-total px-4 py-3 lg:flex-col lg:items-start">
          <span className="text-sm font-semibold whitespace-nowrap text-ink-muted">مجموع الفاتورة</span>
          <Money
            minor={total}
            currency={invoiceCurrency}
            className="text-2xl font-bold text-ink"
            unitClassName="text-base font-semibold text-ink-subtle"
          />
          {usd ? (
            <span className="text-sm text-ink-muted">
              تدخل المخزون بـ <Money minor={totalBase} currency={base} className="font-semibold" />
            </span>
          ) : null}
        </div>
        <div className="flex gap-3 lg:flex-col">
          <Button
            type="submit"
            loading={saving}
            disabled={!ready}
            aria-describedby={notReadyWhy ? 'purchase-not-ready' : undefined}
            className="flex-1 lg:w-full"
          >
            سجّل الفاتورة
          </Button>
          <Button variant="ghost" onClick={onCancel} className="lg:w-full">
            إلغاء
          </Button>
        </div>
        {pastNames.length > 0 ? (
          <Switch
            label="تاريخ الانتهاء الماضي صحيح، سجّله"
            description={`${pastNames.join('، ')}: دفعة منتهية الصلاحية.`}
            checked={pastOk}
            onCheckedChange={onPastOk}
          />
        ) : null}
        {skipped > 0 && usedCount > 0 ? (
          <p role="status" className="text-sm text-ink-muted">
            {skipped === 1 ? 'سطر واحد بكمية صفر' : `${skipped} أسطر بكمية صفر`} لن يُسجَّل
            {fromOrder ? '، ويبقى على الطلبية' : ''}.
          </p>
        ) : null}
        {notReadyWhy ? (
          <p id="purchase-not-ready" aria-live="polite" className="text-sm font-semibold text-warning-ink">
            {notReadyWhy}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
