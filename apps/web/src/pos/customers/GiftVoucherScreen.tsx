import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GIFT_VOUCHER_METHODS, type GiftVoucherPayload } from '@serva/core/contracts/documents';
import { CURRENCIES } from '@serva/core/currencies';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import type { SyncDocument } from '@serva/sync';
import {
  Alert,
  BarcodeIcon,
  Button,
  CardIcon,
  CashIcon,
  GiftIcon,
  Money,
  PhoneIcon,
  PrintIcon,
  TextField,
  TransferIcon,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { ChoiceGroup, DoneCard, FlowHeader, OptionTile } from '../FlowParts';
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

const METHOD_ICON: Record<Method, ReactNode> = {
  cash: <CashIcon />,
  wallet: <PhoneIcon />,
  card: <CardIcon />,
  transfer: <TransferIcon />,
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
  // The amount is the first thing typed: the field is focused when the screen opens and after each voucher
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!saved) amountRef.current?.focus();
  }, [saved]);

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
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<GiftIcon size={24} />}
        title="قسيمة هدية"
        description="تُباع بمبلغ وتُطبع بباركودها، وتُصرف عند الدفع كلها أو على دفعات."
      />
      {saved ? (
        <DoneCard
          label="سُجّلت القسيمة"
          title="سُجّلت القسيمة"
          actions={
            <>
              <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
                اطبع القسيمة مرة أخرى
              </Button>
              <Button onClick={again}>قسيمة أخرى</Button>
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
            ·{' '}
            <Money
              minor={(saved.payload as unknown as GiftVoucherPayload).amountMinor}
              currency={base}
              className="font-bold"
            />
          </p>
        </DoneCard>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
          <section
            aria-label="القسيمة"
            className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
          >
            <TextField
              ref={amountRef}
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
            <ChoiceGroup label="طريقة الدفع" className="grid grid-cols-2 gap-2">
              {GIFT_VOUCHER_METHODS.map((m) => (
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
              label="إلى (اختياري)"
              placeholder="يُطبع على القسيمة"
              value={forName}
              onChange={(e) => setForName(e.target.value.slice(0, 80))}
            />
          </section>
          <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 lg:sticky lg:top-0">
            {/* What the voucher will say: the amount big, who it is for, and its barcode once saved */}
            <div className="flex flex-col gap-3 rounded-card border border-dashed border-brand/40 bg-brand-soft/40 p-4">
              <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
                <GiftIcon size={16} />
                قسيمة هدية
              </span>
              <Money
                minor={minor ?? 0}
                currency={base}
                className="text-kpi font-bold tracking-tight text-ink"
                unitClassName="text-base font-semibold text-ink-subtle"
              />
              <span className="truncate text-sm text-ink-muted">
                {forName.trim() ? `إلى ${forName.trim()}` : 'لمن يحملها'}
              </span>
              <span className="flex items-center gap-2 border-t border-dashed border-brand/30 pt-3 text-xs text-ink-subtle">
                <BarcodeIcon size={16} />
                يُطبع رقمها وباركودها بعد التسجيل
              </span>
            </div>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button
              size="lg"
              fullWidth
              disabled={!ready || saving}
              loading={saving}
              onClick={() => void record()}
            >
              سجّل القسيمة{minor ? ' · ' : ''}
              {minor ? <Money minor={minor} currency={base} /> : null}
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
