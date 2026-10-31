import type { CashMovementKind, CurrencyCode, PaymentMethod } from '@serva/core';
import type { AccountType, JournalSourceType } from './contracts';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل',
};

/** «نقداً · ليرة», «نقداً · دولار», «بطاقة» (print/ShiftReport › المبيعات حسب الطريقة والعملة). */
export function methodLabel(method: PaymentMethod, currency: CurrencyCode, base: CurrencyCode): string {
  if (method !== 'cash') return METHOD_LABEL[method];
  if (currency === base && currency === 'SYP') return 'نقداً · ليرة';
  return `نقداً · ${currencyName(currency)}`;
}

export function currencyName(currency: CurrencyCode): string {
  if (currency === 'SYP') return 'ليرة';
  if (currency === 'USD') return 'دولار';
  return currency;
}

/** The words the cashier sees for each drawer movement (pos/shift › KIND_TEXT). */
export const MOVEMENT_LABEL: Record<CashMovementKind, string> = {
  pay_in: 'إيداع في الدرج',
  pay_out: 'سحب من الدرج',
  expense: 'مصروف من الدرج',
  safe_drop: 'إيداع للخزنة',
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'الأصول',
  liability: 'الخصوم',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expense: 'المصروفات',
};

/** The side an account's balance normally sits on (10 › دليل الحسابات). */
export function normalSide(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

const SOURCE_LABEL: Record<string, string> = {
  sale: 'فاتورة بيع',
  shift_close: 'إغلاق وردية',
  cash_movement: 'حركة درج',
  manual: 'قيد يدوي',
  return: 'مرتجع',
};

export function sourceLabel(type: JournalSourceType): string {
  return SOURCE_LABEL[type] ?? 'مستند';
}

/** The series a device numbers its documents in (08 › الترقيم; @serva/sync DOC_SERIES). */
const SERIES_LABEL: Record<string, string> = {
  INV: 'الفواتير',
  SRT: 'المرتجعات',
  QUO: 'عروض الأسعار',
  RCV: 'سندات القبض',
  CSH: 'حركات الدرج',
  SFT: 'الورديات',
  OWN: 'حركات المالك',
  FXE: 'تصريف العملات',
  PUR: 'الاستلام السريع',
  TRI: 'الاستبدال',
};

export function seriesLabel(series: string): string {
  return SERIES_LABEL[series] ?? series;
}
