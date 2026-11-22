import type { PurchasePayment } from '@serva/core';

/** Round 62: one wording for how a supplier pays a return back, in the list, its cards, the choice and the dialog */
export const REFUND_NAME: Record<PurchasePayment, string> = {
  credit: 'تنقص من دينك له',
  cash: 'مبلغ نقدي مُستردّ',
  bank: 'تحويل بنكي مُستردّ',
};
