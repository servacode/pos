import type { ReactNode } from 'react';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { Quotation } from '@serva/core/contracts/quotations';
import { formatQuantity, Money, useDigits } from '@serva/ui';
import { METHOD_TEXT } from '../../admin/sales/labels';
import { dayText, zonedClock } from '../dates';

/**
 * The A4 documents a store hands a customer: «فاتورة» or «فاتورة ضريبية» (when the store has a tax
 * number), «إشعار تسليم» and «عرض سعر». One layout for the three, so the store's block, the customer's
 * block, the lines, the totals and the signature lines look the same on each. They print through
 * PrintSheet (lib/print.tsx) and read only the data they are given.
 */

export interface A4Store {
  name: string;
  taxNumber: string | null;
  branchName: string | null;
  address: string | null;
  phone: string | null;
  footer: string | null;
}

export interface A4Customer {
  name: string;
  phone?: string | null;
  taxNumber?: string | null;
  address?: string | null;
}

export interface A4SaleData {
  store: A4Store;
  /** INV number */
  number: string;
  deviceTime: string;
  timezone: string;
  customer: A4Customer | null;
  payload: SalePayload;
  cashierName: string | null;
  /** The invoice printed again: marked «نسخة» */
  copy?: boolean;
}

/** «فاتورة ضريبية» when the store has a tax number, «فاتورة مبيعات» when not */
export const invoiceTitle = (store: Pick<A4Store, 'taxNumber'>): string =>
  store.taxNumber ? 'فاتورة ضريبية' : 'فاتورة مبيعات';

const cell = 'border border-ink px-1.5 py-1';

function StoreBlock({ store }: { store: A4Store }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-bold">{store.name}</p>
      {store.branchName || store.address ? (
        <p>{[store.branchName, store.address].filter(Boolean).join(' · ')}</p>
      ) : null}
      {store.phone ? (
        <p>
          هاتف <bdi className="num">{store.phone}</bdi>
        </p>
      ) : null}
      {store.taxNumber ? (
        <p>
          الرقم الضريبي <bdi className="num">{store.taxNumber}</bdi>
        </p>
      ) : null}
    </div>
  );
}

function Heading({
  store,
  title,
  number,
  when,
  copy,
  extra,
}: {
  store: A4Store;
  title: string;
  number: string | null;
  when: string;
  copy?: boolean | undefined;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-ink pb-2">
      <StoreBlock store={store} />
      <div className="text-end">
        <p className="text-xl font-bold">{title}</p>
        {copy ? <p className="inline-block border-2 border-ink px-3 font-bold">نسخة</p> : null}
        {number ? (
          <p>
            <bdi dir="ltr" className="num font-bold">
              {number}
            </bdi>
          </p>
        ) : null}
        <p>{when}</p>
        {extra}
      </div>
    </div>
  );
}

/** The customer's name, tax number, address and phone; blank lines to write on when a till does not have them */
function CustomerBlock({ customer, label = 'الزبون' }: { customer: A4Customer | null; label?: string }) {
  const blank = <span className="inline-block min-w-40 border-b border-dotted border-ink">&nbsp;</span>;
  return (
    <div aria-label={`بيانات ${label}`} className="grid grid-cols-2 gap-x-6 gap-y-1 border border-ink p-2">
      <p>
        <strong>{label}:</strong> {customer?.name ?? blank}
      </p>
      <p>
        <strong>الرقم الضريبي:</strong>{' '}
        {customer?.taxNumber ? <bdi className="num">{customer.taxNumber}</bdi> : blank}
      </p>
      <p>
        <strong>العنوان:</strong> {customer?.address || blank}
      </p>
      <p>
        <strong>الهاتف:</strong> {customer?.phone ? <bdi className="num">{customer.phone}</bdi> : blank}
      </p>
    </div>
  );
}

/** «سلّمها / استلمها» and the store's stamp, to sign and stamp by hand */
function Signatures({ left, right }: { left: string; right: string }) {
  const line = <span className="mt-8 block border-b border-ink">&nbsp;</span>;
  return (
    <div aria-label="التوقيعات" className="mt-4 grid grid-cols-3 gap-6 break-inside-avoid">
      <div>
        <p className="font-bold">{left}</p>
        <p className="mt-2">الاسم:</p>
        {line}
        <p className="mt-2">التوقيع والتاريخ:</p>
        {line}
      </div>
      <div>
        <p className="font-bold">{right}</p>
        <p className="mt-2">الاسم:</p>
        {line}
        <p className="mt-2">التوقيع والتاريخ:</p>
        {line}
      </div>
      <div className="grid place-items-center">
        <div className="grid h-28 w-40 place-items-center rounded-full border-2 border-dashed border-ink text-center text-ink-muted">
          مكان الختم
        </div>
      </div>
    </div>
  );
}

