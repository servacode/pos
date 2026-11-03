import { useState } from 'react';
import type { ReceiptMethod, ReceiptPayload } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import type { SyncDocument } from '@serva/sync';
import { BackIcon, Button, cn, Money, PrintIcon, TextField } from '@serva/ui';
import type { Catalog } from '../catalog';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import type { OpenShift } from '../shift/shift';
import type { StaffSession } from '../staff/staff';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';

const METHOD_TEXT: Record<ReceiptMethod, string> = {
  cash: 'نقداً',
  wallet: 'شام كاش',
  card: 'بطاقة',
  transfer: 'تحويل',
  cheque: 'شيك',
};

export type SavedReceipt = Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;

/**
 * «قبض من زبون» (08 › سند قبض): a customer pays toward what they owe. The till saves a receipt
 * (RCV) in the base currency; cash goes into this shift's drawer, the rest to its account. What the
 * customer owes after it shows in their statement on the dashboard.
 */
export function ReceiptScreen({
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
  onPrint: (saved: SavedReceipt) => void;
}) {
  const pos = usePos();
  const settings = catalog.settings!;
  const base = settings.baseCurrency;
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReceipt | null>(null);

  const minor = parseAmount(amount, base);
  const ready =
    customer !== null && minor !== null && minor > 0 && (method === 'cash' || reference.trim().length > 0);

  async function record() {
    if (!ready || !customer) return;
    setSaving(true);
    setError(null);
    try {
      const payload: ReceiptPayload = {
        customerId: customer.id,
        customerName: customer.name,
        shiftId: shift.id,
        cashierId: session.userId,
        currency: base,
        amountMinor: minor!,
        method,
        reference: method === 'cash' ? null : reference.trim(),
        note: note.trim() || null,
      };
      const entry = await pos.save({
        type: 'receipt',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const doc: SavedReceipt = {
        id: entry.doc.id,
        number: entry.doc.number,
        deviceTime: entry.doc.deviceTime,
        payload: entry.doc.payload,
      };
      setSaved(doc);
      onPrint(doc);
    } catch {
      setError('لم يُسجَّل القبض. لم يُحفظ شيء، حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  function again() {
    setSaved(null);
    setCustomer(null);
    setAmount('');
    setReference('');
    setNote('');
    setMethod('cash');
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للبيع
        </Button>
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-ink">قبض من زبون</h1>
          <p className="text-ink-muted">دفعة من حساب زبون. تُخصم من دينه، ويُطبع له سند قبض.</p>
        </div>
      </div>
      {saved ? (
        <section
          aria-label="سُجّل القبض"
          className="flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-6"
        >
          <h2 className="text-2xl font-bold text-ink">سُجّل القبض</h2>
          <p className="text-ink">
            <bdi dir="ltr" className="num font-semibold">
              {saved.number}
            </bdi>{' '}
            · {(saved.payload as unknown as ReceiptPayload).customerName} ·{' '}
            <Money
              minor={(saved.payload as unknown as ReceiptPayload).amountMinor}
              currency={base}
              className="font-bold"
            />
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
              اطبع السند مرة أخرى
            </Button>
            <Button onClick={again}>قبض آخر</Button>
            <Button variant="secondary" onClick={onBack}>
              ارجع للبيع
            </Button>
          </div>
        </section>
      ) : (
        <section
          aria-label="القبض"
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
        >
          {customer ? (
            <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2">
              <span className="flex flex-1 flex-col">
                <span className="text-xs text-ink-muted">الزبون</span>
                <span className="font-semibold text-ink">{customer.name}</span>
              </span>
              <Button variant="ghost" onClick={() => setCustomer(null)}>
                غيّره
              </Button>
            </div>
          ) : (
            <CustomerPicker
              catalog={catalog}
              createdBy={session.userId}
              onPicked={setCustomer}
              onCancel={onBack}
            />
          )}
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
          <div role="group" aria-label="طريقة القبض" className="flex flex-wrap gap-2">
            {(Object.keys(METHOD_TEXT) as ReceiptMethod[]).map((m) => (
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
            label="ملاحظة (اختياري)"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
          />
          {error ? (
            <p role="alert" className="font-semibold text-danger-ink">
              {error}
            </p>
          ) : null}
          <Button size="lg" disabled={!ready || saving} loading={saving} onClick={() => void record()}>
            سجّل القبض{minor ? ' · ' : ''}
            {minor ? <Money minor={minor} currency={base} /> : null}
          </Button>
        </section>
      )}
    </div>
  );
}
