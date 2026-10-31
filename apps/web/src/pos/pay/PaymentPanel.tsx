import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES } from '@serva/core/currencies';
import { convert } from '@serva/core/money';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import {
  buildSalePayload,
  businessDateOf,
  rateFor,
  settleSale,
  type SaleSettlement,
  type SaleTender,
} from '@serva/core/sale';
import type { OutboxEntry } from '@serva/sync';
import {
  BackIcon,
  Button,
  CashIcon,
  CheckIcon,
  cn,
  DeleteIcon,
  displayNumber,
  Keypad,
  Money,
  TextField,
  useDigits,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { digitOf } from '../PinScreen';
import { usePos } from '../services';
import { pricingInput, type Cart, type PricingContext } from '../sale/cart';
import {
  amountText,
  dueIn,
  parseAmount,
  payOptions,
  quickAmounts,
  REFERENCE_LABEL,
  tenderOf,
  type PayOption,
} from './payment';

export interface PaymentPanelProps {
  cart: Cart;
  ctx: PricingContext;
  totalMinor: number;
  catalog: Catalog;
  shiftId: string;
  cashierId: string;
  onBack: () => void;
  onCompleted: (entry: OutboxEntry) => void;
}

interface Part {
  option: PayOption;
  tender: SaleTender;
}

/**
 * The payment panel (kit cashier/Payment), beside the cart: what is due in both currencies, the
 * method, the amount received with quick notes and the keypad, the change live, and a split over
 * several methods. «أتمّ الدفع» (or Enter) builds the sale with buildSalePayload(), saves it in the
 * outbox, where it takes its INV number, and hands it to the receipt.
 */
export function PaymentPanel({
  cart,
  ctx,
  totalMinor,
  catalog,
  shiftId,
  cashierId,
  onBack,
  onCompleted,
}: PaymentPanelProps) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const base = ctx.currency;
  const options = useMemo(
    () => payOptions(base, settings.enabledCurrencies, catalog.rates, catalog.collectRates),
    [base, settings.enabledCurrencies, catalog.rates, catalog.collectRates],
  );
  const [option, setOption] = useState<PayOption>(options[0]!);
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const referenceRef = useRef<HTMLInputElement>(null);

  const cashSteps = settings.cashRoundingSteps;
  const typed = parseAmount(text, option.currency);
  const settleWith = (tenders: SaleTender[]): SaleSettlement | { error: string } => {
    try {
      return settleSale({
        currency: base,
        exchangeRates: ctx.rates,
        totalMinor,
        payments: tenders,
        cashSteps,
      });
    } catch {
      return { error: 'المبلغ أكبر من المطلوب. البطاقة والمحفظة والتحويل تدفع المبلغ تماماً، دون باقٍ.' };
    }
  };
  const before = settleWith(parts.map((p) => p.tender));
  const remainingBase = 'error' in before ? totalMinor : before.remainingMinor;
  const nonCash = option.method !== 'cash';
  // Non-cash pays exactly what is left unless the cashier types less (a split).
  const amount = typed ?? (nonCash ? remainingBase : null);
  const current = amount && amount > 0 ? tenderOf(option, amount, reference) : null;
  const tenders = [...parts.map((p) => p.tender), ...(current ? [current] : [])];
  const settlement = settleWith(tenders);
  const needsReference = nonCash && current !== null && current.reference === null;
  const canComplete =
    !saving && !('error' in settlement) && settlement.covered && !needsReference && tenders.length > 0;

  const dueHere = dueIn(option.currency, base, remainingBase, ctx.rates);
  const quick = option.method === 'cash' ? quickAmounts(dueHere, option.currency) : [];

  function pick(next: PayOption) {
    setOption(next);
    setText('');
    setReference('');
    setError(null);
    if (next.method !== 'cash') setTimeout(() => referenceRef.current?.focus(), 0);
  }

  function addPart() {
    if (!current) return;
    setParts((list) => [...list, { option, tender: current }]);
    setText('');
    setReference('');
  }

  async function complete() {
    if (!canComplete) {
      if ('error' in settlement) setError(settlement.error);
      else if (needsReference) setError(`اكتب ${REFERENCE_LABEL[option.method]}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildSalePayload({
        ...pricingInput(cart, ctx),
        shiftId,
        cashierId,
        payments: tenders,
        cashSteps,
      });
      const now = pos.now();
      const entry = await pos.save({
        type: 'sale',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDateOf(now, settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      onCompleted(entry);
    } catch {
      setSaving(false);
      setError('لم تُحفظ الفاتورة. لم يُسجَّل شيء، حاول مرة أخرى.');
    }
  }

  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        onBack();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void completeRef.current();
        return;
      }
      if (event.target instanceof HTMLInputElement) return;
      const digit = digitOf(event.key);
      if (digit) setText((t) => (t === '0' ? digit : (t + digit).slice(0, 12)));
      else if (event.key === 'Backspace') setText((t) => t.slice(0, -1));
      else if (event.key === '.' && CURRENCIES[option.currency].displayDecimals > 0)
        setText((t) => (t.includes('.') ? t : `${t || '0'}.`));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack, option.currency]);

  const foreign = catalog.rates[0]
    ? catalog.rates[0].unit === base
      ? catalog.rates[0].quote
      : catalog.rates[0].unit
    : null;
  const changeMinor = 'error' in settlement ? 0 : (settlement.change?.amountMinor ?? 0);
  const short = 'error' in settlement || !settlement.covered;
  const shortCash = 'error' in settlement ? 0 : settlement.remainingCashMinor;

  return (
    <section
      aria-label="الدفع"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e3 motion-safe:animate-sheet-in"
    >
      <header className="flex items-center gap-4 border-b border-line px-6 py-3">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للسلة
        </Button>
        <h2 className="text-2xl font-bold text-ink">{split ? 'الدفع · مقسّم' : 'الدفع'}</h2>
        <span className="flex-1" />
        <div className="flex flex-col items-end">
          <span className="text-xs text-ink-muted">المطلوب</span>
          <span className="flex items-baseline gap-3">
            <Money minor={totalMinor} currency={base} className="text-3xl font-bold text-ink" />
            {foreign ? (
              <Money
                minor={convert(totalMinor, base, foreign, rateFor(ctx.rates, foreign, base))}
                currency={foreign}
                className="text-lg text-ink-muted"
              />
            ) : null}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,17rem)_minmax(0,1fr)] gap-5 overflow-y-auto px-6 py-4 xl:grid-cols-[minmax(0,21.25rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-ink-muted">
            {split ? 'طريقة الجزء التالي' : 'طريقة الدفع'}
          </span>
          <div role="group" aria-label="طريقة الدفع" className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                aria-pressed={option.key === o.key}
                onClick={() => pick(o)}
                className={cn(
                  'flex min-h-16 flex-col items-start justify-center rounded-2xl border px-3 text-start',
                  option.key === o.key
                    ? 'border-2 border-brand bg-brand-soft text-brand-ink'
                    : 'border-line bg-surface text-ink',
                )}
              >
                <span className="font-bold">{o.label}</span>
                {o.rate ? (
                  <span className="text-xs font-semibold text-ink-muted">
                    سعر <bdi className="num">{displayNumber(o.rate.rate, digits)}</bdi>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="طريقة التقسيم"
            className="grid grid-cols-2 gap-1 rounded-control bg-surface-muted p-1"
          >
            {[false, true].map((on) => (
              <button
                key={String(on)}
                type="button"
                aria-pressed={split === on}
                onClick={() => {
                  setSplit(on);
                  if (!on) setParts([]);
                }}
                className={cn(
                  'min-h-12 rounded-xl font-semibold',
                  split === on ? 'bg-surface text-ink shadow-e1' : 'text-ink-muted',
                )}
              >
                {on ? 'قسّم الدفع' : 'دفعة واحدة'}
              </button>
            ))}
          </div>
          {parts.length > 0 ? (
            <ul aria-label="الأجزاء المدفوعة" className="flex flex-col gap-2">
              {parts.map((part, index) => (
                <li
                  key={index}
                  className="flex items-center gap-2 rounded-control border border-line px-3 py-2"
                >
                  <span className="flex-1 font-semibold">{part.option.label}</span>
                  <Money
                    minor={part.tender.amountMinor}
                    currency={part.tender.currency}
                    className="font-bold"
                  />
                  <button
                    type="button"
                    aria-label="احذف هذا الجزء"
                    onClick={() => setParts((list) => list.filter((_, i) => i !== index))}
                    className="grid size-12 place-items-center rounded-xl text-ink-muted hover:bg-surface-muted"
                  >
                    <DeleteIcon size={20} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">
              {option.method === 'cash' ? 'المبلغ المستلم' : 'المبلغ'} · {option.label}
            </span>
            <span className="flex h-16 items-center justify-between rounded-control border-2 border-brand bg-surface px-4">
              <span className="num text-3xl font-bold text-ink" dir="ltr">
                {text
                  ? displayNumber(text, digits)
                  : amount
                    ? displayNumber(amountText(amount, option.currency), digits)
                    : displayNumber('0', digits)}
              </span>
              <span className="text-lg text-ink-muted">{CURRENCIES[option.currency].symbolAr}</span>
            </span>
          </div>
          {option.method !== 'cash' ? (
            <TextField
              ref={referenceRef}
              label={REFERENCE_LABEL[option.method] ?? 'المرجع'}
              value={reference}
              onChange={(event) => setReference(event.target.value.slice(0, 64))}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {quick.map((value, index) => (
                <Button
                  key={value}
                  variant="secondary"
                  size="lg"
                  onClick={() => setText(amountText(value, option.currency))}
                  className="flex-col gap-0"
                >
                  {index === 0 ? <span className="text-xs">المبلغ تماماً</span> : null}
                  <Money minor={value} currency={option.currency} symbol={false} className="text-lg" />
                </Button>
              ))}
            </div>
          )}
          <Keypad
            onDigit={(d) => setText((t) => (t === '0' ? d : (t + d).slice(0, 12)))}
            onBackspace={() => setText((t) => t.slice(0, -1))}
            extraKey={CURRENCIES[option.currency].displayDecimals > 0 ? '.' : '00'}
            onExtraKey={() =>
              setText((t) =>
                CURRENCIES[option.currency].displayDecimals > 0
                  ? t.includes('.')
                    ? t
                    : `${t || '0'}.`
                  : t
                    ? `${t}00`
                    : t,
              )
            }
          />
        </div>
      </div>

      <footer className="flex items-center gap-5 border-t border-line bg-surface-total px-6 py-3">
        <div role="status" className="flex flex-col">
          <span className="text-sm font-semibold text-ink-muted">{short ? 'ناقص من الزبون' : 'الباقي'}</span>
          <span className={cn('text-4xl/[52px] font-bold', short ? 'text-warning-ink' : 'text-ink')}>
            <Money
              minor={short ? shortCash : changeMinor}
              currency={
                short
                  ? 'error' in settlement
                    ? base
                    : settlement.settlementCurrency
                  : (settlement.change?.currency ?? base)
              }
            />
          </span>
        </div>
        <span className="flex-1" />
        {error ? (
          <p role="alert" className="max-w-xs text-sm font-semibold text-danger-ink">
            {error}
          </p>
        ) : null}
        {split && !canComplete && current ? (
          <Button size="lg" variant="secondary" onClick={addPart}>
            أضف الجزء
          </Button>
        ) : null}
        <Button
          size="lg"
          icon={option.method === 'cash' ? <CashIcon /> : <CheckIcon />}
          onClick={complete}
          disabled={!canComplete}
          loading={saving}
        >
          أتمّ الدفع
        </Button>
      </footer>
    </section>
  );
}
