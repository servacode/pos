import { useEffect, useState } from 'react';
import { dayText } from '../../lib/dates';
import { Link } from 'react-router';
import type { PurchaseCorrection, PurchaseDetail, PurchaseDraft, PurchaseRow } from '@serva/core';
import { Alert, Button, Dialog, formatQuantity, Money, SkeletonText, TextLink, useDigits } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { correctPurchase, getPurchase } from './api';
import { draftOfDetail } from './correctionDraft';
import { PAYMENT_TEXT } from './pui';
import { DueEditor } from './DueEditor';
import { PurchasePhotos } from './PurchasePhotos';
import { useQuietFocus } from './quietFocus';

/**
 * One purchase invoice (from the same record the labels page reads): each line with its quantity,
 * cost, batch, expiry and serial numbers, and the way to its labels. «صحّح الفاتورة» (round 36,
 * decision 12) turns it back with a reversal document and hands over a copy to fix and save; it is
 * refused, with a way to a return to the supplier, when part of the goods was sold.
 */
/** What the supplier's paper adds up to: the net the books took, with the discount back and the charges off (invoice currency) */
const paper = (d: PurchaseDetail, dollars: boolean) =>
  (dollars && typeof d.foreignTotalMinor === 'number' ? d.foreignTotalMinor : d.totalMinor) +
  (d.discountMinor ?? 0) -
  (d.chargesMinor ?? 0);

