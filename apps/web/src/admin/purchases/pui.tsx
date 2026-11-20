import type { PurchaseOrderStatus, PurchasePayment, PurchaseRow } from '@serva/core';
import { PURCHASE_ORDER_STATUS_LABELS } from '@serva/core';
import { CashIcon, ChequeIcon, BookIcon, CheckIcon, UndoIcon } from '@serva/ui';
import { StatusPill } from '../sales/ui';
import './purchases.css';

/*
 * The small pieces the Purchases pages share (round 44): the payment and the order-status badges in the Sales
 * language (quiet when normal, filled with an icon when it is an exception) and the wording of what is owed.
 */

export const PAYMENT_TEXT: Record<PurchasePayment, string> = {
  credit: 'على حساب المورد',
  cash: 'نقداً من الخزنة',
  bank: 'من البنك',
};

/** How an invoice was paid: from the safe or the bank is settled (quiet); on the supplier's account is still owed (filled) */
export function PaymentPill({ payment }: { payment: PurchasePayment }) {
  if (payment === 'credit') {
    return (
      <StatusPill kind="open" icon={<BookIcon size={16} />}>
        {PAYMENT_TEXT.credit}
      </StatusPill>
    );
  }
  return (
    <StatusPill kind="ok" icon={payment === 'cash' ? <CashIcon size={16} /> : <ChequeIcon size={16} />}>
      {PAYMENT_TEXT[payment]}
    </StatusPill>
  );
}

/** «مصحَّحة»: an invoice turned back by a correction document (filled: it no longer counts) */
export function CorrectedPill() {
  return (
    <StatusPill kind="warn" icon={<UndoIcon size={16} />}>
      مصحَّحة
    </StatusPill>
  );
}

export function InvoiceStatus({ row }: { row: Pick<PurchaseRow, 'payment' | 'correctedBy'> }) {
  return row.correctedBy ? <CorrectedPill /> : <PaymentPill payment={row.payment} />;
}

/** An order's state: «مستلمة» quietly with a check, the ones that still wait or went wrong filled */
export function OrderPill({
  status,
  short = false,
}: {
  status: PurchaseOrderStatus;
  /** Closed with less than was ordered: said so, so it is not read as complete */
  short?: boolean;
}) {
  const text = PURCHASE_ORDER_STATUS_LABELS[status];
  if (status === 'received') {
    return short ? (
      <StatusPill kind="warn">أُغلقت ناقصة</StatusPill>
    ) : (
      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
        {text}
      </StatusPill>
    );
  }
  if (status === 'cancelled') return <StatusPill kind="danger">{text}</StatusPill>;
  if (status === 'partial') return <StatusPill kind="warn">{text}</StatusPill>;
  if (status === 'sent') return <StatusPill kind="open">{text}</StatusPill>;
  return <StatusPill kind="ok">{text}</StatusPill>;
}

/** The one phrase for the debt to a supplier on every page: «المستحق للمورد» */
export const OWED = 'المستحق للمورد';
