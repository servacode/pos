import type { PaymentMethod, SaleStatus } from '@serva/core';

export const SALE_STATUS_TEXT: Record<SaleStatus, string> = {
  paid: 'مكتملة',
  partly_returned: 'مرتجع جزئي',
  returned: 'مرتجعة',
};

/** How a payment method reads in the list (the receipt has its own wording per currency). */
export const METHOD_TEXT: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل',
  cheque: 'شيك',
  voucher: 'قسيمة',
  points: 'نقاط الولاء',
};
