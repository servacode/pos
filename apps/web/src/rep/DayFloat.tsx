import { useMemo, useRef, useState } from 'react';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import { Alert, Button, CashIcon, Money, TextField } from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import { ChoiceGroup, OptionChip } from '../pos/FlowParts';
import { parseAmount } from '../pos/pay/payment';
import { usePos } from '../pos/services';
import { totalCount } from '../pos/shift/DrawerCounter';
import {
  cashMovementPayload,
  LAST_CLOSED_KEY,
  shiftKey,
  shiftOpenPayload,
  type OpenShift,
} from '../pos/shift/shift';
import { drawerCurrencies } from '../pos/shift/ShiftScreens';
import { ManagerCode } from '../pos/staff/ManagerCode';
import { staffRoster, type StaffMember, type StaffSession } from '../pos/staff/staff';
import { FLOAT_REASON } from './day';

/**
 * «افتح الوردية» for the rep (round 35 › D5). His shift opens at 0: nothing is counted into it. The
 * float the manager hands him comes out of the safe as the till's own pay-in («إيداع في الدرج») with
 * the manager's code, so the safe goes down and his drawer goes up through today's posting, and the
 * shift's expected cash includes it. The screen says «استلمت عهدة …» when it is saved.
 */

/** The people whose code may approve here: the owner and the managers (a rep's phone takes no one else's) */
export function floatApprovers(catalog: Catalog, branchCode: string | null): StaffMember[] {
  const roster = staffRoster(catalog.staff, branchCode);
  const keys = new Map(catalog.staff.roles.map((r) => [r.id, r.key]));
  const managers = new Set(
    catalog.staff.user_roles
      .filter((ur) => ['owner', 'manager'].includes(keys.get(ur.roleId) ?? ''))
      .map((ur) => ur.userId),
  );
  return roster.filter((m) => managers.has(m.id));
}

