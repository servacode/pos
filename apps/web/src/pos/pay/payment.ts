import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { convert } from '@serva/core/money';
import type { TradeRate } from '@serva/core/contracts/common';
import type { PaymentMethod } from '@serva/core/contracts/documents';
import { rateFor, type SaleTender } from '@serva/core/sale';

/**
 * The payment panel's choices (27 › الدفع عند الكاشير; contract step 4): cash in the base currency
 * and in each enabled foreign currency with a rate, a wallet (Sham Cash), a card and a transfer,
 * the last three with their reference. Credit waits for customers on the device (contract Q2).
 */
export interface PayOption {
  key: string;
  method: PaymentMethod;
  currency: CurrencyCode;
  label: string;
  /** The rate a foreign cash payment is taken at */
  rate: TradeRate | null;
}

export function payOptions(
  base: CurrencyCode,
  enabled: readonly CurrencyCode[],
  rates: readonly TradeRate[],
  collectRates: Partial<Record<CurrencyCode, TradeRate>>,
): PayOption[] {
  const cashLabel = (c: CurrencyCode) =>
    c === 'SYP'
      ? 'نقد بالليرة'
      : c === 'USD'
        ? 'نقد بالدولار'
        : `نقد ${(CURRENCIES[c] as { nameAr: string }).nameAr}`;
  const options: PayOption[] = [
    { key: `cash:${base}`, method: 'cash', currency: base, label: cashLabel(base), rate: null },
  ];
  for (const currency of enabled) {
    if (currency === base) continue;
    const rate = collectRates[currency] ?? rates.find((r) => r.unit === currency || r.quote === currency);
    if (!rate) continue;
    options.push({ key: `cash:${currency}`, method: 'cash', currency, label: cashLabel(currency), rate });
  }
  options.push(
    { key: 'wallet', method: 'wallet', currency: base, label: 'شام كاش', rate: null },
    { key: 'card', method: 'card', currency: base, label: 'بطاقة', rate: null },
    { key: 'transfer', method: 'transfer', currency: base, label: 'تحويل', rate: null },
  );
  return options;
}

export const REFERENCE_LABEL: Partial<Record<PaymentMethod, string>> = {
  wallet: 'رقم العملية',
  card: 'رقم الموافقة من جهاز الدفع',
  transfer: 'رقم الحوالة أو التحويل',
};

/** A rate's value of one foreign unit in the base currency, for «سعر 130». */
export function rateValue(rate: TradeRate): string {
  return rate.rate;
}

/** Major units typed («1,500» or «12.5») to minor units of the currency; null while unusable. */
export function parseAmount(text: string, currency: CurrencyCode): number | null {
  if (!/^\d+(\.\d*)?$/.test(text)) return null;
  const { decimals } = CURRENCIES[currency];
  const [whole = '0', frac = ''] = text.split('.');
  if (frac.length > decimals) return null;
  const minor = Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units back to what the field shows (no grouping): 150000 SYP → «1500». */
export function amountText(minor: number, currency: CurrencyCode): string {
  const { decimals } = CURRENCIES[currency];
  const whole = Math.trunc(minor / 10 ** decimals);
  const frac = minor % 10 ** decimals;
  // Fractions show only when there are some: a pound amount is «1500», a cent amount «9.5».
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(decimals, '0').replace(/0+$/, '')}`;
}

/**
 * Quick notes for a cash due (kit cashier/Payment: «المبلغ تماماً», then the next round amounts),
 * in minor units of the currency: for pounds 1,250 → 1,250 · 1,300 · 1,500 · 2,000 · 2,500 · 5,000.
 */
export function quickAmounts(dueMinor: number, currency: CurrencyCode): number[] {
  const unit = 10 ** CURRENCIES[currency].decimals;
  const steps = currency === 'USD' ? [1, 5, 10, 20, 50, 100] : [100, 500, 1000, 2500, 5000, 10000];
  const out = [dueMinor];
  for (const step of steps) {
    const value = Math.ceil(dueMinor / (step * unit)) * step * unit;
    if (value > 0 && !out.includes(value)) out.push(value);
  }
  return out.filter((v) => v > 0).slice(0, 6);
}

/** The due amount in a foreign currency for the quick notes (rounded up to its minor unit). */
export function dueIn(
  currency: CurrencyCode,
  base: CurrencyCode,
  dueMinor: number,
  rates: readonly TradeRate[],
): number {
  if (currency === base) return dueMinor;
  return convert(dueMinor, base, currency, rateFor(rates, currency, base));
}

export function tenderOf(option: PayOption, amountMinor: number, reference: string): SaleTender {
  return {
    method: option.method,
    currency: option.currency,
    amountMinor,
    rate: option.rate,
    reference: option.method === 'cash' ? null : reference.trim() || null,
  };
}

/** Notes to hand back for the change (PaymentDone: «أعطه: 200 · 100 · 10»), largest first. */
export function changeNotes(minor: number, notes: readonly number[]): number[] {
  const out: number[] = [];
  let left = minor;
  for (const note of notes) {
    while (left >= note && out.length < 12) {
      out.push(note);
      left -= note;
    }
  }
  return left === 0 ? out : [];
}
