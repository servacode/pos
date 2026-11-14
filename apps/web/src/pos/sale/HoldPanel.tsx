import { useState } from 'react';
import type { CurrencyCode } from '@serva/core';
import type { GiftVoucherPayload } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import { Alert, Button, CalendarIcon, CloseIcon, Money, TextField } from '@serva/ui';
import type { SavedGiftVoucher } from '../customers/GiftVoucherScreen';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import type { Cart } from './cart';
import { postHold, type HoldAnswer } from './onlineOrders';
import { SalePanel } from './SalePanel';

/**
 * «احجز» (03 › الألبسة: الحجز بعربون): the cart held for a customer who pays a deposit now and the
 * rest at pickup. The deposit is sold first as a voucher in cash (GFT, into this drawer, owed in
 * 2310), so it is never lost even if the hold cannot be sent; the hold then goes to the server with
 * the voucher's code, its pieces held and the order waiting on the tills under «طلبات المتجر».
 * Holding needs the server; the deposit does not.
 */
export function HoldPanel({
  cart,
  totalMinor,
  currency,
  shiftId,
  cashierId,
  timezone,
  cutoff,
  onDone,
  onPrintDeposit,
  onClose,
}: {
  cart: Cart;
  totalMinor: number;
  currency: CurrencyCode;
  shiftId: string;
  cashierId: string;
  timezone: string;
  cutoff: string;
  onDone: (hold: { number: string; depositCode: string | null }) => void;
  onPrintDeposit?: (saved: SavedGiftVoucher) => void;
  onClose: () => void;
}) {
  const pos = usePos();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [deposit, setDeposit] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A deposit already taken, kept for a retry so it is never taken twice
  const [paid, setPaid] = useState<SavedGiftVoucher | null>(null);

  const depositMinor = deposit.trim() ? parseAmount(deposit, currency) : 0;
  const pieces = cart.lines.filter((l) => !l.weighed && l.qty % 1000 === 0 && l.qty <= 50_000);
  const ready =
    name.trim().length > 0 &&
    phone.trim().length > 0 &&
    depositMinor !== null &&
    depositMinor <= totalMinor &&
    pieces.length === cart.lines.length;

  async function hold() {
    if (!ready) return;
    const token = pos.device.token;
    if (!pos.online() || !token) {
      setError('الحجز يحتاج اتصالاً بالخادم. جرّب بعد عودة الاتصال، أو علّق الفاتورة.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let voucher = paid;
      if (!voucher && depositMinor! > 0) {
        const payload: GiftVoucherPayload = {
          shiftId,
          cashierId,
          currency,
          amountMinor: depositMinor!,
          method: 'cash',
          reference: null,
          forName: `عربون حجز: ${name.trim()}`.slice(0, 80),
        };
        const entry = await pos.save({
          type: 'gift_voucher',
          payload: payload as unknown as Record<string, unknown>,
          businessDate: businessDateOf(pos.now(), timezone, cutoff),
          engineVersion: PRICING_ENGINE_VERSION,
        });
        voucher = {
          id: entry.doc.id,
          number: entry.doc.number,
          deviceTime: entry.doc.deviceTime,
          payload: entry.doc.payload,
        };
        setPaid(voucher);
        onPrintDeposit?.(voucher);
      }
      const answer: HoldAnswer = await postHold(
        {
          customerName: name.trim(),
          phone: phone.trim(),
          note: note.trim() || null,
          depositCode: voucher?.number ?? null,
          lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty / 1000 })),
        },
        token,
        pos.fetch,
      );
      if (answer.kind === 'ok') {
        onDone({ number: answer.body.number, depositCode: voucher?.number ?? null });
        return;
      }
      setError(
        answer.kind === 'refused'
          ? answer.message
          : voucher
            ? `سُجّل العربون بالقسيمة ${voucher.number} ولم يصل الحجز إلى الخادم. أعد المحاولة.`
            : 'لم يصل الحجز إلى الخادم. أعد المحاولة.',
      );
    } catch {
      setError('لم يُسجَّل العربون. لم يُحفظ شيء، حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalePanel
      label="احجز للزبون"
      title="احجز للزبون"
      icon={<CalendarIcon size={20} />}
      actions={
        <Button
          variant="secondary"
          size="md"
          icon={<CloseIcon size={20} />}
          onClick={onClose}
          disabled={saving}
        >
          أغلق
        </Button>
      }
      footer={
        <Button
          size="lg"
          icon={<CalendarIcon size={20} />}
          loading={saving}
          disabled={!ready}
          onClick={() => void hold()}
        >
          {paid ? 'أعد إرسال الحجز' : 'احجز'}
        </Button>
      }
    >
      <p className="text-ink-muted">
        تُحجز قطع الفاتورة (<Money minor={totalMinor} currency={currency} />) باسم الزبون، ويدفع العربون الآن
        نقداً والباقي عند الاستلام. يظهر الحجز في «طلبات المتجر» على كل كاشير.
      </p>
      {pieces.length !== cart.lines.length ? (
        <Alert tone="info">الحجز للقطع فقط: احذف الأصناف الموزونة أو الكسور من الفاتورة.</Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="اسم الزبون" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} />
        <TextField
          label="جوال الزبون"
          dir="ltr"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.slice(0, 20))}
        />
        <TextField
          label="العربون نقداً (اختياري)"
          dir="ltr"
          inputMode="decimal"
          value={deposit}
          disabled={paid !== null}
          onChange={(e) => setDeposit(e.target.value.slice(0, 14))}
          error={
            depositMinor === null
              ? 'مبلغ غير صحيح'
              : depositMinor > totalMinor
                ? 'العربون أكبر من الفاتورة'
                : undefined
          }
        />
        <TextField
          label="ملاحظة (اختياري)"
          placeholder="يمرّ يوم الخميس"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
        />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </SalePanel>
  );
}
