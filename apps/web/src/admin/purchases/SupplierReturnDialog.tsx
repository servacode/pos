import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { StoreResponse, SupplierReturnDetail, SupplierReturnRow } from '@serva/core';
import {
  Alert,
  Button,
  Dialog,
  formatQuantity,
  Money,
  PrintIcon,
  SkeletonText,
  TextLink,
  useDigits,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { SupplierReturnA4 } from '../../lib/a4/documents';
import { PrintSheet, usePrint } from '../../lib/print';
import { getStore } from '../store/api';

const REFUND_TEXT: Record<SupplierReturnRow['refund'], string> = {
  credit: 'تنقص من دينك للمورد',
  cash: 'مبلغ نقدي مُستردّ',
  bank: 'تحويل بنكي مُستردّ',
};

/**
 * One return to a supplier, in full: its pieces, what the supplier credits for each, the invoice it
 * was against and how it was paid back; with the A4 print the supplier signs (round 60).
 */
export function SupplierReturnDialog({ row, onClose }: { row: SupplierReturnRow; onClose: () => void }) {
  const digits = useDigits();
  const { paper, print } = usePrint();
  const [detail, setDetail] = useState<SupplierReturnDetail | null>(null);
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<SupplierReturnDetail>(`/v1/supplier-returns/${row.id}`, { auth: true }).then(
      (d) => alive && setDetail(d),
      (e: unknown) => alive && setError(errorMessage(e)),
    );
    void getStore().then(
      (s) => alive && setStore(s),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [row.id]);

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={`المرتجع ${row.number}`}
        description={`${row.supplierName} · ${dayText(row.date, digits)}`}
        actions={
          <>
            {detail && store ? (
              <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('A4')}>
                اطبع A4
              </Button>
            ) : null}
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
            <p className="text-sm text-ink-muted">
              {REFUND_TEXT[detail.refund]}
              {detail.reference ? (
                <>
                  {' · '}إشعار المورد{' '}
                  <bdi dir="ltr" className="num">
                    {detail.reference}
                  </bdi>
                </>
              ) : null}
            </p>
            {detail.purchaseId && detail.purchaseNumber ? (
              <p className="text-sm text-ink-muted">
                بسعر الفاتورة{' '}
                <TextLink as={Link} to={`/purchases?q=${encodeURIComponent(detail.purchaseNumber)}`}>
                  <bdi dir="ltr" className="num">
                    {detail.purchaseNumber}
                  </bdi>
                </TextLink>
              </p>
            ) : null}
            <ul aria-label="أصناف المرتجع" className="flex flex-col divide-y divide-line">
              {detail.lines.map((l, i) => (
                <li key={`${l.variantId}-${i}`} className="flex flex-col gap-1 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-semibold text-ink">{l.name}</span>
                    <Money minor={l.amountMinor} currency={detail.baseCurrency} className="font-semibold" />
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
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-total px-4 py-3">
              <span className="text-sm font-semibold text-ink-muted">ما يعتمده المورد</span>
              <Money
                minor={detail.amountMinor}
                currency={detail.baseCurrency}
                className="text-lg font-bold"
              />
            </div>
          </div>
        ) : null}
      </Dialog>
      {paper === 'A4' && detail && store ? (
        <PrintSheet paper="A4">
          <SupplierReturnA4
            back={detail}
            store={{
              name: store.name,
              taxNumber: store.taxNumber,
              branchName: null,
              address: store.address,
              phone: store.phone,
              footer: null,
            }}
          />
        </PrintSheet>
      ) : null}
    </>
  );
}