export function RepShiftOpen({
  session,
  catalog,
  onOpened,
}: {
  session: StaffSession;
  catalog: Catalog;
  /** The shift is open and the float (per currency, maybe empty) is saved */
  onOpened: (shift: OpenShift, float: Record<string, number>) => void;
}) {
  const pos = usePos();
  const settings = catalog.settings!;
  const currencies = drawerCurrencies(catalog);
  const approvers = useMemo(
    () => floatApprovers(catalog, pos.device.branchCode),
    [catalog, pos.device.branchCode],
  );
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>(currencies[0]!);
  const [amount, setAmount] = useState('');
  const [approving, setApproving] = useState(false);
  const [given, setGiven] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const businessDate = () => businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff);

  async function openAtZero() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const mode = settings.shiftMode;
      const key = shiftKey(mode, session.userId);
      const existing = await pos.local.get<OpenShift>(key);
      if (existing) {
        setShift(existing);
        return;
      }
      const lastClosed = await pos.local.get<string>(LAST_CLOSED_KEY);
      const payload = shiftOpenPayload(session.userId, mode, lastClosed, currencies.map(totalCount));
      const entry = await pos.save({
        type: 'shift_open',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const opened: OpenShift = {
        key,
        id: entry.doc.id,
        number: entry.doc.number!,
        openedBy: session.userId,
        openedByName: session.fullName,
        openedAt: pos.now(),
        mode: payload.mode,
        opening: payload.opening,
      };
      await pos.local.set(key, opened);
      setShift(opened);
    } catch {
      setError('لم تُفتح الوردية. لم يُحفظ شيء، حاول مرة أخرى.');
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  }

  const minor = parseAmount(amount, currency);

  async function record(approval: Parameters<typeof cashMovementPayload>[0]['approval']) {
    setApproving(false);
    setError(null);
    if (!shift || !minor || minor <= 0) return;
    try {
      const payload = cashMovementPayload({
        shiftId: shift.id,
        kind: 'pay_in',
        currency,
        amountMinor: minor,
        baseCurrency: settings.baseCurrency,
        rates: catalog.rates,
        reason: FLOAT_REASON,
        reference: null,
        performedBy: session.userId,
        approval,
      });
      await pos.save({
        type: 'cash_movement',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      setGiven((g) => ({ ...g, [currency]: (g[currency] ?? 0) + minor }));
      setAmount('');
      setAdding(false);
    } catch {
      setError('لم تُسجَّل العهدة. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  // Step 1: the shift opens empty
  if (!shift) {
    return (
      <section aria-label="افتح الوردية" className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <CashIcon className="shrink-0 text-brand-ink" />
          <h2 className="text-lg font-bold text-ink">افتح الوردية</h2>
        </div>
        <p className="text-sm text-ink-muted">
          تُفتح ورديتك ودرجك فارغ. العهدة التي يسلّمك إياها المدير تُسجَّل بعد ذلك برمزه، فلا تعدّ شيئاً الآن.
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button size="lg" fullWidth icon={<CashIcon />} loading={saving} onClick={() => void openAtZero()}>
          افتح الوردية
        </Button>
      </section>
    );
  }

  const givenList = Object.entries(given);
  // Step 3: the float is saved
  if (!adding) {
    return (
      <section aria-label="العهدة" className="flex flex-col gap-4">
        <Alert tone="success">
          <span className="flex flex-col gap-1">
            {givenList.map(([c, m]) => (
              <span key={c} className="font-bold">
                استلمت عهدة <Money minor={m} currency={c as CurrencyCode} />
              </span>
            ))}
          </span>
        </Alert>
        <p className="text-sm text-ink-muted">
          خرجت العهدة من الخزنة إلى درجك باسم المدير الذي وافق، وتدخل في حساب نقدك عند إغلاق الوردية.
        </p>
        {currencies.length > 1 ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            عهدة بعملة أخرى
          </Button>
        ) : null}
        <Button size="lg" fullWidth onClick={() => onOpened(shift, given)}>
          ابدأ جولتك
        </Button>
      </section>
    );
  }

  // Step 2: the float, with the manager's code
  return (
    <section aria-label="العهدة" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <CashIcon className="shrink-0 text-brand-ink" />
        <h2 className="text-lg font-bold text-ink">عهدة اليوم</h2>
      </div>
      <p className="text-sm text-ink-muted">
        الوردية مفتوحة ودرجك فارغ. اكتب النقد الذي سلّمك إياه المدير، ثم يكتب رمزه. تُسجَّل بإيداع من الخزنة.
      </p>
      {currencies.length > 1 ? (
        <ChoiceGroup label="الدرج" className="grid grid-cols-2 gap-2">
          {currencies.map((c) => (
            <OptionChip
              key={c}
              selected={currency === c}
              onClick={() => {
                setCurrency(c);
                setAmount('');
              }}
            >
              {c === 'SYP' ? 'درج الليرة' : c === 'USD' ? 'درج الدولار' : c}
            </OptionChip>
          ))}
        </ChoiceGroup>
      ) : null}
      <TextField
        label="مبلغ العهدة"
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
        endAdornment={<span className="me-4 shrink-0 text-base">{CURRENCIES[currency].symbolAr}</span>}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {approving ? (
        <ManagerCode
          staff={approvers}
          permission="cash.move"
          reason="العهدة تخرج من الخزنة إلى درجك، فتحتاج رمز مدير حاضر. تُسجَّل باسمه."
          onApproved={(approval) => void record(approval)}
          onCancel={() => setApproving(false)}
        />
      ) : (
        <>
          <Button size="lg" fullWidth onClick={() => setApproving(true)} disabled={!minor || minor <= 0}>
            سجّل العهدة{minor ? ' · ' : ''}
            {minor ? <Money minor={minor} currency={currency} /> : null}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => onOpened(shift, given)}>
            {givenList.length > 0 ? 'تم، ابدأ جولتك' : 'لا عهدة اليوم، ابدأ جولتك'}
          </Button>
        </>
      )}
    </section>
  );
}
