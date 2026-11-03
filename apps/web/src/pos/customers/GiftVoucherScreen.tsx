import { useState } from 'react';
import { GIFT_VOUCHER_METHODS, type GiftVoucherPayload } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import type { SyncDocument } from '@serva/sync';
import { BackIcon, Button, cn, Money, PrintIcon, TextField } from '@serva/ui';
import type { Catalog } from '../catalog';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import type { OpenShift } from '../shift/shift';
import type { StaffSession } from '../staff/staff';

type Method = GiftVoucherPayload['method'];
const METHOD_TEXT: Record<Method, string> = {
  cash: 'نقداً',
  wallet: 'شام كاش',
  card: 'بطاقة',
  transfer: 'تحويل',
};

export type SavedGiftVoucher = Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;

/**
 * «قسيمة هدية» (03 › الألبسة): a customer buys a voucher for an amount, to give. The till saves it
 * (GFT); its number is its code, printed with its barcode, and it is spent at payment like an
 * exchange voucher, all at once or in parts, on any till of the store. Cash goes into this drawer.
 */
export function GiftVoucherScreen({
  session,
  catalog,
  shift,
  onBack,
  onPrint,
}: {
  session: StaffSession;
  catalog: Catalog;
  shift: OpenShift;
  onBack: () => void;
  onPrint: (saved: SavedGiftVoucher) => void;
}) {
  const pos = usePos();
  const settings = catalog.settings!;
  const base = settings.baseCurrency;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [forName, setForName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedGiftVoucher | null>(null);

  const minor = parseAmount(amount, base);
  const ready = minor !== null && minor > 0 && (method === 'cash' || reference.trim().length > 0);

  async function record() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const payload: GiftVoucherPayload = {
        shiftId: shift.id,
        cashierId: session.userId,
        currency: base,
        amountMinor: minor!,
        method,
        reference: method === 'cash' ? null : reference.trim(),
        forName: forName.trim() || null,
      };
      const entry = await pos.save({
        type: 'gift_voucher',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const doc: SavedGiftVoucher = {
        id: entry.doc.id,
        number: entry.doc.number,
        deviceTime: entry.doc.deviceTime,
        payload: entry.doc.payload,
      };
      setSaved(doc);
      onPrint(doc);
    } catch {
      setError('لم تُسجَّل القسيمة. لم يُحفظ شيء، حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  function again() {
    setSaved(null);
    setAmount('');
    setReference('');
    setForName('');
    setMethod('cash');
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للبيع
        </Button>
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-ink">قسيمة هدية</h1>
          <p className="text-ink-muted">تُباع بمبلغ وتُطبع بباركودها، وتُصرف عند الدفع كلها أو على دفعات.</p>
        </div>
      </div>
      {saved ? (
        <section
          aria-label="سُجّلت القسيمة"
          className="flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-6"
        >
          <h2 className="text-2xl font-bold text-ink">سُجّلت القسيمة</h2>
          <p className="text-ink">
            <bdi dir="ltr" className="num font-semibold">
              {saved.number}
            </bdi>{' '}
            ·{' '}
            <Money
              minor={(saved.payload as unknown as GiftVoucherPayload).amountMinor}
              currency={base}
              className="font-bold"
            />
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
              اطبع القسيمة مرة أخرى
            </Button>
            <Button onClick={again}>قسيمة أخرى</Button>
            <Button variant="secondary" onClick={onBack}>
              ارجع للبيع
            </Button>
          </div>
        </section>
      ) : (
        <section
          aria-label="القسيمة"
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
        >
          <TextField
            label="المبلغ"
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) =>
              setAmount(
                e.target.value
                  .replace(/[^\d.٠-٩٫]/g, '')
                  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
                  .replace('٫', '.'),
              )
            }
          />
          <div role="group" aria-label="طريقة الدفع" className="flex flex-wrap gap-2">
            {GIFT_VOUCHER_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={cn(
                  'min-h-11 rounded-control border-2 px-4 font-semibold',
                  method === m
                    ? 'border-brand bg-brand-soft text-brand-ink'
                    : 'border-line bg-surface text-ink',
                )}
              >
                {METHOD_TEXT[m]}
              </button>
            ))}
          </div>
          {method !== 'cash' ? (
            <TextField
              label="رقم العملية"
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value.slice(0, 64))}
            />
          ) : null}
          <TextField
            label="إلى (اختياري)"
            placeholder="يُطبع على القسيمة"
            value={forName}
            onChange={(e) => setForName(e.target.value.slice(0, 80))}
          />
          {error ? (
            <p role="alert" className="font-semibold text-danger-ink">
              {error}
            </p>
          ) : null}
          <Button size="lg" disabled={!ready || saving} loading={saving} onClick={() => void record()}>
            سجّل القسيمة{minor ? ' · ' : ''}
            {minor ? <Money minor={minor} currency={base} /> : null}
          </Button>
        </section>
      )}
    </div>
  );
}
