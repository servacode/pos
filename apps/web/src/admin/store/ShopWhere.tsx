import { Link } from 'react-router';
import {
  getCurrency,
  returnWindowDays,
  toLatinDigits,
  type CurrencyCode,
  type StoreResponse,
} from '@serva/core';
import { Alert, Card, IconChip, Money, PrintIcon } from '@serva/ui';
import { SETTINGS_SECTIONS } from './parts';

/** Words that make a line of the receipt footer a return policy */
const POLICY = /استبدال|إرجاع|ارجاع|مرتجع|استرجاع|تبديل|استرداد|يرد|ترد/;

/**
 * The days the receipt footer promises for returns («الاستبدال خلال 7 أيام»), or null when the footer
 * names no number of days next to a return word.
 */
export function footerReturnDays(footer: string | null): number | null {
  if (!footer) return null;
  for (const line of footer.split(/[\n.،؛!؟]/)) {
    if (!POLICY.test(line)) continue;
    const text = toLatinDigits(line);
    const days = /(\d{1,3})\s*(?:يوم|يوماً|أيام|ايام)/.exec(text);
    if (days) return Number(days[1]);
    if (/أسبوعين|اسبوعين/.test(text)) return 14;
    if (/أسبوع|اسبوع/.test(text)) return 7;
    if (/شهر/.test(text)) return 30;
  }
  return null;
}

/** A receipt that says one number of days while the till accepts returns for another */
export function ReturnDaysWarning({ store }: { store: StoreResponse }) {
  const said = footerReturnDays(store.receiptFooter);
  const kept = returnWindowDays(store.till, store.sectors);
  if (said === null || said === kept) return null;
  return (
    <Alert tone="warning" title="الفاتورة وإعداد المرتجع لا يتفقان">
      <span className="num">
        سطر أسفل الفاتورة يقول {said} أيام، والكاشير يقبل المرتجع حتى {kept} يوماً.
      </span>{' '}
      غيّر أحدهما ليعرف الزبون والكاشير الرقم نفسه: <a href="#store-profile">أسفل الفاتورة</a> أو{' '}
      <a href="#store-till">أيام قبول المرتجع</a>.
    </Alert>
  );
}

/**
 * Where three things the owner looks for live: the cash rounding the till applies, the printer, and
 * the branches' names. Reading only: each one is changed where it is.
 */
export function ShopWhere({ currencies }: { currencies: readonly CurrencyCode[] }) {
  return (
    <Card id={SETTINGS_SECTIONS.where.id} className="scroll-mt-32">
      <section aria-labelledby="store-where-title" className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <IconChip>
            <PrintIcon />
          </IconChip>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="store-where-title" className="text-lg font-semibold text-ink">
              {SETTINGS_SECTIONS.where.title}
            </h2>
            <p className="text-sm text-ink-muted">أين تجد ما لا يوجد في هذه الصفحة.</p>
          </div>
        </div>
        <dl className="flex flex-col divide-y divide-line text-sm">
          <div className="flex flex-col gap-1 pb-3">
            <dt className="font-semibold text-ink">تقريب النقد</dt>
            <dd className="text-ink-muted">
              يُقرَّب المبلغ المدفوع نقداً فقط، ولا تُقرَّب الفاتورة نفسها ولا الدفع بالبطاقة أو الآجل.{' '}
              {currencies.map((c, i) => (
                <span key={c}>
                  {i > 0 ? '، ' : ''}
                  {getCurrency(c).cashStepMinor > 0 ? (
                    <>
                      {c === 'SYP' ? 'الليرة' : 'الدولار'} إلى أقرب{' '}
                      <Money minor={getCurrency(c).cashStepMinor} currency={c} />
                    </>
                  ) : (
                    <>{c === 'SYP' ? 'الليرة' : 'الدولار'} بلا تقريب</>
                  )}
                </span>
              ))}
              . فرق التقريب يظهر في تقرير إغلاق الوردية. الخطوة ثابتة لكل عملة في النظام ولا تُعدَّل من
              الإعدادات.
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-3">
            <dt className="font-semibold text-ink">الطابعة</dt>
            <dd className="text-ink-muted">
              تُختار على كل جهاز كاشير: قائمة «المزيد» ثم «الطابعة». ويصلح أي طابعة عبر نافذة الطباعة.
            </dd>
          </div>
          <div className="flex flex-col gap-1 pt-3">
            <dt className="font-semibold text-ink">اسم الفرع</dt>
            <dd className="text-ink-muted">
              من صفحة{' '}
              <Link to="/branches" className="font-semibold text-brand-ink underline underline-offset-4">
                الفروع
              </Link>
              : أضف فرعاً أو غيّر اسمه وعنوانه.
            </dd>
          </div>
        </dl>
      </section>
    </Card>
  );
}
