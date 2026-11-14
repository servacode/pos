import { useCallback, useEffect, useState } from 'react';
import { RENTAL_RATE_LABELS, RENTAL_RATE_UNITS, type RentalRateUnit } from '@serva/core/rentals';
import type { GiftVoucherPayload } from '@serva/core/contracts/documents';
import type { MaintenanceContract } from '@serva/core/contracts/maintenance';
import type { RentableUnit, Rental } from '@serva/core/contracts/rentals';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  CalendarIcon,
  EmptyState,
  IconChip,
  Money,
  PrintIcon,
  SegmentedControl,
  Select,
  SerialIcon,
  Skeleton,
  TextField,
  useDigits,
} from '@serva/ui';
import { dayText, isoDay } from '../../lib/dates';
import { PrintableRentalContract } from '../../lib/RentalContract';
import { call } from '../alterations/api';
import type { Catalog } from '../catalog';
import { FlowHeader } from '../FlowParts';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import type { OpenShift } from '../shift/shift';
import type { StaffSession } from '../staff/staff';

/** Today plus `days`, YYYY-MM-DD in the browser's calendar */
const inDays = (days: number, now: number) => new Date(now + days * 86_400_000).toLocaleDateString('en-CA');

/**
 * «التأجير» (03 › الأدوات الطبية): a device of a rentable product goes out against its serial number
 * with the renter, the day it is due, a rate per day, week or month and a deposit (taken as a gift
 * voucher, spent when the device is back). The contract prints on A4. The return sells the rent as a
 * «إيجار» line less the deposit; «عقود الصيانة» lists the contracts waiting to be billed the same way.
 */