/** Every batch a line took from (qty in base units): the allocations, or the single batch of an older till */
export const lineBatches = (
  l: SalePayload['lines'][number],
): { batchNo: string | null; expiry: string | null; qty: number | null }[] => {
  if (l.batches && l.batches.length > 0)
    return l.batches.map((b) => ({ batchNo: b.batchNo ?? null, expiry: b.expiry ?? null, qty: b.qty }));
  if (l.batchNo || l.batchExpiry)
    return [{ batchNo: l.batchNo ?? null, expiry: l.batchExpiry ?? null, qty: null }];
  return [];
};

const batchNote = (l: SalePayload['lines'][number]): string[] => {
  const all = lineBatches(l);
  return all.map((b) =>
    [
      b.batchNo ? `دفعة ${b.batchNo}` : null,
      b.expiry ? `صلاحية ${b.expiry}` : null,
      all.length > 1 && b.qty !== null ? `الكمية ${formatQuantity(b.qty)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
};

/** How the invoice was settled, as a customer reads it */
export function paymentTerms(p: SalePayload): string {
  if (p.payments.length === 0) return '—';
  return [
    ...new Set(
      p.payments.map((x) => (x.method === 'credit' ? 'آجل (على حساب الزبون)' : METHOD_TEXT[x.method])),
    ),
  ].join(' + ');
}

/** «فاتورة» / «فاتورة ضريبية»: lines with their tax, the totals, payment terms and signature lines. */
export function InvoiceA4({ data }: { data: A4SaleData }) {
  const digits = useDigits();
  const p = data.payload;
  const base = p.currency;
  const at = `${dayText(data.deviceTime.slice(0, 10), digits)} ، ${zonedClock(data.deviceTime, data.timezone, digits)}`;
  const title = invoiceTitle(data.store);
  return (
    <div dir="rtl" lang="ar" aria-label="فاتورة A4" className="flex flex-col gap-3 p-2 text-sm text-ink">
      <Heading store={data.store} title={title} number={data.number} when={at} copy={data.copy} />
      <CustomerBlock customer={data.customer} />
      {data.cashierName ? <p>الكاشير: {data.cashierName}</p> : null}
      <table className="w-full border-collapse" aria-label="أصناف الفاتورة">
        <thead>
          <tr className="bg-surface-muted">
            <th className={`${cell} w-8 text-center`}>#</th>
            <th className={`${cell} text-start`}>الصنف</th>
            <th className={`${cell} text-end`}>الكمية</th>
            <th className={`${cell} text-end`}>السعر</th>
            <th className={`${cell} text-end`}>الخصم</th>
            <th className={`${cell} text-end`}>نسبة الضريبة</th>
            <th className={`${cell} text-end`}>الضريبة</th>
            <th className={`${cell} text-end`}>المجموع</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((line, idx) => {
            const notes = [
              ...batchNote(line),
              ...(line.serials && line.serials.length > 0
                ? [`أرقام تسلسلية: ${line.serials.join('، ')}`]
                : []),
            ];
            return (
              <tr key={line.lineNo} className="break-inside-avoid">
                <td className={`${cell} num text-center`}>{idx + 1}</td>
                <td className={cell}>
                  {line.name}
                  {notes.length > 0 ? (
                    <span className="block text-xs text-ink-muted">{notes.join(' · ')}</span>
                  ) : null}
                </td>
                <td className={`${cell} num text-end`}>
                  {formatQuantity(line.qty, digits)}
                  {line.unitName ? ` ${line.unitName}` : ''}
                </td>
                <td className={`${cell} text-end`}>
                  <Money minor={line.unitPriceMinor} currency={base} symbol={false} />
                </td>
                <td className={`${cell} text-end`}>
                  <Money minor={line.priced.lineDiscountMinor} currency={base} symbol={false} />
                </td>
                <td className={`${cell} num text-end`}>{line.taxRateBp / 100}%</td>
                <td className={`${cell} text-end`}>
                  <Money minor={line.priced.taxMinor} currency={base} symbol={false} />
                </td>
                <td className={`${cell} text-end`}>
                  <Money minor={line.priced.totalMinor} currency={base} symbol={false} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="ms-auto flex w-80 flex-col gap-1 break-inside-avoid">
        <div className="flex justify-between">
          <dt>المجموع قبل الضريبة</dt>
          <dd>
            <Money minor={p.totals.netExTaxMinor} currency={base} />
          </dd>
        </div>
        {p.totals.invoiceDiscountMinor > 0 ? (
          <div className="flex justify-between">
            <dt>خصم الفاتورة</dt>
            <dd>
              <Money minor={p.totals.invoiceDiscountMinor} currency={base} />
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt>{p.taxInclusive ? 'منها ضريبة' : 'الضريبة'}</dt>
          <dd>
            <Money minor={p.totals.taxMinor} currency={base} />
          </dd>
        </div>
        <div className="flex justify-between border-t-2 border-ink pt-1 text-base font-bold">
          <dt>الإجمالي</dt>
          <dd>
            <Money minor={p.totals.totalMinor} currency={base} />
          </dd>
        </div>
      </dl>
      <p>
        <strong>شروط الدفع:</strong> {paymentTerms(p)}
      </p>
      {data.store.footer ? <p className="whitespace-pre-line">{data.store.footer}</p> : null}
      <Signatures left="سلّمها" right="استلمها" />
      <p className="text-center text-xs">سيرفا · Serva</p>
    </div>
  );
}

/** «إشعار تسليم»: what was handed over, with batch and serial numbers; prices only when asked. */
export function DeliveryNoteA4({ data, withPrices }: { data: A4SaleData; withPrices: boolean }) {
  const digits = useDigits();
  const p = data.payload;
  const base = p.currency;
  const at = `${dayText(data.deviceTime.slice(0, 10), digits)} ، ${zonedClock(data.deviceTime, data.timezone, digits)}`;
  return (
    <div dir="rtl" lang="ar" aria-label="إشعار تسليم A4" className="flex flex-col gap-3 p-2 text-sm text-ink">
      <Heading
        store={data.store}
        title="إشعار تسليم"
        number={null}
        when={at}
        extra={
          <p>
            الفاتورة{' '}
            <bdi dir="ltr" className="num font-bold">
              {data.number}
            </bdi>
          </p>
        }
      />
      <CustomerBlock customer={data.customer} label="المستلم" />
      <table className="w-full border-collapse" aria-label="أصناف التسليم">
        <thead>
          <tr className="bg-surface-muted">
            <th className={`${cell} w-8 text-center`}>#</th>
            <th className={`${cell} text-start`}>الصنف</th>
            <th className={`${cell} text-end`}>الكمية</th>
            <th className={`${cell} text-start`}>الدفعة</th>
            <th className={`${cell} text-start`}>الصلاحية</th>
            <th className={`${cell} text-start`}>الأرقام التسلسلية</th>
            {withPrices ? <th className={`${cell} text-end`}>السعر</th> : null}
            {withPrices ? <th className={`${cell} text-end`}>المجموع</th> : null}
          </tr>
        </thead>
        <tbody>
          {p.lines.map((line, idx) => {
            const bs = lineBatches(line);
            const stack = (pick: (b: (typeof bs)[number]) => string) =>
              bs.map((b, i) => (
                <span key={i} className="block">
                  {pick(b) || '—'}
                </span>
              ));
            return (
              <tr key={line.lineNo} className="break-inside-avoid">
                <td className={`${cell} num text-center`}>{idx + 1}</td>
                <td className={cell}>{line.name}</td>
                <td className={`${cell} num text-end`}>
                  {formatQuantity(line.qty, digits)}
                  {line.unitName ? ` ${line.unitName}` : ''}
                </td>
                <td className={cell}>
                  {stack(
                    (b) =>
                      `${b.batchNo ?? ''}${bs.length > 1 && b.qty !== null ? ` × ${formatQuantity(b.qty)}` : ''}`,
                  )}
                </td>
                <td className={`${cell} num`}>{stack((b) => b.expiry ?? '')}</td>
                <td className={`${cell} num`}>{line.serials?.join('، ') ?? ''}</td>
                {withPrices ? (
                  <td className={`${cell} text-end`}>
                    <Money minor={line.unitPriceMinor} currency={base} symbol={false} />
                  </td>
                ) : null}
                {withPrices ? (
                  <td className={`${cell} text-end`}>
                    <Money minor={line.priced.totalMinor} currency={base} symbol={false} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {withPrices ? (
        <p className="ms-auto text-base font-bold">
          الإجمالي <Money minor={p.totals.totalMinor} currency={base} />
        </p>
      ) : null}
      <p>استلمتُ البضاعة المذكورة أعلاه سليمة وكاملة.</p>
      <Signatures left="سلّمها" right="استلمها" />
      <p className="text-center text-xs">سيرفا · Serva</p>
    </div>
  );
}

/** «عرض سعر»: lines, totals, validity, notes and terms, and a place for the customer to accept. */
export function QuotationA4({ quotation, store }: { quotation: Quotation; store: A4Store }) {
  const digits = useDigits();
  const base = quotation.currency;
  const taxed = quotation.lines.some((l) => l.taxRateBp > 0);
  return (
    <div dir="rtl" lang="ar" aria-label="عرض سعر A4" className="flex flex-col gap-3 p-2 text-sm text-ink">
      <Heading
        store={store}
        title="عرض سعر"
        number={quotation.number}
        when={`التاريخ ${dayText(quotation.issueDate, digits)}`}
        extra={<p className="font-bold">صالح حتى {dayText(quotation.validUntil, digits)}</p>}
      />
      <CustomerBlock
        customer={
          quotation.customerName
            ? {
                name: quotation.customerName,
                phone: quotation.customerPhone,
                taxNumber: quotation.customerTaxNumber,
                address: quotation.customerAddress,
              }
            : null
        }
        label="السادة"
      />
      <table className="w-full border-collapse" aria-label="أصناف العرض">
        <thead>
          <tr className="bg-surface-muted">
            <th className={`${cell} w-8 text-center`}>#</th>
            <th className={`${cell} text-start`}>الصنف</th>
            <th className={`${cell} text-end`}>الكمية</th>
            <th className={`${cell} text-end`}>السعر</th>
            <th className={`${cell} text-end`}>الخصم</th>
            {taxed ? <th className={`${cell} text-end`}>الضريبة</th> : null}
            <th className={`${cell} text-end`}>المجموع</th>
          </tr>
        </thead>
        <tbody>
          {quotation.lines.map((line, idx) => (
            <tr key={line.lineNo} className="break-inside-avoid">
              <td className={`${cell} num text-center`}>{idx + 1}</td>
              <td className={cell}>{line.name}</td>
              <td className={`${cell} num text-end`}>
                {formatQuantity(line.qty, digits)}
                {line.packName ? ` ${line.packName}` : line.unitName ? ` ${line.unitName}` : ''}
              </td>
              <td className={`${cell} text-end`}>
                <Money minor={line.unitPriceMinor} currency={base} symbol={false} />
              </td>
              <td className={`${cell} text-end`}>
                <Money minor={line.priced.lineDiscountMinor} currency={base} symbol={false} />
              </td>
              {taxed ? (
                <td className={`${cell} text-end`}>
                  <Money minor={line.priced.taxMinor} currency={base} symbol={false} />
                </td>
              ) : null}
              <td className={`${cell} text-end`}>
                <Money minor={line.priced.totalMinor} currency={base} symbol={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto flex w-64 flex-col gap-1 break-inside-avoid">
        {quotation.totals.invoiceDiscountMinor > 0 ? (
          <div className="flex justify-between">
            <dt>خصم العرض</dt>
            <dd>
              <Money minor={quotation.totals.invoiceDiscountMinor} currency={base} />
            </dd>
          </div>
        ) : null}
        {taxed ? (
          <div className="flex justify-between">
            <dt>{quotation.taxInclusive ? 'منها ضريبة' : 'الضريبة'}</dt>
            <dd>
              <Money minor={quotation.totals.taxMinor} currency={base} />
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t-2 border-ink pt-1 text-base font-bold">
          <dt>الإجمالي</dt>
          <dd>
            <Money minor={quotation.totals.totalMinor} currency={base} />
          </dd>
        </div>
      </dl>
      {quotation.notes ? (
        <p className="whitespace-pre-line">
          <strong>ملاحظات:</strong> {quotation.notes}
        </p>
      ) : null}
      {quotation.terms ? (
        <p className="whitespace-pre-line">
          <strong>الشروط:</strong> {quotation.terms}
        </p>
      ) : null}
      <p className="text-xs">هذا عرض سعر وليس فاتورة، والأسعار صالحة حتى التاريخ المذكور أعلاه.</p>
      <Signatures left="عن المحل" right="موافقة الزبون" />
      <p className="text-center text-xs">سيرفا · Serva</p>
    </div>
  );
}
