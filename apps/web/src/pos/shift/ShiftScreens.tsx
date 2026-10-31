import { useEffect, useMemo, useState } from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import type { CashMovementKind, CashMovementPayload, ShiftMode } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import type { OutboxEntry } from '@serva/sync';
import { BackIcon, Button, CashIcon, cn, InfoIcon, Money, TextField, useDigits } from '@serva/ui';
import type { Catalog } from '../catalog';
import { clockText } from '../format';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { DrawerCounter, emptyCount } from './DrawerCounter';
import {
  cashMovementPayload,
  closeDrawer,
  countTotal,
  deviceDocuments,
  LAST_CLOSED_KEY,
  shiftActivity,
  shiftClosePayload,
  shiftKey,
  shiftOpenPayload,
  type DrawerCount,
  type OpenShift,
  type ShiftActivity,
} from './shift';

/** The drawers of the store: its base currency and each enabled one with a rate (10 › درج لكل عملة). */
export function drawerCurrencies(catalog: Catalog): CurrencyCode[] {
  const settings = catalog.settings!;
  const base = settings.baseCurrency;
  const foreign = settings.enabledCurrencies.filter(
    (c) => c !== base && catalog.rates.some((r) => r.unit === c || r.quote === c),
  );
  return [base, ...foreign];
}

const MODE_TEXT: Record<ShiftMode, string> = {
  per_cashier: 'درج لكل كاشير',
  shared: 'جهاز واحد وعدة أشخاص',
  handover: 'تسليم بعدّ',
};

function useBusinessDate(catalog: Catalog) {
  const pos = usePos();
  const settings = catalog.settings!;
  return () => businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff);
}

/**
 * «افتح الوردية» (kit cashier/ShiftOpen): the cashier counts each drawer before the first sale,
 * and the device saves shift_open (SFT) with the opening count.
 */