export function PurchaseDetailDialog({
  purchase,
  onClose,
  onCorrected,
  onRewrite,
}: {
  purchase: PurchaseRow;
  onClose: () => void;
  /** The invoice was turned back: the page opens its draft */
  onCorrected?: (correction: PurchaseCorrection) => void;
  /** A corrected invoice written again: the page opens a new invoice with its lines (round 44) */
  onRewrite?: (draft: PurchaseDraft, reversalNumber: string) => void;
}) {
  const digits = useDigits();
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const quiet = useQuietFocus<HTMLDivElement>();

  useEffect(() => {
    let alive = true;
    getPurchase(purchase.id).then(
      (d) => alive && setDetail(d),
      (e: unknown) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [purchase.id]);

  async function correct() {
    setWorking(true);
    setRefused(null);
    try {
      const done = await correctPurchase(purchase.id, {});
      onCorrected?.(done);
    } catch (e) {
      // A 409 is the answer «لا»: part of the goods is gone. It is said as it is, with the way out.
      if (e instanceof ApiError && e.status === 409) setRefused(errorMessage(e));
      else setError(errorMessage(e));
      setAsking(false);
    } finally {
      setWorking(false);
    }
  }

  const dollars = detail?.currency === 'USD';
  const correctable = detail && !detail.correctedBy && onCorrected;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`الفاتورة ${purchase.number}`}
      description={`${purchase.supplierName} · ${dayText(purchase.date)}`}
      actions={
        <>
          {detail?.correctedBy && onRewrite ? (
            <Button onClick={() => onRewrite(draftOfDetail(detail), detail.correctedBy!.number)}>
              أعد كتابتها
            </Button>
          ) : null}
          {correctable && !asking ? (
            <Button variant="secondary" onClick={() => setAsking(true)}>
              صحّح الفاتورة
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            أغلق
          </Button>
        </>
      }
    >
      <div ref={quiet} tabIndex={-1} className="outline-hidden" />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {refused ? (
        <Alert tone="warning" title="لا يمكن تصحيح هذه الفاتورة">
          <p>{refused}</p>
          <TextLink as={Link} to="/supplier-returns" className="mt-2 inline-block">
            افتح مرتجعات الموردين
          </TextLink>
        </Alert>
      ) : null}
      {!detail && !error ? <SkeletonText lines={4} /> : null}
      {detail ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            {PAYMENT_TEXT[detail.payment]}
            {detail.reference ? (
              <>
                {' · '}رقمها عند المورد{' '}
                <bdi dir="ltr" className="num">
                  {detail.reference}
                </bdi>
              </>
            ) : null}
          </p>
          {detail.payment === 'credit' && !detail.correctedBy ? (
            <DueEditor
              purchaseId={detail.id}
              dueDate={detail.dueDate ?? null}
              minDate={detail.date}
              onChanged={(dueDate) => setDetail((d) => (d ? { ...d, dueDate } : d))}
            />
          ) : detail.dueDate ? (
            <p className="text-sm text-ink-muted">تستحق في {dayText(detail.dueDate, digits)}</p>
          ) : null}
          {detail.correctedBy ? (
            <Alert tone="info">
              صُحّحت هذه الفاتورة بالمستند{' '}
              <bdi dir="ltr" className="num font-semibold">
                {detail.correctedBy.number}
              </bdi>{' '}
              بتاريخ {dayText(detail.correctedBy.date)}. أثرها على المخزون وعلى حساب المورد انتهى. إن أردت
              فاكتبها من جديد بالقيم الصحيحة.
            </Alert>
          ) : null}
          {asking ? (
            <Alert tone="warning" title="تصحيح الفاتورة">
              <p>
                نُخرج بضاعة الفاتورة من المخزون بكلفتها، ونُرجع للمورد ما سُجّل له، ثم تفتح لك نسخة من
                الفاتورة لتعدّلها وتحفظها. لا يُمحى شيء من الدفاتر: يبقى الأصل والتصحيح معاً.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button loading={working} onClick={() => void correct()}>
                  نعم، صحّح
                </Button>
                <Button variant="ghost" disabled={working} onClick={() => setAsking(false)}>
                  لا
                </Button>
              </div>
            </Alert>
          ) : null}
          <ul aria-label="أصناف الفاتورة" className="flex flex-col divide-y divide-line">
            {detail.lines.map((l) => (
              <li key={l.lineNo} className="flex flex-col gap-1 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-semibold text-ink">{l.name}</span>
                  <span className="flex flex-col items-end">
                    {dollars && typeof l.foreignCostMinor === 'number' ? (
                      <Money minor={l.foreignCostMinor} currency="USD" className="font-semibold" />
                    ) : null}
                    <Money
                      minor={l.costMinor}
                      currency={detail.baseCurrency}
                      className={dollars ? 'text-sm text-ink-muted' : 'font-semibold'}
                    />
                  </span>
                </div>
                <p className="text-sm text-ink-muted">
                  الكمية <span className="num">{formatQuantity(l.qty, digits)}</span>
                  {l.qty > 0 ? (
                    <>
                      {' · '}كلفة الوحدة{' '}
                      <Money
                        minor={Math.round(
                          ((dollars && typeof l.foreignCostMinor === 'number'
                            ? l.foreignCostMinor
                            : l.costMinor) *
                            1000) /
                            l.qty,
                        )}
                        currency={dollars ? 'USD' : detail.baseCurrency}
                      />
                    </>
                  ) : null}
                  {l.batchNo ? (
                    <>
                      {' · '}دفعة{' '}
                      <bdi dir="ltr" className="num">
                        {l.batchNo}
                      </bdi>
                    </>
                  ) : null}
                  {l.expiryDate ? (
                    <>
                      {' · '}تنتهي <span className="num">{l.expiryDate}</span>
                    </>
                  ) : null}
                </p>
                {l.serials.length > 0 ? (
                  <p className="text-xs text-ink-subtle">
                    أرقام تسلسلية:{' '}
                    <bdi dir="ltr" className="num">
                      {l.serials.join('، ')}
                    </bdi>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {detail.discountMinor || detail.chargesMinor ? (
            <dl className="flex flex-col gap-1 text-sm text-ink-muted" aria-label="خصم الفاتورة ورسومها">
              <div className="flex justify-between gap-3">
                <dt>مجموع الورقة</dt>
                <dd>
                  <Money
                    minor={paper(detail, dollars)}
                    currency={dollars ? 'USD' : detail.baseCurrency}
                    className="font-semibold"
                  />
                </dd>
              </div>
              {detail.discountMinor ? (
                <div className="flex justify-between gap-3">
                  <dt>خصم المورد</dt>
                  <dd>
                    −
                    <Money
                      minor={detail.discountMinor}
                      currency={dollars ? 'USD' : detail.baseCurrency}
                      className="font-semibold"
                    />
                  </dd>
                </div>
              ) : null}
              {detail.chargesMinor ? (
                <div className="flex justify-between gap-3">
                  <dt>رسوم إضافية (شحن…)</dt>
                  <dd>
                    +
                    <Money
                      minor={detail.chargesMinor}
                      currency={dollars ? 'USD' : detail.baseCurrency}
                      className="font-semibold"
                    />
                  </dd>
                </div>
              ) : null}
              <p className="text-xs text-ink-subtle">الخصم والرسوم موزّعة على كلفة الأصناف أعلاه.</p>
            </dl>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-total px-4 py-3">
            <span className="text-sm font-semibold text-ink-muted">مجموع الفاتورة</span>
            <span className="flex flex-col items-end">
              {dollars && typeof detail.foreignTotalMinor === 'number' ? (
                <Money minor={detail.foreignTotalMinor} currency="USD" className="text-lg font-bold" />
              ) : null}
              <Money
                minor={detail.totalMinor}
                currency={detail.baseCurrency}
                className={dollars ? 'text-sm text-ink-muted' : 'text-lg font-bold'}
              />
            </span>
          </div>
          {dollars && detail.rate ? (
            <p className="text-sm text-ink-muted">
              بالدولار على سعر <span className="num">{detail.rate}</span> ليرة للدولار.
            </p>
          ) : null}
          {detail.notes ? <p className="text-sm text-ink-muted">{detail.notes}</p> : null}
          <PurchasePhotos
            purchaseId={detail.id}
            photos={detail.attachments ?? []}
            onChange={(attachments) => setDetail((d) => (d ? { ...d, attachments } : d))}
          />
          <TextLink as={Link} to={`/labels?purchase=${detail.id}`} className="self-start">
            اطبع ملصقات هذه الفاتورة
          </TextLink>
        </div>
      ) : null}
    </Dialog>
  );
}
