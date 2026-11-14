import { useEffect } from 'react';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { CustomerRow } from '@serva/core/contracts/customers';
import { DeliveryNoteA4, InvoiceA4, type A4SaleData } from '../../lib/a4/documents';
import { PrintSheet } from '../../lib/print';
import type { ReceiptData } from './Receipt';

export type A4Kind = 'invoice' | 'delivery' | 'delivery-prices';

/**
 * What the A4 documents read from the till's own receipt data. The till does not hold a customer's
 * tax number or address (only name and phone), so those lines print blank to write by hand; the
 * admin's invoice page prints them from the customer card.
 */
export function a4DataOfReceipt(
  data: ReceiptData,
  customers: readonly Pick<CustomerRow, 'id' | 'phone'>[],
): A4SaleData {
  const payload = data.doc.payload as unknown as SalePayload;
  const card = payload.customerId ? customers.find((c) => c.id === payload.customerId) : undefined;
  return {
    store: {
      name: data.settings.storeName || data.storeName,
      taxNumber: data.settings.taxNumber ?? null,
      branchName: data.branchName,
      address: data.branch?.address ?? null,
      phone: data.branch?.phone ?? null,
      footer: data.settings.receiptFooter ?? null,
    },
    number: data.doc.number ?? '',
    deviceTime: data.doc.deviceTime,
    timezone: data.settings.timezone,
    customer: payload.customerName ? { name: payload.customerName, phone: card?.phone ?? null } : null,
    payload,
    cashierName: data.cashierName,
  };
}

/** Mounts the A4 sheet and opens the print dialog once it is in the page; `onDone` follows the dialog. */
export function A4Print({
  data,
  kind,
  customers,
  onDone,
}: {
  data: ReceiptData;
  kind: A4Kind;
  customers: readonly Pick<CustomerRow, 'id' | 'phone'>[];
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.print();
      } catch {
        // No print dialog in this environment: nothing else to do.
      }
      onDone();
    }, 0);
    return () => clearTimeout(timer);
    // Once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a4 = a4DataOfReceipt(data, customers);
  return (
    <PrintSheet paper="A4">
      {kind === 'invoice' ? (
        <InvoiceA4 data={a4} />
      ) : (
        <DeliveryNoteA4 data={a4} withPrices={kind === 'delivery-prices'} />
      )}
    </PrintSheet>
  );
}
