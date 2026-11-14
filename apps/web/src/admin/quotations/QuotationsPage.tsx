import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { QUOTATION_STATUS_LABELS, type QuotationListItem, type QuotationStatus } from '@serva/core';
import {
  AddIcon,
  Badge,
  DataTable,
  EmptyState,
  ListIcon,
  Money,
  PageHeader,
  SearchField,
  SegmentedControl,
  Button,
  useDigits,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { listQuotations } from './api';

export const QUOTATION_TONES: Record<QuotationStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  expired: 'danger',
  converted: 'brand',
};

const FILTERS = [
  { value: 'all', label: 'الكل' },
  { value: 'open', label: 'بانتظار الرد' },
  { value: 'accepted', label: 'مقبولة' },
  { value: 'converted', label: 'حُوّلت لفاتورة' },
  { value: 'expired', label: 'منتهية' },
] as const;

/**
 * «عروض الأسعار» (03 › الجملة: عرض السعر): the store's offers to customers, newest first, by
 * their number and status. An offer is opened to edit it, print it on A4 or turn it into an invoice;
 * none of it posts or moves stock.
 */
export function QuotationsPage() {
  const me = useMe();
  const digits = useDigits();
  const navigate = useNavigate();
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<QuotationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setRows(null);
    listQuotations(status, q)
      .then((r) => setRows(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [status, q]);
  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  const columns: DataColumn<QuotationListItem>[] = [
    {
      key: 'number',
      header: 'الرقم',
      cell: (r) => (
        <Link
          to={`/quotations/${r.id}`}
          className="rounded-sm font-semibold text-ink underline decoration-transparent underline-offset-4 transition-[color,text-decoration-color] duration-120 ease-standard hover:text-brand-ink hover:decoration-current"
        >
          <bdi dir="ltr" className="num">
            {r.number}
          </bdi>
        </Link>
      ),
    },
    { key: 'customer', header: 'الزبون', cell: (r) => r.customerName ?? '—' },
    { key: 'date', header: 'التاريخ', cell: (r) => dayText(r.issueDate, digits) },
    { key: 'valid', header: 'صالح حتى', cell: (r) => dayText(r.validUntil, digits) },
    {
      key: 'total',
      header: 'المجموع',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={r.currency} />,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => <Badge tone={QUOTATION_TONES[r.status]}>{QUOTATION_STATUS_LABELS[r.status]}</Badge>,
    },
  ];

  return (
    <ReportScreen me={me} access={['customers.manage']} title="عروض الأسعار">
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="عروض الأسعار"
          description="اعرض أسعارك على زبون، واطبعها على A4، وحوّل المقبول منها إلى فاتورة. العرض لا يسجّل بيعاً ولا يحرّك المخزون."
          icon={<ListIcon />}
          actions={
            <Button icon={<AddIcon />} onClick={() => void navigate('/quotations/new')}>
              عرض سعر جديد
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="حالة العرض"
            value={status}
            onValueChange={setStatus}
            options={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          />
          <SearchField
            label="ابحث برقم العرض أو اسم الزبون"
            value={q}
            onValueChange={setQ}
            className="w-full sm:w-80"
          />
        </div>
        <DataTable
          caption="عروض الأسعار"
          columns={columns}
          rows={rows ?? []}
          rowKey={(r) => r.id}
          loading={rows === null && !error}
          {...(error ? { error, onRetry: load } : {})}
          empty={
            <EmptyState
              icon={ListIcon}
              title="لا عروض أسعار هنا"
              description="اضغط «عرض سعر جديد»، أو احفظ سلة الكاشير كعرض سعر من زر «عرض سعر»."
            />
          }
        />
      </div>
    </ReportScreen>
  );
}