export function ShiftOpenScreen({
  session,
  catalog,
  onOpened,
}: {
  session: StaffSession;
  catalog: Catalog;
  onOpened: (shift: OpenShift) => void;
}) {
  const pos = usePos();
  const mode = catalog.settings!.shiftMode;
  const businessDate = useBusinessDate(catalog);
  const [counts, setCounts] = useState<DrawerCount[]>(() => drawerCurrencies(catalog).map(emptyCount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setSaving(true);
    setError(null);
    try {
      const lastClosed = await pos.local.get<string>(LAST_CLOSED_KEY);
      const payload = shiftOpenPayload(session.userId, mode, lastClosed, counts);
      const entry = await pos.save({
        type: 'shift_open',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const key = shiftKey(mode, session.userId);
      const shift: OpenShift = {
        key,
        id: entry.doc.id,
        number: entry.doc.number!,
        openedBy: session.userId,
        openedByName: session.fullName,
        openedAt: pos.now(),
        mode: payload.mode,
        opening: payload.opening,
      };
      await pos.local.set(key, shift);
      onOpened(shift);
    } catch {
      setSaving(false);
      setError('لم تُفتح الوردية. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  return (
    <div className="grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-ink">افتح الوردية</h1>
          <p className="text-ink-muted">
            {MODE_TEXT[mode]} · عدّ النقد في الدرج قبل أول بيع. يُحفظ العدّ على الجهاز ويُرسل وحده.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {counts.map((count, i) => (
            <DrawerCounter
              key={count.currency}
              count={count}
              onChange={(next) => setCounts((list) => list.map((c, j) => (j === i ? next : c)))}
            />
          ))}
        </div>
      </div>
      <aside className="flex flex-col gap-4 self-start rounded-card border border-line bg-surface-total p-5">
        <span className="font-semibold text-ink-muted">المجموع الحي</span>
        {counts.map((c) => (
          <Money
            key={c.currency}
            minor={countTotal(c)}
            currency={c.currency}
            className="text-3xl font-bold text-ink"
          />
        ))}
        {error ? (
          <p role="alert" className="font-semibold text-danger-ink">
            {error}
          </p>
        ) : null}
        <Button size="pay" icon={<CashIcon />} onClick={open} loading={saving} className="justify-center">
          افتح الوردية
        </Button>
      </aside>
    </div>
  );
}

/**
 * «إغلاق الوردية» (kit cashier/ShiftClose): a blind count of each drawer, then the summary by
 * payment method. The expected amount and the difference show only to a role that may see them
 * (shift.view_difference, 11/16); the device saves shift_close with every term of the formula.
 */
export function ShiftCloseScreen({
  session,
  catalog,
  shift,
  onBack,
  onClosed,
}: {
  session: StaffSession;
  catalog: Catalog;
  shift: OpenShift;
  onBack: () => void;
  onClosed: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const businessDate = useBusinessDate(catalog);
  const [step, setStep] = useState<'count' | 'summary'>('count');
  const [counts, setCounts] = useState<DrawerCount[]>(() => drawerCurrencies(catalog).map(emptyCount));
  const [activity, setActivity] = useState<ShiftActivity | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSeeDifference = session.permissions.has('shift.view_difference');
  const canClose =
    session.permissions.has('shift.close_any') ||
    (session.permissions.has('shift.close_own') && shift.openedBy === session.userId);

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((entries) => alive && setActivity(shiftActivity(shift.id, entries)));
    return () => {
      alive = false;
    };
  }, [pos.store, shift.id]);

  const cash = useMemo(
    () =>
      activity
        ? counts.map((count) =>
            closeDrawer(
              count.currency,
              settings.baseCurrency,
              catalog.rates,
              shift.opening.find((o) => o.currency === count.currency)?.amountMinor ?? 0,
              activity.terms.get(count.currency),
              count,
            ),
          )
        : [],
    [activity, counts, settings.baseCurrency, catalog.rates, shift.opening],
  );

  async function close() {
    if (!activity) return;
    setSaving(true);
    setError(null);
    try {
      const payload = shiftClosePayload({
        shift,
        closedBy: session.userId,
        baseCurrency: settings.baseCurrency,
        cash,
        activity,
      });
      await pos.save({
        type: 'shift_close',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      await pos.local.remove(shift.key);
      await pos.local.set(LAST_CLOSED_KEY, shift.id);
      onClosed();
    } catch {
      setSaving(false);
      setError('لم تُغلق الوردية. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button
          variant="secondary"
          icon={<BackIcon />}
          onClick={step === 'count' ? onBack : () => setStep('count')}
        >
          {step === 'count' ? 'ارجع للبيع' : 'ارجع للعدّ'}
        </Button>
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-ink">
            {step === 'count' ? 'إغلاق الوردية' : 'ملخّص الوردية'}
          </h1>
          <p className="text-ink-muted">
            {shift.openedByName} · منذ {clockText(shift.openedAt, digits)} ·{' '}
            <bdi dir="ltr" className="num">
              {shift.number}
            </bdi>
            {activity ? ` · ${activity.saleCount} فاتورة` : ''}
          </p>
        </div>
      </div>
      {step === 'count' ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-6">
          <div className="grid gap-4 xl:grid-cols-2">
            {counts.map((count, i) => (
              <DrawerCounter
                key={count.currency}
                count={count}
                onChange={(next) => setCounts((list) => list.map((c, j) => (j === i ? next : c)))}
              />
            ))}
          </div>
          <aside className="flex flex-col gap-4 self-start rounded-card border border-line bg-surface-total p-5">
            <p className="flex gap-2 text-sm text-ink-muted">
              <InfoIcon size={16} className="shrink-0" />
              عدّ أعمى: لا يظهر المبلغ المتوقع. عُدّ ما في يدك فقط.
            </p>
            {counts.map((c) => (
              <Money
                key={c.currency}
                minor={countTotal(c)}
                currency={c.currency}
                className="text-3xl font-bold text-ink"
              />
            ))}
            <Button size="lg" onClick={() => setStep('summary')} disabled={!activity}>
              تابع للملخّص
            </Button>
          </aside>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-6">
          <section
            aria-label="الملخّص حسب طريقة الدفع"
            className="rounded-card border border-line bg-surface p-4"
          >
            <table className="w-full">
              <thead>
                <tr className="text-sm text-ink-muted">
                  <th className="py-2 text-start font-semibold">طريقة الدفع</th>
                  <th className="py-2 text-start font-semibold">فواتير</th>
                  <th className="py-2 text-end font-semibold">الصافي</th>
                </tr>
              </thead>
              <tbody>
                {(activity?.byMethod ?? []).map((row) => (
                  <tr key={`${row.method}:${row.currency}`} className="border-t border-line">
                    <td className="py-3">
                      {METHOD_NAMES[row.method]}
                      {row.method === 'cash' && row.currency !== settings.baseCurrency ? ' بالدولار' : ''}
                    </td>
                    <td className="num py-3">{row.count}</td>
                    <td className="py-3 text-end">
                      <Money minor={row.amountMinor} currency={row.currency} className="font-semibold" />
                    </td>
                  </tr>
                ))}
                {activity && activity.byMethod.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-ink-muted">
                      لا مبيعات في هذه الوردية.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
          <aside className="flex flex-col gap-3 self-start rounded-card border border-line bg-surface-total p-5">
            <span className="font-semibold text-ink-muted">النقد المعدود</span>
            {cash.map((c) => (
              <div key={c.currency} className="flex flex-col">
                <Money minor={c.countedMinor} currency={c.currency} className="text-2xl font-bold text-ink" />
                {canSeeDifference ? (
                  <span className="text-sm text-ink-muted">
                    المتوقع <Money minor={c.expectedMinor} currency={c.currency} /> · الفرق{' '}
                    <Money
                      minor={c.differenceMinor}
                      currency={c.currency}
                      className={cn(
                        'font-semibold',
                        c.differenceMinor < 0 ? 'text-danger-ink' : 'text-success-ink',
                      )}
                    />
                  </span>
                ) : null}
              </div>
            ))}
            {!canSeeDifference ? (
              <p className="text-sm text-ink-muted">المتوقع والفرق يراهما المدير فقط.</p>
            ) : null}
            {!canClose ? (
              <p role="alert" className="text-sm font-semibold text-warning-ink">
                دورك لا يسمح بإغلاق هذه الوردية. اطلب من المدير إغلاقها.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="font-semibold text-danger-ink">
                {error}
              </p>
            ) : null}
            <Button size="lg" onClick={close} loading={saving} disabled={!canClose}>
              أغلق الوردية
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}

const METHOD_NAMES = {
  cash: 'نقد',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل',
} as const;

const KIND_TEXT: Record<Exclude<CashMovementKind, 'expense'>, { label: string; hint: string }> = {
  pay_in: { label: 'إيداع في الدرج', hint: 'نقد يدخل الدرج من الخزنة، كالفكّة' },
  pay_out: { label: 'سحب من الدرج', hint: 'نقد يخرج من الدرج إلى الخزنة أو المكتب' },
  safe_drop: { label: 'إيداع للخزنة', hint: 'الدرج ممتلئ؟ انقل جزءاً منه إلى الخزنة' },
};

/**
 * «حركات الدرج» (kit cashier/CashMovements): pay-in, pay-out and a drop to the safe, each with its
 * reason and the manager's code (contract Q5), saved as cash_movement (CSH). Works offline.
 */
export function CashMovementScreen({
  session,
  catalog,
  staff,
  shift,
  onBack,
}: {
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shift: OpenShift;
  onBack: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const businessDate = useBusinessDate(catalog);
  const currencies = drawerCurrencies(catalog);
  const [kind, setKind] = useState<Exclude<CashMovementKind, 'expense'>>('pay_in');
  const [currency, setCurrency] = useState<CurrencyCode>(currencies[0]!);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OutboxEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then(
      (entries) =>
        alive &&
        setSaved(
          entries
            .filter(
              (e) =>
                e.type === 'cash_movement' && (e.doc.payload as { shiftId?: string }).shiftId === shift.id,
            )
            .reverse(),
        ),
    );
    return () => {
      alive = false;
    };
  }, [pos.store, shift.id, tick]);

  const minor = parseAmount(amount, currency);
  const ready = minor !== null && minor > 0 && reason.trim().length > 0;

  async function record(approval: Parameters<typeof cashMovementPayload>[0]['approval']) {
    setApproving(false);
    setError(null);
    try {
      const payload = cashMovementPayload({
        shiftId: shift.id,
        kind,
        currency,
        amountMinor: minor!,
        baseCurrency: settings.baseCurrency,
        rates: catalog.rates,
        reason,
        reference: reference || null,
        performedBy: session.userId,
        approval,
      });
      await pos.save({
        type: 'cash_movement',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      setAmount('');
      setReason('');
      setReference('');
      setTick((t) => t + 1);
    } catch {
      setError('لم تُسجَّل الحركة. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للبيع
        </Button>
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-ink">حركات الدرج</h1>
          <p className="text-ink-muted">
            كل حركة باسمك وبسبب مكتوب، وبرمز المدير. تُحفظ على الجهاز وتُرسل وحدها.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-6">
        <section
          aria-label="حركة جديدة"
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
        >
          <div role="group" aria-label="نوع الحركة" className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND_TEXT) as (keyof typeof KIND_TEXT)[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'flex min-h-18 flex-col items-start justify-center rounded-control border-2 px-3 text-start',
                  kind === k
                    ? 'border-brand bg-brand-soft text-brand-ink'
                    : 'border-line bg-surface text-ink',
                )}
              >
                <span className="font-bold">{KIND_TEXT[k].label}</span>
                <span className="text-xs text-ink-muted">{KIND_TEXT[k].hint}</span>
              </button>
            ))}
          </div>
          {currencies.length > 1 ? (
            <div role="group" aria-label="الدرج" className="grid grid-cols-2 gap-2">
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => {
                    setCurrency(c);
                    setAmount('');
                  }}
                  className={cn(
                    'min-h-12 rounded-control border-2 font-semibold',
                    currency === c ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface',
                  )}
                >
                  {c === 'SYP' ? 'درج الليرة' : c === 'USD' ? 'درج الدولار' : c}
                </button>
              ))}
            </div>
          ) : null}
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
          <TextField label="السبب" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} />
          <TextField
            label="رقم الوصل (اختياري)"
            value={reference}
            onChange={(e) => setReference(e.target.value.slice(0, 64))}
            dir="ltr"
          />
          {error ? (
            <p role="alert" className="font-semibold text-danger-ink">
              {error}
            </p>
          ) : null}
          {approving ? (
            <ManagerCode
              staff={staff}
              permission="cash.move"
              reason="الحركة تُخرج أو تُدخل نقداً في الدرج، فتحتاج رمز مدير حاضر. تُسجَّل باسمه."
              onApproved={(approval) => void record(approval)}
              onCancel={() => setApproving(false)}
            />
          ) : (
            <Button size="lg" onClick={() => setApproving(true)} disabled={!ready}>
              سجّل الحركة{minor ? ' · ' : ''}
              {minor ? <Money minor={minor} currency={currency} /> : null}
            </Button>
          )}
        </section>
        <section
          aria-label="حركات هذه الوردية"
          className="flex flex-col gap-2 self-start rounded-card border border-line bg-surface p-4"
        >
          <h2 className="font-bold text-ink">حركات هذه الوردية</h2>
          {saved.length === 0 ? <p className="text-ink-muted">لا حركات بعد.</p> : null}
          <ul className="flex flex-col">
            {saved.map((entry) => {
              const p = entry.doc.payload as unknown as CashMovementPayload;
              return (
                <li key={entry.id} className="flex items-center gap-3 border-t border-line py-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">
                      {KIND_TEXT[p.kind as keyof typeof KIND_TEXT]?.label ?? p.kind}
                    </span>
                    <span className="truncate text-xs text-ink-muted">
                      {clockText(Date.parse(entry.doc.deviceTime), digits)} · {p.reason}
                    </span>
                  </span>
                  <Money minor={p.amountMinor} currency={p.currency} className="font-semibold" />
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      entry.status === 'confirmed' ? 'text-success-ink' : 'text-warning-ink',
                    )}
                  >
                    {entry.status === 'confirmed' ? 'أُرسل' : 'بانتظار الإرسال'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
