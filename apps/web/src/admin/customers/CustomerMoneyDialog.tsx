import { useState } from 'react';
import {
  CUSTOMER_PAYMENT_LABEL,
  CUSTOMER_PAYMENT_METHODS,
  toMinor,
  type CustomerMoneyResult,
  type CustomerPaymentMethod,
} from '@serva/core';
import { Alert, Button, Dialog, Money, PrintIcon, Select, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { openDebt, receivePayment } from './api';

/**
 * The paper a payment prints on, and the opening debt's: «سند قبض», in the store's name, with what
 * the customer owed before and owes after.
 */
export function MoneyVoucher({ result, store }: { result: CustomerMoneyResult; store: string }) {
  const payment = result.kind === 'payment';
  return (
    <div className="flex flex-col gap-4 p-6 text-sm text-ink" dir="rtl">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <p className="text-lg font-bold">{store}</p>
        <div className="text-end">
          <p className="text-xl font-bold">{payment ? 'سند قبض' : 'سند رصيد افتتاحي'}</p>
          <p>
            <bdi className="num">{result.number}</bdi> · <bdi className="num">{result.date}</bdi>
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
        <dt className="font-semibold">{payment ? 'استلمنا من' : 'على الزبون'}</dt>
        <dd>{result.customerName}</dd>
        <dt className="font-semibold">المبلغ</dt>
        <dd className="text-lg font-bold">
          <Money minor={result.amountMinor} currency={result.baseCurrency} />
        </dd>
        {result.method ? (
          <>
            <dt className="font-semibold">طريقة الدفع</dt>
            <dd>
              {CUSTOMER_PAYMENT_LABEL[result.method]}
              {result.reference ? (
                <>
                  {' · '}
                  <bdi className="num">{result.reference}</bdi>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {result.note ? (
          <>
            <dt className="font-semibold">ملاحظة</dt>
            <dd>{result.note}</dd>
          </>
        ) : null}
        <dt className="font-semibold">كان عليه</dt>
        <dd>
          <Money minor={result.balanceBeforeMinor} currency={result.baseCurrency} />
        </dd>
        <dt className="font-semibold">صار عليه</dt>
        <dd>
          <Money minor={result.balanceAfterMinor} currency={result.baseCurrency} />
        </dd>
      </dl>
      <div className="mt-8 flex justify-between border-t border-line pt-3">
        <span>توقيع المستلم</span>
        <span>توقيع الزبون</span>
      </div>
    </div>
  );
}

/**
 * «استلم دفعة» and «سجّل دين افتتاحي» from the admin: the amount, how it was paid, a note and the
 * day. A payment posts the receipt (the safe or the method's account against what the customer
 * owes) and prints its voucher; an opening debt is what the customer owed before the system.
 */
export function CustomerMoneyDialog({
  kind,
  customer,
  onDone,
  onCancel,
}: {
  kind: 'payment' | 'opening';
  customer: { id: string; name: string };
  /** Called once the posted result is shown and closed */
  onDone: (result: CustomerMoneyResult) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const today = isoDay(Date.now(), me.tenant.timezone);
  const payment = kind === 'payment';
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CustomerPaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CustomerMoneyResult | null>(null);
  // One id per form, so a retry after a lost answer posts the payment once.
  const [requestId] = useState(() => crypto.randomUUID());
  const { paper, print } = usePrint();

  let amountMinor: number | null = null;
  try {
    amountMinor = amount.trim() ? toMinor(amount, base) : null;
  } catch {
    amountMinor = null;
  }
  const needsReference = payment && method !== 'cash';
  const ready = amountMinor !== null && amountMinor > 0 && (!needsReference || reference.trim() !== '');

  async function submit() {
    if (!ready || amountMinor === null) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      setResult(
        payment
          ? await receivePayment(customer.id, {
              id: requestId,
              amountMinor,
              method,
              reference: reference.trim() || null,
              note: note.trim() || null,
              date,
            })
          : await openDebt(customer.id, { amountMinor, date }),
      );
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onDone(result);
        }}
        title={payment ? 'سُجّلت الدفعة' : 'سُجّل الدين الافتتاحي'}
        description={`${payment ? 'سند القبض' : 'القيد'} ${result.number}: ${customer.name}.`}
      >
        <div className="flex flex-col gap-4">
          <p className="text-ink">
            صار على الزبون <Money minor={result.balanceAfterMinor} currency={result.baseCurrency} />.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('A4')}>
              اطبع السند
            </Button>
            <Button onClick={() => onDone(result)}>تم</Button>
          </div>
        </div>
        {paper ? (
          <PrintSheet paper={paper}>
            <MoneyVoucher result={result} store={me.tenant.name} />
          </PrintSheet>
        ) : null}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={payment ? `استلام دفعة من ${customer.name}` : `دين افتتاحي على ${customer.name}`}
      description={
        payment
          ? 'تُسجَّل في الخزنة أو حساب الطريقة، وتُنقص ما عليه، ويُطبع لها سند قبض.'
          : 'ما كان عليه قبل البدء بالنظام. يُقيَّد مقابل الأرصدة الافتتاحية، ويقدر المالك عكسه من القيود.'
      }
    >
      <form
        aria-label={payment ? 'استلام دفعة' : 'دين افتتاحي'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && Object.keys(fields).length === 0 ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label={`المبلغ (${base === 'SYP' ? 'ل.س' : base})`}
          inputMode="decimal"
          dir="ltr"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={fields.amountMinor ?? (amount.trim() && amountMinor === null ? 'مبلغ غير صالح' : undefined)}
        />
        {payment ? (
          <>
            <Select
              label="طريقة الدفع"
              value={method}
              onChange={(e) => setMethod(e.target.value as CustomerPaymentMethod)}
              error={fields.method}
            >
              {CUSTOMER_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CUSTOMER_PAYMENT_LABEL[m]}
                </option>
              ))}
            </Select>
            {needsReference ? (
              <TextField
                label="رقم الحوالة أو العملية"
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                error={fields.reference}
                maxLength={64}
              />
            ) : null}
          </>
        ) : null}
        <DateField
          label="التاريخ"
          value={date}
          required
          max={payment ? today : undefined}
          onChange={setDate}
          error={fields.date}
        />
        {payment ? (
          <TextField
            label="ملاحظة"
            hint="اختياري"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={fields.note}
            maxLength={200}
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving} disabled={!ready}>
            {payment ? 'سجّل الدفعة' : 'سجّل الدين'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
