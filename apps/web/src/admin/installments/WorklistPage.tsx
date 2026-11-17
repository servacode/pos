import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode, WorklistBucket, WorklistRow } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  CalendarIcon,
  ChatIcon,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  PhoneIcon,
  SegmentedControl,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { useIsPhone } from '../../lib/useIsPhone';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
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
  const digits = me.settings.numberFormat;
  const [bucket, setBucket] = useState<WorklistBucket>('remind');
  const [items, setItems] = useState<WorklistRow[] | null>(null);
  const [base, setBase] = useState<CurrencyCode>('SYP');
  const [today, setToday] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    setError(null);
    getWorklist(bucket)
      .then((r) => {
        setItems(r.items);
        setBase(r.baseCurrency);
        setToday(r.today);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [bucket]);
  useEffect(load, [load]);

  const phone = useIsPhone();
  const hasRows = !!items && items.length > 0;
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
      <span className="flex flex-wrap items-center gap-2 py-1.5">
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
            className="inline-flex min-h-9 items-center gap-1 rounded-control border border-line px-3 text-sm font-semibold text-brand-ink hover:bg-surface-muted"
          >
            <ChatIcon size={16} /> واتساب
          </a>
        ) : (
          <span className="text-xs text-ink-subtle">لا رقم هاتف</span>
        )}
        {r.phone ? (
          <a
            href={`tel:${r.phone}`}
            className="inline-flex min-h-9 items-center gap-1 rounded-control border border-line px-3 text-sm font-semibold hover:bg-surface-muted"
          >
            <PhoneIcon size={16} /> اتصال
          </a>
        ) : null}
        {said ? <span className="text-xs text-ink-subtle">{said}</span> : null}
      </span>
    );
  };

  const columns: DataColumn<WorklistRow>[] = [
    {
      key: 'customer',
      header: 'الزبون',
      cell: (r) => (
        <Link to={`/installments/${r.planId}`} className="flex flex-col py-2 hover:underline">
          <span className="line-clamp-2 font-semibold">{r.customerName}</span>
          <span className="text-xs text-ink-muted">
            القسط <bdi className="num">{r.no}</bdi> من <bdi className="num">{r.of}</bdi> ·{' '}
            <bdi dir="ltr" className="num">
              {r.planNumber}
            </bdi>
          </span>
        </Link>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className="whitespace-nowrap">{dayText(r.dueDate, digits)}</span>
          {r.daysLate > 0 ? <Badge tone="danger">متأخر {r.daysLate} يوماً</Badge> : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'المتبقي',
      numeric: true,
      cell: (r) => <Money minor={r.remainingMinor} currency={base} className="font-semibold" />,
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => actions(r),
    },
  ];

  return (
    <AppShell>
      <title>متابعة الأقساط · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="متابعة الأقساط"
          description="من يستحق عليه قسط اليوم ومن تأخر، مع رسالة واتساب جاهزة للإرسال."
          actions={
            <Link to="/installments">
              <Button variant="secondary">كل الخطط</Button>
            </Link>
          }
        />
        <SegmentedControl
          label="اعرض"
          value={bucket}
          onValueChange={setBucket}
          options={(Object.keys(BUCKET_TEXT) as WorklistBucket[]).map((b) => ({
            value: b,
            label: BUCKET_TEXT[b],
          }))}
        />
        {error && items ? <Alert tone="error">{error}</Alert> : null}
        {hasRows && phone ? (
          <ul className="flex flex-col gap-3" aria-label="الأقساط المستحقة">
            {(items ?? []).map((r) => (
              <li
                key={`${r.planId}-${r.no}`}
                className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/installments/${r.planId}`} className="flex min-w-0 flex-col hover:underline">
                    <span className="font-semibold">{r.customerName}</span>
                    <span className="text-xs text-ink-muted">
                      القسط <bdi className="num">{r.no}</bdi> من <bdi className="num">{r.of}</bdi> ·{' '}
                      <bdi dir="ltr" className="num">
                        {r.planNumber}
                      </bdi>
                    </span>
                  </Link>
                  <Money minor={r.remainingMinor} currency={base} className="shrink-0 font-semibold" />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{dayText(r.dueDate, digits)}</span>
                  {r.daysLate > 0 ? <Badge tone="danger">متأخر {r.daysLate} يوماً</Badge> : null}
                </div>
                {actions(r)}
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          {hasRows && phone ? null : (
            <DataTable
              caption="الأقساط المستحقة"
              columns={columns}
              rows={items ?? []}
              rowKey={(r) => `${r.planId}-${r.no}`}
              loading={!items && !error}
              {...(error && !items ? { error, onRetry: load } : {})}
              empty={<EmptyState icon={CalendarIcon} title={EMPTY_TEXT[bucket]} />}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
