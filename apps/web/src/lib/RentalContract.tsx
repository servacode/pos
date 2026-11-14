import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RENTAL_RATE_LABELS, type Rental } from '@serva/core';
import { Money, useDigits } from '@serva/ui';
import { dayText } from './dates';

/**
 * The rental contract on A4 (03 › الأدوات الطبية: التأجير): the piece and its serial, the renter, the
 * days, the rate and the deposit, the renter's undertaking and two signatures. Printed from the till
 * when the rental is written and again from the back office.
 */
export function RentalContractSheet({ rental, store }: { rental: Rental; store: string }) {
  const digits = useDigits();
  const row = (label: string, value: ReactNode) => (
    <div className="flex gap-2 border-b border-line py-1.5">
      <dt className="w-40 shrink-0 font-semibold">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
  return (
    <section
      dir="rtl"
      lang="ar"
      aria-label="عقد تأجير"
      className="flex flex-col gap-4 text-[13px]/[1.7] text-ink"
    >
      <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <h1 className="text-2xl font-bold">عقد تأجير جهاز</h1>
          <p className="text-base font-semibold">{store}</p>
        </div>
        <bdi dir="ltr" className="num text-xl font-bold">
          {rental.number}
        </bdi>
      </header>
      <dl className="flex flex-col">
        {row('المستأجر', rental.customerName)}
        {row(
          'الجوال',
          <bdi dir="ltr" className="num">
            {rental.customerPhone}
          </bdi>,
        )}
        {row('الجهاز', rental.item)}
        {row(
          'الرقم التسلسلي',
          <bdi dir="ltr" className="num">
            {rental.serial}
          </bdi>,
        )}
        {row('تاريخ التسليم', dayText(rental.startDate, digits))}
        {row('الإرجاع المتوقع', dayText(rental.expectedReturn, digits))}
        {row(
          'الأجرة',
          <>
            <Money minor={rental.rateMinor} currency={rental.currency} />{' '}
            {RENTAL_RATE_LABELS[rental.rateUnit]}
          </>,
        )}
        {row(
          'العربون',
          rental.depositMinor > 0 ? (
            <>
              <Money minor={rental.depositMinor} currency={rental.currency} />
              {rental.depositVoucher ? (
                <>
                  {' · قسيمة '}
                  <bdi dir="ltr" className="num">
                    {rental.depositVoucher}
                  </bdi>
                </>
              ) : null}
            </>
          ) : (
            'لا عربون'
          ),
        )}
        {rental.note ? row('ملاحظات', rental.note) : null}
      </dl>
      <ol className="list-decimal ps-6">
        <li>يستلم المستأجر الجهاز سليماً وصالحاً للعمل ويلتزم باستعماله وفق تعليمات الاستعمال.</li>
        <li>تُحسب الأجرة من يوم التسليم حتى يوم الإرجاع الفعلي، وكل فترة بدأت تُحسب كاملة.</li>
        <li>يتحمّل المستأجر تكلفة إصلاح أي عطل أو كسر ناتج عن سوء الاستعمال، وقيمة الجهاز عند فقده.</li>
        <li>لا يجوز تأجير الجهاز لطرف آخر ولا نقله من العنوان المتفق عليه دون إذن المحل.</li>
        <li>يُعاد العربون أو يُخصم من الأجرة عند الإرجاع بعد فحص الجهاز.</li>
      </ol>
      <div className="mt-10 grid grid-cols-2 gap-16 text-center">
        <div className="border-t border-ink pt-2">توقيع المستأجر</div>
        <div className="border-t border-ink pt-2">توقيع المحل</div>
      </div>
    </section>
  );
}

/** The sheet for the printer: in the page's body so the screen's own content is hidden while it prints */
export function PrintableRentalContract({ rental, store }: { rental: Rental; store: string }) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block">
      <style>{'@page { size: A4; margin: 15mm }'}</style>
      <RentalContractSheet rental={rental} store={store} />
    </div>,
    document.body,
  );
}
