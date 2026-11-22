import { useEffect, useState } from 'react';
import {
  rateText,
  type PurchaseCurrencyCode,
  type SupplierListResponse,
  type SupplierRow,
} from '@serva/core';
import {
  Alert,
  Button,
  CashIcon,
  ChequeIcon,
  ChoiceCard,
  Dialog,
  Money,
  RadioGroup,
  Select,
  Switch,
  TextField,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { DateField } from '../../lib/DateField';
import { moneyOf, newDocumentId, paySupplier, storeToday } from './api';
import { SafeWarning } from './SafeWarning';
import { moneyText } from './packLines';
import { isAdvance, paymentProblem } from './supplierRules';
import { useUsdRate, usdToBase } from '../../lib/useUsdRate';
import { CurrencyTerms } from './CurrencyTerms';
import { useSaving, dollarsOnly } from './PurchasesShared';

export function PaymentForm({
  suppliers,
  initialSupplierId,
  initialAmountMinor,
  base,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  /** An amount to start with (the open amount of a due invoice) */
  initialAmountMinor?: number;
  /** The supplier the window opens on (from a supplier's row), else the first one that is owed */
  initialSupplierId?: string;
  base: SupplierListResponse['baseCurrency'];
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const todayDay = storeToday(me.tenant.timezone);
  // The payment's own id, kept until it is saved: a retry never pays the supplier twice
  const [docId] = useState(newDocumentId);
  const owing = suppliers.filter((x) => x.balanceMinor > 0);
  const [supplierId, setSupplierId] = useState(
    (suppliers.find((x) => x.id === initialSupplierId) ?? owing[0] ?? suppliers[0])?.id ?? '',
  );
  const [amount, setAmount] = useState(initialAmountMinor ? moneyText(initialAmountMinor) : '');
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [date, setDate] = useState(todayDay);
  const [bank, setBank] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [dueDate, setDueDate] = useState(todayDay);
  const chequeReady = method !== 'cheque' || (bank.trim() !== '' && chequeNo.trim() !== '' && dueDate !== '');
  const [advance, setAdvance] = useState(false);
  const s = useSaving();
  // A payment in dollars (decision 11): from the dollar safe, at the rate of the day; the difference from the
  // rate the debt was booked at is the exchange difference
  const known = useUsdRate();
  const storeRate = base === 'SYP' ? known : null;
  const [currency, setCurrency] = useState<PurchaseCurrencyCode>(() =>
    dollarsOnly(suppliers.find((x) => x.id === supplierId)) ? 'USD' : 'SYP',
  );
  const [rate, setRate] = useState('');
  useEffect(() => {
    if (storeRate) setRate((typed) => typed || storeRate);
  }, [storeRate]);
  const usd = currency === 'USD';
  const rateOk = !usd || (/^\d{1,7}(\.\d{1,4})?$/.test(rateText(rate)) && Number(rateText(rate)) > 0);
  const minor = moneyOf(amount);
  const supplier = suppliers.find((x) => x.id === supplierId);
  const problem = paymentProblem(amount, minor);
  // What is owed in the currency being paid: the dollars, or the pounds that are not dollars' book value
  const owedIn = !supplier
    ? 0
    : usd
      ? (supplier.usdBalanceMinor ?? 0)
      : supplier.balanceMinor - (supplier.usdBookMinor ?? 0);
  const over = minor !== null && supplier ? isAdvance(minor, owedIn) : false;
  const exchange = (() => {
    if (!usd || !supplier || !minor || !rateOk) return null;
    const owedUsd = supplier.usdBalanceMinor ?? 0;
    const book = supplier.usdBookMinor ?? 0;
    const paid = usdToBase(minor, base, rateText(rate));
    if (paid === null) return null;
    const settled =
      owedUsd <= 0
        ? paid
        : minor >= owedUsd
          ? book + (usdToBase(minor - owedUsd, base, rateText(rate)) ?? 0)
          : Math.round((book * minor) / owedUsd);
    return { paid, difference: paid - settled };
  })();
  /** A supplier owed in dollars only is paid in dollars: the form starts there */
  function chooseSupplier(id: string) {
    setSupplierId(id);
    setAdvance(false);
    const onlyDollars = dollarsOnly(suppliers.find((x) => x.id === id));
    setCurrency(onlyDollars ? 'USD' : 'SYP');
    if (onlyDollars && method === 'cheque') setMethod('cash');
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="دفعة لمورد"
      description="تنقص ما له عليك بقدرها، وتخرج من الخزنة أو من البنك."
    >
      <form
        aria-label="دفعة لمورد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!minor || (over && !advance) || !chequeReady || !rateOk) return;
          void s
            .run(() =>
              paySupplier({
                id: docId,
                supplierId,
                date,
                amountMinor: minor,
                method: method === 'cheque' ? 'bank' : method,
                ...(usd ? { currency: 'USD' as const, rate: rateText(rate) } : {}),
                ...(method === 'cheque'
                  ? { cheque: { bank: bank.trim(), number: chequeNo.trim(), dueDate } }
                  : {}),
                note: null,
                ...(over ? { advance: true } : {}),
              }),
            )
            .then((r) => r && onSaved(r.number));
        }}
      >
        {s.error ? <Alert tone="error">{s.error}</Alert> : null}
        <Select
          label="المورد"
          value={supplierId}
          onChange={(e) => chooseSupplier(e.target.value)}
          hint={
            supplier ? (
              <>
                له عليك الآن <Money minor={supplier.balanceMinor} currency={base} className="font-semibold" />
                {supplier.usdBalanceMinor ? (
                  <>
                    {' '}
                    (منه <Money minor={supplier.usdBalanceMinor} currency="USD" className="font-semibold" />)
                  </>
                ) : null}
              </>
            ) : undefined
          }
        >
          {suppliers.map((sup) => (
            <option key={sup.id} value={sup.id}>
              {sup.name}
            </option>
          ))}
        </Select>
        <CurrencyTerms
          label="عملة الدفعة"
          currency={currency}
          onCurrency={(next) => {
            setCurrency(next);
            setAdvance(false);
            if (next === 'USD' && method === 'cheque') setMethod('cash');
          }}
          rate={rate}
          onRate={setRate}
          storeRate={storeRate}
          error={s.fields.rate ?? s.fields.currency}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={usd ? 'المبلغ بالدولار' : 'المبلغ بالليرة'}
            inputMode="decimal"
            autoComplete="off"
            dir="ltr"
            autoFocus
            value={amount}
            inputClassName="num"
            onChange={(e) => {
              setAmount(e.target.value);
              setAdvance(false);
            }}
            error={problem ?? s.fields.amountMinor}
          />
          <DateField label="التاريخ" value={date} onChange={setDate} required />
        </div>
        {exchange && exchange.difference !== 0 ? (
          <Alert tone={exchange.difference > 0 ? 'warning' : 'info'}>
            تدفع <Money minor={exchange.paid} currency={base} className="font-semibold" /> بسعر اليوم، وكان
            الدين مسجّلاً {exchange.difference > 0 ? 'بأقل منها: خسارة' : 'بأكثر منها: ربح'} صرف{' '}
            <Money minor={Math.abs(exchange.difference)} currency={base} className="font-semibold" /> تُسجَّل
            في «فروقات صرف محققة».
          </Alert>
        ) : null}
        {over ? (
          <Alert tone="warning">
            المبلغ أكبر مما للمورد عليك. الفرق يبقى دفعة مقدّمة له عندك، فيصير رصيده لك عنده.
            <Switch label="نعم، هذه دفعة مقدّمة" checked={advance} onCheckedChange={setAdvance} />
          </Alert>
        ) : null}
        <RadioGroup legend="من أين">
          <div className="grid grid-cols-1 gap-2">
            {(usd ? (['cash', 'bank'] as const) : (['cash', 'bank', 'cheque'] as const)).map((m) => (
              <ChoiceCard
                key={m}
                name="supplier-payment-method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                title={
                  m === 'cash' ? (usd ? 'من خزنة الدولار' : 'من الخزنة') : m === 'bank' ? 'من البنك' : 'بشيك'
                }
                leading={m === 'cash' ? <CashIcon /> : <ChequeIcon />}
              />
            ))}
          </div>
        </RadioGroup>
        <SafeWarning active={method === 'cash' && !usd} amountMinor={minor} />
        {method === 'cheque' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="البنك" value={bank} onChange={(e) => setBank(e.target.value)} required />
            <TextField
              label="رقم الشيك"
              dir="ltr"
              inputMode="numeric"
              value={chequeNo}
              onChange={(e) => setChequeNo(e.target.value)}
              inputClassName="num"
              required
            />
            <DateField
              label="تاريخ الاستحقاق"
              value={dueDate}
              onChange={setDueDate}
              required
              className="sm:col-span-2"
            />
            {dueDate > todayDay ? (
              <Alert tone="info" className="sm:col-span-2">
                الشيك مؤجّل: ينقص من دين المورد الآن، ويبقى المبلغ في «شيكات مستحقة الدفع» ولا يخرج من البنك
                حتى تسجّله «صُرف» من صفحة الشيكات.
              </Alert>
            ) : null}
            {dueDate !== '' && dueDate < todayDay ? (
              <Alert tone="warning" className="sm:col-span-2">
                تاريخ الاستحقاق مضى. تأكّد من التاريخ قبل أن تسجّل الدفعة.
              </Alert>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button
            type="submit"
            loading={s.saving}
            disabled={!minor || (over && !advance) || !chequeReady || !rateOk}
          >
            سجّل الدفعة
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
