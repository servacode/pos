import type { CurrencyCode } from '@serva/core/currencies';
import type { VoucherRow } from '@serva/core/contracts/catalog';
import type { GiftVoucherPayload, ReturnPayload, SalePayload } from '@serva/core/contracts/documents';
import type { OutboxEntry } from '@serva/sync';

/** An exchange voucher as this till sees it, with what is left on it. */
export interface TillVoucher {
  code: string;
  currency: CurrencyCode;
  amountMinor: number;
  balanceMinor: number;
}

/** A typed or scanned code as stored: Latin digits, capitals, no spaces. */
export function voucherKey(text: string): string {
  let out = '';
  for (const c of text.trim()) {
    const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(c);
    if (arabic >= 0) out += String(arabic);
    else if (c.trim() !== '') out += c.toUpperCase();
  }
  return out;
}

/**
 * The vouchers this till knows (03 › الملابس: قسيمة الاستبدال): the store's, as last pulled, and
 * the ones this till issued that the server has not sent back yet. What was spent is the larger of
 * the server's count and this till's own sales: the server's includes this till's synced sales,
 * this till's includes the ones not sent yet, so taking the larger never counts one twice.
 */
export function tillVouchers(
  rows: readonly VoucherRow[],
  entries: readonly OutboxEntry[],
): Map<string, TillVoucher> {
  const issued = new Map<string, { currency: CurrencyCode; amountMinor: number; redeemedMinor: number }>();
  for (const row of rows) {
    issued.set(row.code, {
      currency: row.currency,
      amountMinor: row.amountMinor,
      redeemedMinor: row.redeemedMinor,
    });
  }
  const spentHere = new Map<string, number>();
  for (const entry of entries) {
    const { doc } = entry;
    if (doc.type === 'return' && doc.number && !issued.has(doc.number)) {
      const ret = doc.payload as unknown as ReturnPayload;
      const amountMinor = (ret.refunds ?? [])
        .filter((r) => r.method === 'voucher')
        .reduce((sum, r) => sum + r.amountMinor, 0);
      if (amountMinor > 0) issued.set(doc.number, { currency: ret.currency, amountMinor, redeemedMinor: 0 });
    } else if (doc.type === 'gift_voucher' && doc.number && !issued.has(doc.number)) {
      const g = doc.payload as unknown as GiftVoucherPayload;
      issued.set(doc.number, { currency: g.currency, amountMinor: g.amountMinor, redeemedMinor: 0 });
    } else if (doc.type === 'sale') {
      for (const p of (doc.payload as unknown as SalePayload).payments ?? []) {
        if (p.method !== 'voucher' || !p.reference) continue;
        spentHere.set(p.reference, (spentHere.get(p.reference) ?? 0) + p.baseAmountMinor);
      }
    }
  }
  const out = new Map<string, TillVoucher>();
  for (const [code, v] of issued) {
    const spent = Math.max(v.redeemedMinor, spentHere.get(code) ?? 0);
    out.set(code, {
      code,
      currency: v.currency,
      amountMinor: v.amountMinor,
      balanceMinor: Math.max(0, v.amountMinor - spent),
    });
  }
  return out;
}

/**
 * The voucher a cashier means: the exact code, scanned from the slip, or else the one voucher whose
 * number ends with the digits typed («154» for SRT-001-002-0000154). Null when none or several match.
 */
export function findVoucher(vouchers: ReadonlyMap<string, TillVoucher>, typed: string): TillVoucher | null {
  const key = voucherKey(typed);
  if (!key) return null;
  const exact = vouchers.get(key);
  if (exact) return exact;
  let digits = '';
  for (const c of key) if (c >= '0' && c <= '9') digits += c;
  if (digits !== key) return null;
  const hits = [...vouchers.values()].filter((v) => {
    let own = '';
    for (const c of v.code) if (c >= '0' && c <= '9') own += c;
    // The sequence is the last seven digits; more digits typed name the device too
    return digits.length > 7 ? own.endsWith(digits) : Number(own.slice(-7)) === Number(digits);
  });
  return hits.length === 1 ? hits[0]! : null;
}