export function RentalsScreen({
  catalog,
  session,
  shift,
  onBack,
  onReturn,
  onBill,
}: {
  catalog: Catalog;
  session: StaffSession;
  shift: OpenShift;
  onBack: () => void;
  /** Opens the sale of the rent (what is left after the deposit); false when it cannot be sold here */
  onReturn: (rental: Rental) => boolean;
  /** Opens the sale of a maintenance contract's price; false when it cannot be sold here */
  onBill: (contract: MaintenanceContract) => boolean;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const base = settings.baseCurrency;
  const token = pos.device.token;
  const [tab, setTab] = useState<'rentals' | 'maintenance'>('rentals');
  const [rentals, setRentals] = useState<Rental[] | null>(null);
  const [contracts, setContracts] = useState<MaintenanceContract[] | null>(null);
  const [units, setUnits] = useState<RentableUnit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [find, setFind] = useState('');
  const [unit, setUnit] = useState<RentableUnit | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [due, setDue] = useState(() => inDays(7, pos.now()));
  const [rateUnit, setRateUnit] = useState<RentalRateUnit>('day');
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<Rental | null>(null);

  const load = useCallback(async () => {
    if (!token || !pos.online()) {
      setError('التأجير يحتاج اتصالاً بالخادم.');
      setRentals([]);
      setContracts([]);
      return;
    }
    const [r, m] = await Promise.all([
      call<{ items: Rental[] }>('/v1/device/rentals', token, pos.fetch),
      call<{ items: MaintenanceContract[] }>('/v1/device/maintenance', token, pos.fetch),
    ]);
    setRentals(r.kind === 'ok' ? r.body.items : []);
    setContracts(m.kind === 'ok' ? m.body.items : []);
    setError(r.kind === 'refused' ? r.message : r.kind === 'network' ? 'تعذّر الوصول إلى الخادم.' : null);
  }, [pos, token]);
  useEffect(() => {
    void load();
  }, [load]);

  // Pieces free to go out, matching what was typed
  useEffect(() => {
    if (!token || !pos.online()) return;
    let alive = true;
    const timer = setTimeout(() => {
      void call<{ items: RentableUnit[] }>(
        `/v1/device/rentals/units?q=${encodeURIComponent(find.trim())}`,
        token,
        pos.fetch,
      ).then((a) => {
        if (alive) setUnits(a.kind === 'ok' ? a.body.items : []);
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [find, pos, token, rentals]);

  /** The contract is in the page once React has drawn it: then the printer opens */
  function print(r: Rental) {
    setSheet(r);
    setTimeout(() => window.print(), 0);
  }

  const rateMinor = rate.trim() ? parseAmount(rate, base) : null;
  const depositMinor = deposit.trim() ? parseAmount(deposit, base) : 0;
  const today = isoDay(pos.now(), settings.timezone);
  const ready =
    unit &&
    name.trim() &&
    phone.trim() &&
    rateMinor !== null &&
    rateMinor > 0 &&
    depositMinor !== null &&
    due >= today;

  async function create() {
    if (!ready || !token || !unit || rateMinor === null || depositMinor === null) return;
    setSaving(true);
    setError(null);
    // A deposit is taken as a gift voucher in cash (an existing document); its code goes on the contract
    let depositVoucher: string | null = null;
    if (depositMinor > 0) {
      try {
        const payload: GiftVoucherPayload = {
          shiftId: shift.id,
          cashierId: session.userId,
          currency: base,
          amountMinor: depositMinor,
          method: 'cash',
          reference: null,
          forName: name.trim(),
        };
        const entry = await pos.save({
          type: 'gift_voucher',
          payload: payload as unknown as Record<string, unknown>,
          businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
          engineVersion: PRICING_ENGINE_VERSION,
        });
        depositVoucher = entry.doc.number;
      } catch {
        setSaving(false);
        setError('لم يُسجَّل العربون. لم يُحفظ شيء، حاول مرة أخرى.');
        return;
      }
    }
    const answer = await call<Rental>('/v1/device/rentals', token, pos.fetch, {
      serial: unit.serial,
      customerName: name.trim(),
      phone: phone.trim(),
      expectedReturn: due,
      rateUnit,
      rateMinor,
      depositMinor,
      depositVoucher,
      note: null,
    });
    setSaving(false);
    if (answer.kind !== 'ok') {
      setError(
        depositVoucher
          ? `لم يُسجَّل التأجير: لا اتصال بالخادم. العربون سُجّل على القسيمة ${depositVoucher}، اكتبها للزبون.`
          : answer.kind === 'refused'
            ? answer.message
            : 'لم يُسجَّل التأجير: لا اتصال بالخادم.',
      );
      return;
    }
    print(answer.body);
    setUnit(null);
    setFind('');
    setName('');
    setPhone('');
    setRate('');
    setDeposit('');
    void load();
  }

  function giveBack(r: Rental) {
    if (!onReturn(r))
      setError('لا يوجد صنف خدمة اسمه «إيجار» لبيع الأجرة به. أضفه من الأصناف ثم أعد المحاولة.');
  }

  function bill(c: MaintenanceContract) {
    if (!onBill(c)) setError('لا يوجد صنف خدمة اسمه «عقد صيانة». أضفه من الأصناف ثم أعد المحاولة.');
  }

  return (
    <div className="flex w-full max-w-7xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<SerialIcon size={24} />}
        title="التأجير"
        description="أجهزة تُسلَّم برقمها التسلسلي بعربون، وتُباع الأجرة عند الإرجاع. وعقود الصيانة التي تنتظر التحصيل."
      />
      <SegmentedControl
        label="القسم"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: 'rentals', label: 'التأجير' },
          { value: 'maintenance', label: 'عقود الصيانة' },
        ]}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {tab === 'rentals' ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <section
            aria-label="تأجير جديد"
            className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1"
          >
            <div className="flex items-center gap-3">
              <IconChip>
                <AddIcon />
              </IconChip>
              <h2 className="text-lg font-semibold text-ink">تأجير جديد</h2>
            </div>
            {unit ? (
              <div className="flex items-center justify-between gap-3 rounded-control bg-surface-muted px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-ink">{unit.item}</span>
                  <bdi dir="ltr" className="num self-start text-sm text-ink-muted">
                    {unit.serial}
                  </bdi>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setUnit(null)}>
                  غيّر
                </Button>
              </div>
            ) : (
              <>
                <TextField
                  label="الجهاز: الرقم التسلسلي أو الاسم"
                  dir="ltr"
                  value={find}
                  onChange={(e) => setFind(e.target.value.slice(0, 40))}
                  inputClassName="num"
                />
                <ul aria-label="الأجهزة المتاحة" className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {units.map((u) => (
                    <li key={u.serial}>
                      <button
                        type="button"
                        onClick={() => setUnit(u)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-control px-2 text-start hover:bg-surface-muted"
                      >
                        <span className="truncate font-semibold text-ink">{u.item}</span>
                        <bdi dir="ltr" className="num text-sm text-ink-muted">
                          {u.serial}
                        </bdi>
                      </button>
                    </li>
                  ))}
                  {units.length === 0 ? (
                    <li className="py-3 text-center text-sm text-ink-muted">
                      لا جهاز متاح للتأجير بهذا الرقم. فعّل «قابل للتأجير» في صفحة الصنف.
                    </li>
                  ) : null}
                </ul>
              </>
            )}
            <TextField
              label="اسم المستأجر"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
            />
            <TextField
              label="جوال المستأجر"
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.slice(0, 20))}
              inputClassName="num"
            />
            <TextField
              label="الإرجاع المتوقع"
              type="date"
              dir="ltr"
              value={due}
              hint={due ? dayText(due, digits) : undefined}
              onChange={(e) => setDue(e.target.value)}
              inputClassName="num"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="الأجرة"
                value={rateUnit}
                onChange={(e) => setRateUnit(e.target.value as RentalRateUnit)}
              >
                {RENTAL_RATE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {RENTAL_RATE_LABELS[u]}
                  </option>
                ))}
              </Select>
              <TextField
                label="المبلغ"
                dir="ltr"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value.slice(0, 12))}
                error={rateMinor === null && rate.trim() ? 'مبلغ غير صحيح' : undefined}
                inputClassName="num"
              />
            </div>
            <TextField
              label="العربون (اختياري)"
              hint="يُؤخذ نقداً على قسيمة، ويُخصم من الأجرة عند الإرجاع"
              dir="ltr"
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value.slice(0, 12))}
              error={depositMinor === null ? 'مبلغ غير صحيح' : undefined}
              inputClassName="num"
            />
            <Button
              size="lg"
              fullWidth
              loading={saving}
              disabled={!ready}
              icon={<PrintIcon />}
              onClick={() => void create()}
            >
              سجّل واطبع العقد
            </Button>
          </section>
          <section aria-label="الأجهزة المؤجَّرة" className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-ink">الأجهزة عند الزبائن</h2>
              {rentals && rentals.length > 0 ? (
                <Badge>
                  <span className="num">{rentals.length}</span>
                </Badge>
              ) : null}
            </div>
            {rentals === null ? <Skeleton className="h-32 w-full rounded-card" /> : null}
            {rentals && rentals.length === 0 && !error ? (
              <EmptyState
                icon={SerialIcon}
                title="لا أجهزة مؤجَّرة."
                description="اختر جهازاً من القائمة وسجّل المستأجر، فيظهر هنا حتى يرجع."
              />
            ) : null}
            <ul className="flex flex-col gap-3">
              {(rentals ?? []).map((r) => (
                <li
                  key={r.id}
                  aria-label={`التأجير ${r.number}`}
                  className={
                    r.overdue
                      ? 'flex flex-col gap-3 rounded-card border border-danger/40 bg-danger-soft/40 p-4 shadow-e1'
                      : 'flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-e1'
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <bdi dir="ltr" className="num self-start text-sm font-semibold text-ink-muted">
                        {r.number}
                      </bdi>
                      <span className="truncate text-lg font-semibold text-ink">{r.customerName}</span>
                    </span>
                    {r.overdue ? <Badge tone="danger">متأخر</Badge> : <Badge tone="info">عند الزبون</Badge>}
                  </div>
                  <p className="text-ink">
                    {r.item}{' '}
                    <bdi dir="ltr" className="num text-ink-muted">
                      {r.serial}
                    </bdi>
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <CalendarIcon size={16} />
                      الإرجاع{' '}
                      <span className="font-semibold text-ink">{dayText(r.expectedReturn, digits)}</span>
                    </span>
                    <span>
                      المستحق حتى اليوم{' '}
                      <Money minor={r.chargeMinor} currency={r.currency} className="font-semibold text-ink" />
                    </span>
                  </div>
                  {r.depositMinor > 0 ? (
                    <p className="text-sm text-ink-muted">
                      عربون <Money minor={r.depositMinor} currency={r.currency} />
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<PrintIcon />} onClick={() => print(r)}>
                      اطبع العقد
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => giveBack(r)}>
                      استلام الجهاز
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <section aria-label="عقود الصيانة" className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">عقود تنتظر التحصيل</h2>
          {contracts === null ? <Skeleton className="h-32 w-full rounded-card" /> : null}
          {contracts && contracts.length === 0 && !error ? (
            <EmptyState
              icon={SerialIcon}
              title="لا عقود تنتظر التحصيل."
              description="العقود الجديدة تُضاف من «عقود الصيانة» في لوحة الإدارة، وتظهر هنا حتى يُباع سعرها."
            />
          ) : null}
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {(contracts ?? []).map((c) => (
              <li
                key={c.id}
                aria-label={`العقد ${c.number}`}
                className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-e1"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <bdi dir="ltr" className="num self-start text-sm font-semibold text-ink-muted">
                      {c.number}
                    </bdi>
                    <span className="truncate text-lg font-semibold text-ink">{c.customerName}</span>
                  </span>
                  <Money minor={c.priceMinor} currency={c.currency} className="font-semibold text-ink" />
                </div>
                <p className="text-sm text-ink-muted">
                  {c.devices.length} جهاز · من {dayText(c.startDate, digits)} إلى {dayText(c.endDate, digits)}
                </p>
                <Button size="sm" onClick={() => bill(c)}>
                  حصّل سعر العقد
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sheet ? <PrintableRentalContract rental={sheet} store={settings.storeName} /> : null}
    </div>
  );
}
