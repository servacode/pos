import { createPortal } from 'react-dom';
import { dmy } from '@serva/core/contracts/warranty';

/** What a warranty certificate says (03 › الإلكترونيات والأدوات الطبية): who sold what to whom, until when */
export interface WarrantyCertificateData {
  storeName: string;
  branchName?: string | null;
  storePhone?: string | null;
  customerName: string | null;
  customerPhone: string | null;
  saleNumber: string | null;
  items: { name: string; serial: string; soldOn: string; until: string | null }[];
  /** The store's terms from its settings (الصندوق › شروط الكفالة) */
  terms: string | null;
}

export const DEFAULT_WARRANTY_TERMS =
  'الكفالة على عيوب الصنع فقط، ولا تشمل الكسر أو السوائل أو سوء الاستخدام. يُبرز الزبون هذه الشهادة وفاتورة الشراء عند المطالبة.';

/**
 * The certificate on an A4 sheet: one block per piece, with the store's terms. Hidden on screen,
 * printed by `window.print()` in place of whatever else is on the page (the same portal as the
 * receipt, so the print stylesheet hides the rest).
 */
export function WarrantyCertificate({ data }: { data: WarrantyCertificateData }) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block" dir="rtl" aria-label="شهادة الكفالة">
      <style>{'@page { size: A4; margin: 15mm }'}</style>
      <header className="border-b-2 border-ink pb-3 text-center">
        <h1 className="text-2xl font-bold">{data.storeName}</h1>
        {data.branchName ? <p className="text-sm">{data.branchName}</p> : null}
        {data.storePhone ? (
          <p className="num text-sm">
            <bdi dir="ltr">{data.storePhone}</bdi>
          </p>
        ) : null}
        <h2 className="mt-3 text-xl font-bold">شهادة كفالة</h2>
      </header>
      <dl className="mt-5 grid gap-1 text-base">
        <div>
          <dt className="inline font-semibold">الزبون: </dt>
          <dd className="inline">{data.customerName ?? '—'}</dd>
        </div>
        {data.customerPhone ? (
          <div>
            <dt className="inline font-semibold">الجوال: </dt>
            <dd className="inline">
              <bdi dir="ltr" className="num">
                {data.customerPhone}
              </bdi>
            </dd>
          </div>
        ) : null}
        {data.saleNumber ? (
          <div>
            <dt className="inline font-semibold">رقم الفاتورة: </dt>
            <dd className="inline">
              <bdi dir="ltr" className="num">
                {data.saleNumber}
              </bdi>
            </dd>
          </div>
        ) : null}
      </dl>
      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink text-start">
            <th className="p-2 text-start">الجهاز</th>
            <th className="p-2 text-start">الرقم التسلسلي</th>
            <th className="p-2 text-start">تاريخ البيع</th>
            <th className="p-2 text-start">الكفالة حتى</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.serial} className="border-b border-ink/40">
              <td className="p-2">{item.name}</td>
              <td className="p-2">
                <bdi dir="ltr" className="num">
                  {item.serial}
                </bdi>
              </td>
              <td className="num p-2">{dmy(item.soldOn)}</td>
              <td className="num p-2 font-semibold">{item.until ? dmy(item.until) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-6">
        <h3 className="font-semibold">شروط الكفالة</h3>
        <p className="mt-1 whitespace-pre-line text-sm">{data.terms?.trim() || DEFAULT_WARRANTY_TERMS}</p>
      </section>
      <footer className="mt-12 flex justify-between text-sm">
        <span>توقيع البائع: ____________</span>
        <span>توقيع الزبون: ____________</span>
      </footer>
    </div>,
    document.body,
  );
}
