import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode, WorklistBucket, WorklistRow } from '@serva/core';
import { Alert, CalendarIcon, ChatIcon, CheckIcon, PhoneIcon, useDigits } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { useIsPhone } from '../../lib/useIsPhone';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { Empty, RadioChips } from '../customers/parts';
import { Amt, PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { getWorklist, logReminder } from './api';
import { reminderLink } from './whatsapp';

const BUCKET_TEXT: Record<WorklistBucket, string> = {
  remind: 'للتذكير اليوم',
  today: 'مستحقة اليوم',
  week: 'هذا الأسبوع',
  late: 'متأخرة',
};

const EMPTY_TEXT: Record<WorklistBucket, string> = {
  remind: 'لا تذكير مطلوب اليوم.',
  today: 'لا أقساط مستحقة اليوم.',
  week: 'لا أقساط مستحقة خلال أسبوع.',
  late: 'لا أقساط متأخرة. أحسنت.',
};

/** «منذ 3 أيام» of a reminder, from its time to now */
function lastReminder(at: string | null): string | null {
  if (!at) return null;
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return days <= 0 ? 'آخر تذكير اليوم' : days === 1 ? 'آخر تذكير أمس' : `آخر تذكير قبل ${String(days)} أيام`;
}

/**
 * «متابعة الأقساط»: what is due today, this week and what is late, each with the customer's number,
 * a WhatsApp reminder written ready to send (every click is logged, so nobody sends twice by mistake)
 * and a way to the plan to collect.
 */
export function WorklistPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const [bucket, setBucket] = useState<WorklistBucket>('remind');
  const [items, setItems] = useState<WorklistRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [base, setBase] = useState<CurrencyCode>(me.settings.baseCurrency);
  const [today, setToday] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((n) => n + 1), []);

  // A quick change of tab never shows the answer of the tab before
  useEffect(() => {
    let alive = true;
    setItems(null);
    setError(null);
    getWorklist(bucket)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setHasMore(r.hasMore === true);
        setBase(r.baseCurrency);
        setToday(r.today);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [bucket, attempt]);

  const rows = items ?? [];
  const kindOf = (r: WorklistRow) => (r.daysLate > 0 ? 'late' : r.dueDate === today ? 'due' : 'before');

  const actions = (r: WorklistRow) => {
    const link = reminderLink(r.phone, {
      kind: kindOf(r),
      name: r.customerName,
      amountMinor: r.remainingMinor,
      currency: base,
      due: r.dueDate,
      no: r.no,
      of: r.of,
      store: me.tenant.name,
      daysLate: r.daysLate,
    });
    const said = lastReminder(r.lastReminderAt);
    return (
      <span className="flex flex-wrap items-center gap-2">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              void logReminder(r.planId, r.no, kindOf(r))
                .then(load)
                .catch(() => undefined);
            }}
            className="sx-fbtn"
          >
            <ChatIcon size={16} /> واتساب
          </a>
        ) : (
          <span className="cx-sub">لا رقم هاتف</span>
        )}
        {r.phone ? (
          <a href={`tel:${r.phone}`} className="sx-fbtn">
            <PhoneIcon size={16} /> اتصال
          </a>
        ) : null}
        {said ? <span className="cx-sub">{said}</span> : null}
      </span>
    );
  };

  const columns: SxColumn<WorklistRow>[] = [
    {
      key: 'customer',
      header: 'الزبون',
      lead: true,
      cell: (r) => (
        <>
          <Link
            to={`/installments/${r.planId}`}
            className="sx-rowbtn inline-flex items-center hover:underline"
          >
            {r.customerName}
          </Link>
          <span className="sx-subline">
            القسط <bdi className="sx-n">{r.no}</bdi> من <bdi className="sx-n">{r.of}</bdi> ·{' '}
            <bdi dir="ltr" className="sx-n">
              {r.planNumber}
            </bdi>
          </span>
        </>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (r) => (
        <>
          <span className="sx-n">{dayText(r.dueDate, digits)}</span>
          {r.daysLate > 0 ? (
            <span className="sx-subline">
              <StatusPill kind="danger">متأخر {r.daysLate} يوماً</StatusPill>
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'amount',
      header: 'المتبقي',
      numeric: true,
      strong: true,
      cell: (r) => <Amt minor={r.remainingMinor} currency={base} />,
    },
    { key: 'actions', header: <span className="sr-only">تذكير</span>, cell: actions },
  ];

  // Nothing to do: a calm line with where to go next, not a table with an empty box in it
  const calm = items !== null && rows.length === 0 && !error;

  return (
    <AppShell>
      <title>متابعة الأقساط · SERVA</title>
      <SalesPage>
        <PageTop
          title="متابعة الأقساط"
          subtitle="من يستحق عليه قسط اليوم ومن تأخر، مع رسالة واتساب جاهزة للإرسال."
          actions={
            <Link to="/installments" className="sx-fbtn">
              كل الخطط
            </Link>
          }
        />
        <RadioChips
          name="worklist-bucket"
          label="اعرض"
          value={bucket}
          onChange={setBucket}
          options={(Object.keys(BUCKET_TEXT) as WorklistBucket[]).map((b) => ({
            value: b,
            label: BUCKET_TEXT[b],
          }))}
        />
        {error && items ? <Alert tone="error">{error}</Alert> : null}
        {calm ? (
          <section className="sx-card">
            <Empty icon={<CheckIcon size={24} />} title={EMPTY_TEXT[bucket]}>
              <p>
                <Link to="/installments" className="font-semibold text-brand-ink hover:underline">
                  افتح كل الخطط
                </Link>
              </p>
            </Empty>
          </section>
        ) : phone && rows.length > 0 ? (
          <ul className="sx-cards" aria-label="الأقساط المستحقة">
            {rows.map((r) => (
              <li key={`${r.planId}-${r.no}`} className="sx-scard">
                <Link to={`/installments/${r.planId}`} className="flex min-w-0 flex-col hover:underline">
                  <span className="font-semibold">{r.customerName}</span>
                  <span className="cx-sub">
                    القسط <bdi className="sx-n">{r.no}</bdi> من <bdi className="sx-n">{r.of}</bdi> ·{' '}
                    <bdi dir="ltr" className="sx-n">
                      {r.planNumber}
                    </bdi>
                  </span>
                </Link>
                <span className="justify-self-end font-semibold">
                  <Amt minor={r.remainingMinor} currency={base} />
                </span>
                <span className="x">
                  <span>{dayText(r.dueDate, digits)}</span>
                  {r.daysLate > 0 ? <StatusPill kind="danger">متأخر {r.daysLate} يوماً</StatusPill> : null}
                </span>
                <span className="a">{actions(r)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <SxTable
            caption="الأقساط المستحقة"
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.planId}-${r.no}`}
            loading={!items && !error}
            {...(error && !items ? { error, onRetry: load } : {})}
            empty={<Empty icon={<CalendarIcon size={24} />} title={EMPTY_TEXT[bucket]} />}
          />
        )}
        {hasMore ? (
          <p className="sx-wait" role="status">
            تظهر أول 500 قسط فقط. عالج هذه ثم أعد فتح الصفحة لترى الباقي.
          </p>
        ) : null}
      </SalesPage>
    </AppShell>
  );
}
