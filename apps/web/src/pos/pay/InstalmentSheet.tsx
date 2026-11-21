import { useMemo, useState } from 'react';
import {
  INSTALMENT_FREQUENCY_LABELS,
  checkTerms,
  defaultFirstDueDate,
  minDownPayment,
  type InstalmentFrequency,
  type InstalmentSettings,
} from '@serva/core/installments';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import {
  Alert,
  BackIcon,
  Button,
  IconButton,
  Money,
  SegmentedControl,
  TextField,
  ToggleChip,
} from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { amountText, parseAmount } from './payment';
import { countChoices, planFor, type PlanDraft } from './instalments';

/**
 * «خطة التقسيط» as a layer inside the payment panel: the down payment, how many instalments, how
 * often and from when, the guarantor, and the schedule it makes, live. «السعر نقداً» and «بالتقسيط»
 * stay in view. Nothing is saved here: confirming hands the plan back to the panel, which takes the
 * down payment by the usual methods and puts the rest on the customer's account.
 */
export function InstalmentSheet({
  goodsTotalMinor,
  base,
  today,
  settings,
  customerName,
  planId,
  onConfirm,
  onCancel,
}: {
  goodsTotalMinor: number;
  base: CurrencyCode;
  today: string;
  settings: InstalmentSettings;
  customerName: string;
  planId: string;
  onConfirm: (draft: PlanDraft) => void;
  onCancel: () => void;
}) {
  const counts = countChoices(settings);
  const minDown = minDownPayment(goodsTotalMinor, settings);
  const [down, setDown] = useState(() => amountText(minDown, base));
  const [count, setCount] = useState(counts.includes(6) ? 6 : (counts[0] ?? 1));
  const [frequency, setFrequency] = useState<Exclude<InstalmentFrequency, 'custom'>>('monthly');
  const [first, setFirst] = useState(() => defaultFirstDueDate(today, 'monthly'));
  // The first date follows «كل كم» until the cashier picks a date himself
  const [firstPicked, setFirstPicked] = useState(false);
  const [guarantor, setGuarantor] = useState({ name: '', phone: '', nationalId: '' });
  const [borrower, setBorrower] = useState({ nationalId: '', address: '' });

  const downMinor = parseAmount(down, base);
  const result = useMemo(
    () =>
      downMinor === null
        ? ({ error: 'اكتب الدفعة الأولى أرقاماً.' } as const)
        : planFor(
            { goodsTotalMinor, downMinor, count, frequency, firstDueDate: first, guarantor, borrower },
            settings,
            planId,
            settings.notesMode,
          ),
    [goodsTotalMinor, downMinor, count, frequency, first, guarantor, borrower, settings, planId],
  );
  const problems =
    downMinor === null
      ? []
      : checkTerms(
          { totalMinor: goodsTotalMinor, downPaymentMinor: downMinor, count, firstDueDate: first },
          settings,
          today,
          { minDownWaived: true },
        );
  const draft = 'draft' in result ? result.draft : null;
  const symbol = CURRENCIES[base].symbolAr;

  return (
    <section
      aria-label="خطة التقسيط"
      className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-surface motion-safe:animate-sheet-in"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <IconButton label="ارجع للدفع" size="md" icon={<BackIcon size={20} />} onClick={onCancel} />
        <h2 className="flex-1 truncate text-lg font-semibold text-ink">خطة تقسيط · {customerName}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 rounded-card bg-surface-total px-4 py-3">
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-ink-muted">السعر نقداً</span>
              <Money minor={goodsTotalMinor} currency={base} className="text-lg font-bold text-ink" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-ink-muted">السعر بالتقسيط</span>
              <Money
                minor={goodsTotalMinor + (draft?.markupMinor ?? 0)}
                currency={base}
                className="text-lg font-bold text-ink"
              />
            </span>
          </div>
          <TextField
            label={`الدفعة الأولى (${symbol})`}
            hint={`أقل دفعة ${amountText(minDown, base)} ${symbol}`}
            inputMode="decimal"
            dir="ltr"
            value={down}
            onChange={(e) => setDown(e.target.value.replace(/[^\d.]/g, '').slice(0, 14))}
          />
          <div role="group" aria-label="عدد الأقساط" className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">عدد الأقساط</span>
            <div className="flex flex-wrap gap-2">
              {counts.map((n) => (
                <ToggleChip
                  key={n}
                  type="radio"
                  name="instalment-count"
                  label={String(n)}
                  checked={count === n}
                  onChange={() => setCount(n)}
                />
              ))}
            </div>
          </div>
          <SegmentedControl
            label="كل كم"
            value={frequency}
            onValueChange={(f) => {
              setFrequency(f);
              if (!firstPicked) setFirst(defaultFirstDueDate(today, f));
            }}
            options={(['monthly', 'biweekly', 'weekly'] as const).map((f) => ({
              value: f,
              label: INSTALMENT_FREQUENCY_LABELS[f],
            }))}
          />
          <DateField
            label="تاريخ أول قسط"
            value={first}
            required
            min={today}
            onChange={(day) => {
              setFirst(day);
              setFirstPicked(true);
            }}
          />
          <details className="rounded-card border border-line p-3">
            <summary className="cursor-pointer font-semibold text-ink">
              الكفيل وبيانات الزبون{' '}
              <span className="text-sm font-normal text-ink-muted">
                {settings.guarantorOverMinor !== null ? '(الكفيل مطلوب للمبالغ الكبيرة)' : '(اختياري)'}
              </span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label="اسم الكفيل"
                value={guarantor.name}
                onChange={(e) => setGuarantor({ ...guarantor, name: e.target.value.slice(0, 120) })}
              />
              <TextField
                label="هاتف الكفيل"
                dir="ltr"
                inputMode="tel"
                value={guarantor.phone}
                onChange={(e) => setGuarantor({ ...guarantor, phone: e.target.value.slice(0, 30) })}
              />
              <TextField
                label="الرقم الوطني للكفيل"
                dir="ltr"
                inputMode="numeric"
                value={guarantor.nationalId}
                onChange={(e) => setGuarantor({ ...guarantor, nationalId: e.target.value.slice(0, 30) })}
              />
              <TextField
                label="الرقم الوطني للزبون"
                dir="ltr"
                inputMode="numeric"
                value={borrower.nationalId}
                onChange={(e) => setBorrower({ ...borrower, nationalId: e.target.value.slice(0, 30) })}
              />
              <TextField
                label="عنوان الزبون"
                className="sm:col-span-2"
                value={borrower.address}
                onChange={(e) => setBorrower({ ...borrower, address: e.target.value.slice(0, 200) })}
              />
            </div>
          </details>
          {'error' in result ? <Alert tone="warning">{result.error}</Alert> : null}
          {problems.length > 0 ? <Alert tone="warning">{problems.join(' ')}</Alert> : null}
          {draft?.belowMinimum ? (
            <Alert tone="info">الدفعة أقل من الحد الأدنى: يلزم رمز مدير عند التأكيد.</Alert>
          ) : null}
          {draft ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm text-ink-muted">
                <span>
                  رسم التقسيط <bdi className="num">{draft.plan.markupBp / 100}%</bdi>
                </span>
                <Money minor={draft.markupMinor} currency={base} className="font-semibold text-ink" />
              </div>
              <ul
                aria-label="جدول الأقساط"
                className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line"
              >
                {draft.plan.schedule.map((i) => (
                  <li key={i.no} className="flex items-center gap-3 bg-surface px-3 py-2">
                    <span className="num w-8 shrink-0 text-sm text-ink-muted">{i.no}</span>
                    <bdi dir="ltr" className="num flex-1 whitespace-nowrap text-ink">
                      {i.dueDate}
                    </bdi>
                    <Money minor={i.amountMinor} currency={base} className="font-bold text-ink" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-total px-4 py-2">
        {draft ? (
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-ink-muted">على حساب الزبون</span>
            <Money minor={draft.financedMinor} currency={base} className="text-xl font-bold text-ink" />
          </span>
        ) : null}
        <span className="flex-1" />
        <Button variant="secondary" size="lg" onClick={onCancel}>
          ارجع
        </Button>
        <Button size="lg" disabled={!draft || problems.length > 0} onClick={() => draft && onConfirm(draft)}>
          اعتمد الخطة
        </Button>
      </footer>
    </section>
  );
}
