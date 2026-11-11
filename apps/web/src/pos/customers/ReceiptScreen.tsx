import { useState, type ReactNode } from 'react';
import type { ReceiptMethod, ReceiptPayload } from '@serva/core/contracts/documents';
import { CURRENCIES } from '@serva/core/currencies';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import type { SyncDocument } from '@serva/sync';
import {
  Alert,
  Avatar,
  Button,
  CardIcon,
  CashIcon,
  ChequeIcon,
  CustomersIcon,
  Money,
  PhoneIcon,
  PrintIcon,
  TextField,
  TransferIcon,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { ChoiceGroup, DoneCard, FlowHeader, OptionTile, SummaryRow } from '../FlowParts';
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

const METHOD_ICON: Record<ReceiptMethod, ReactNode> = {
  cash: <CashIcon />,
  wallet: <PhoneIcon />,
  card: <CardIcon />,
  transfer: <TransferIcon />,
  cheque: <ChequeIcon />,
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
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<CustomersIcon size={24} />}
        title="قبض من زبون"
        description="دفعة من حساب زبون. تُخصم من دينه، ويُطبع له سند قبض."
      />
      {saved ? (
        <DoneCard
          label="سُجّل القبض"
          title="سُجّل القبض"
          actions={
            <>
              <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
                اطبع السند مرة أخرى
              </Button>
              <Button onClick={again}>قبض آخر</Button>
              <Button variant="ghost" onClick={onBack}>
                ارجع للبيع
              </Button>
            </>
          }
        >
          <p className="text-lg text-ink">
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
        </DoneCard>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <section
            aria-label="القبض"
            className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
          >
            {customer ? (
              <div className="flex items-center gap-3 rounded-card border border-brand/30 bg-brand-soft/40 py-2 ps-3 pe-2">
                <Avatar name={customer.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs text-ink-muted">الزبون</span>
                  <span className="truncate font-semibold text-ink">{customer.name}</span>
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
              inputClassName="num text-2xl font-bold"
              endAdornment={<span className="me-4 shrink-0 text-base">{CURRENCIES[base].symbolAr}</span>}
            />
            <ChoiceGroup label="طريقة القبض" className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              {(Object.keys(METHOD_TEXT) as ReceiptMethod[]).map((m) => (
                <OptionTile
                  key={m}
                  selected={method === m}
                  onClick={() => setMethod(m)}
                  icon={METHOD_ICON[m]}
                  title={METHOD_TEXT[m]}
                />
              ))}
            </ChoiceGroup>
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
          </section>
          <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 lg:sticky lg:top-0">
            <div className="flex flex-col gap-0.5 rounded-control bg-surface-total px-4 py-3">
              <span className="text-sm font-semibold text-ink-muted">المبلغ المقبوض</span>
              <Money
                minor={minor ?? 0}
                currency={base}
                className="text-kpi font-bold tracking-tight text-ink"
                unitClassName="text-base font-semibold text-ink-subtle"
              />
            </div>
            <dl className="flex flex-col">
              <SummaryRow label="الزبون">{customer?.name ?? '—'}</SummaryRow>
              <SummaryRow label="الطريقة">{METHOD_TEXT[method]}</SummaryRow>
            </dl>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button
              size="lg"
              fullWidth
              disabled={!ready || saving}
              loading={saving}
              onClick={() => void record()}
            >
              سجّل القبض{minor ? ' · ' : ''}
              {minor ? <Money minor={minor} currency={base} /> : null}
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
