import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { PurchaseDetail, PurchaseRow } from '@serva/core';
import { Alert, Button, Dialog, formatQuantity, Money, SkeletonText, TextLink, useDigits } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { getPurchase } from './api';

/**
 * One purchase invoice, read only (from the same record the labels page reads): each line with its
 * quantity, cost, batch, expiry and serial numbers, and the way to its labels.
 */
export function PurchaseDetailDialog({ purchase, onClose }: { purchase: PurchaseRow; onClose: () => void }) {
  const digits = useDigits();
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`الفاتورة ${purchase.number}`}
      description={`${purchase.supplierName} · ${purchase.date}`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            أغلق
          </Button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!detail && !error ? <SkeletonText lines={4} /> : null}
      {detail ? (
        <div className="flex flex-col gap-4">
          <ul aria-label="أصناف الفاتورة" className="flex flex-col divide-y divide-line">
            {detail.lines.map((l) => (
              <li key={l.lineNo} className="flex flex-col gap-1 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-semibold text-ink">{l.name}</span>
                  <Money minor={l.costMinor} currency={detail.baseCurrency} className="font-semibold" />
                </div>
                <p className="text-sm text-ink-muted">
                  الكمية <span className="num">{formatQuantity(l.qty, digits)}</span>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-total px-4 py-3">
            <span className="text-sm font-semibold text-ink-muted">مجموع الفاتورة</span>
            <Money minor={detail.totalMinor} currency={detail.baseCurrency} className="text-lg font-bold" />
          </div>
          {detail.notes ? <p className="text-sm text-ink-muted">{detail.notes}</p> : null}
          <TextLink as={Link} to={`/labels?purchase=${detail.id}`} className="self-start">
            اطبع ملصقات هذه الفاتورة
          </TextLink>
        </div>
      ) : null}
    </Dialog>
  );
}
