import {
  CURRENCIES,
  formatMoney,
  numberToArabicWords,
  stripBidiControls,
  type CurrencyCode,
  type PlanDetail,
} from '@serva/core';

/** «28,000 ل.س» as plain text for the paper */
const money = (minor: number, currency: CurrencyCode) => stripBidiControls(formatMoney(minor, currency));

/** The words after the amount of a note, by currency */
const UNIT: Partial<Record<CurrencyCode, string>> = { SYP: 'ليرة سورية', USD: 'دولاراً أمريكياً' };

/**
 * The schedule on A4: who the plan is for, what was bought, and every instalment with its day and
 * amount, with a line for each side's signature. The paper the customer keeps.
 */
export function ScheduleSheet({ plan, currency }: { plan: PlanDetail; currency: CurrencyCode }) {
  return (
    <div className="flex flex-col gap-4 p-6 text-sm text-ink" dir="rtl">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <p className="text-lg font-bold">{plan.storeName}</p>
        <div className="text-end">
          <p className="text-xl font-bold">جدول أقساط</p>
          <p>
            <bdi className="num">{plan.number}</bdi>
          </p>
        </div>
      </div>
      <dl className="grid gap-y-1.5" style={{ gridTemplateColumns: '9rem 1fr' }}>
        <dt className="font-semibold">الزبون</dt>
        <dd>
          {plan.customerName}
          {plan.customerPhone ? (
            <>
              {' · '}
              <bdi className="num" dir="ltr">
                {plan.customerPhone}
              </bdi>
            </>
          ) : null}
        </dd>
        {plan.borrower?.nationalId ? (
          <>
            <dt className="font-semibold">الرقم الوطني</dt>
            <dd className="num">{plan.borrower.nationalId}</dd>
          </>
        ) : null}
        {plan.guarantor ? (
          <>
            <dt className="font-semibold">الكفيل</dt>
            <dd>
              {plan.guarantor.name}
              {plan.guarantor.phone ? ` · ${plan.guarantor.phone}` : ''}
            </dd>
          </>
        ) : null}
        <dt className="font-semibold">سعر البضاعة</dt>
        <dd>{money(plan.principalMinor + plan.downPaymentMinor, currency)}</dd>
        <dt className="font-semibold">الدفعة الأولى</dt>
        <dd>{money(plan.downPaymentMinor, currency)}</dd>
        <dt className="font-semibold">رسم التقسيط</dt>
        <dd>{money(plan.markupMinor, currency)}</dd>
        <dt className="font-semibold">المبلغ المقسّط</dt>
        <dd className="font-bold">{money(plan.financedMinor, currency)}</dd>
      </dl>
      <table className="w-full border-collapse text-center">
        <thead>
          <tr className="border-y border-ink">
            <th className="py-1">القسط</th>
            <th className="py-1">تاريخ الاستحقاق</th>
            <th className="py-1">المبلغ</th>
            <th className="py-1">المدفوع</th>
          </tr>
        </thead>
        <tbody>
          {plan.instalments
            .filter((i) => i.state !== 'cancelled')
            .map((i) => (
              <tr key={i.no} className="border-b border-line">
                <td className="num py-1">
                  {i.no} من {plan.count}
                </td>
                <td className="num py-1">{i.dueDate}</td>
                <td className="py-1">{money(i.amountMinor, currency)}</td>
                <td className="py-1">{i.paidMinor > 0 ? money(i.paidMinor, currency) : '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="mt-8 grid grid-cols-2 gap-8 text-center">
        <p className="border-t border-ink pt-1">توقيع الزبون</p>
        <p className="border-t border-ink pt-1">ختم المتجر وتوقيعه</p>
      </div>
    </div>
  );
}

const DEFAULT_NOTE_TEXT =
  'أتعهد أنا الموقّع أدناه بأن أدفع بموجب هذا السند لأمر {store} المبلغ المبيّن، في تاريخ الاستحقاق المذكور، دون حاجة لإنذار أو احتجاج.';

/**
 * Promissory notes (كمبيالات) on A4, three to a page: number, place and day of issue, due day, the
 * amount in figures and in words, who owes it (the drawer), the guarantor and a box to sign in. The
 * wording is the store's own when it set one, else a shipped text for a lawyer to review.
 */
export function NotesSheet({ plan, currency }: { plan: PlanDetail; currency: CurrencyCode }) {
  const notes = plan.notes.filter((n) => n.status !== 'cancelled');
  const wording = (plan.noteText ?? DEFAULT_NOTE_TEXT).replaceAll('{store}', plan.storeName);
  return (
    <div className="flex flex-col text-sm text-ink" dir="rtl">
      {notes.map((n, i) => (
        <section
          key={n.id}
          className="flex flex-col gap-2 border-b border-dashed border-ink p-4"
          style={{ height: '90mm', breakInside: 'avoid', breakAfter: (i + 1) % 3 === 0 ? 'page' : 'auto' }}
        >
          <div className="flex items-start justify-between">
            <p className="text-lg font-bold">كمبيالة</p>
            <p>
              رقم <bdi className="num">{n.number}</bdi>
              {n.no ? ` (${n.no} من ${plan.count})` : ' (عن كامل المبلغ)'}
            </p>
          </div>
          <p>
            صدرت في {plan.notePlace ? `${plan.notePlace} ` : ''}بتاريخ{' '}
            <bdi className="num">{n.issueDate}</bdi> · تُستحق بتاريخ{' '}
            <bdi className="num font-bold">{n.dueDate}</bdi>
          </p>
          <p className="text-base font-bold">
            المبلغ: {money(n.amountMinor, currency)}{' '}
            <span className="font-normal">
              (فقط {numberToArabicWords(Math.round(n.amountMinor / 10 ** CURRENCIES[currency].decimals))}{' '}
              {UNIT[currency] ?? ''} لا غير)
            </span>
          </p>
          <p className="leading-relaxed">{wording}</p>
          <div className="mt-auto grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold">المدين: {plan.customerName}</p>
              {plan.borrower?.nationalId ? <p>الرقم الوطني: {plan.borrower.nationalId}</p> : null}
              {plan.borrower?.address ? <p>العنوان: {plan.borrower.address}</p> : null}
              {plan.customerPhone ? <p>الهاتف: {plan.customerPhone}</p> : null}
              <p className="mt-6 border-t border-ink pt-1">التوقيع</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold">الضامن الاحتياطي: {plan.guarantor?.name ?? '................'}</p>
              {plan.guarantor?.nationalId ? <p>الرقم الوطني: {plan.guarantor.nationalId}</p> : null}
              {plan.guarantor?.phone ? <p>الهاتف: {plan.guarantor.phone}</p> : null}
              <p className="mt-6 border-t border-ink pt-1">التوقيع</p>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
