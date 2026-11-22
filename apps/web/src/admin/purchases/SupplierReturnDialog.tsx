import { useEffect, useState } from 'react';
import type { PurchaseDetail, StoreResponse, SupplierReturnDetail, SupplierReturnRow } from '@serva/core';
import { Alert, Button, Dialog, formatQuantity, Money, PrintIcon, SkeletonText, useDigits } from '@serva/ui';
import { apiFetch, errorMessage } from '../../lib/api';
import { getPurchase } from './api';
import { PurchaseDetailDialog } from './PurchaseDetailDialog';
import { REFUND_NAME } from './refundWording';
import { useQuietFocus } from './quietFocus';
import { dayText } from '../../lib/dates';
import { SupplierReturnA4 } from '../../lib/a4/documents';
import { PrintSheet, usePrint } from '../../lib/print';
import { getStore } from '../store/api';

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
  // Round 62: the invoice the return was against opens right here (not a search of the invoices list)
  const [invoice, setInvoice] = useState<PurchaseDetail | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const quiet = useQuietFocus<HTMLDivElement>();
  function openInvoice(id: string) {
    setInvoiceError(null);
    getPurchase(id).then(setInvoice, (e: unknown) => setInvoiceError(errorMessage(e)));
  }

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

  // The invoice's own window replaces this one (no dialog over a dialog); closing it comes back here
  if (invoice) {
    return <PurchaseDetailDialog purchase={invoice} onClose={() => setInvoice(null)} />;
  }
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
        <div ref={quiet} tabIndex={-1} className="outline-hidden" />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {invoiceError ? <Alert tone="error">{invoiceError}</Alert> : null}
        {!detail && !error ? <SkeletonText lines={4} /> : null}
        {detail ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">
              {REFUND_NAME[detail.refund]}
              {detail.branchName ? (
                <>
                  {' · '}من فرع {detail.branchName}
                </>
              ) : null}
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
                <button
                  type="button"
                  className="font-semibold text-brand-ink underline-offset-2 hover:underline"
                  onClick={() => openInvoice(detail.purchaseId!)}
                >
                  <bdi dir="ltr" className="num">
                    {detail.purchaseNumber}
                  </bdi>
                </button>
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
                  {l.serials && l.serials.length > 0 ? (
                    <p className="text-sm text-ink-muted">
                      الأرقام التسلسلية:{' '}
                      <bdi dir="ltr" className="num">
                        {l.serials.join('، ')}
                      </bdi>
                    </p>
                  ) : null}
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
              branchName: detail.branchName ?? null,
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
