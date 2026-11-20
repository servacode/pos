import { useSearchParams } from 'react-router';
import type { BelowCostItem } from '@serva/core';
import { DataTable, formatQuantity, Money, PageHeader, ReportsIcon, type DataColumn } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { getProfit } from '../purchases/api';
import { useReport } from './useReport';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const todayText = () => new Date().toLocaleDateString('en-CA');

/**
 * «بيع تحت الكلفة»: the items that sold for less than they cost in a day (today by default), each
 * with its quantity, what it sold for, what it cost and the loss. It is the list behind the home
 * page's «الهامش سالب» link, read from the profit report.
 */
export function BelowCostPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const day = params.get('day') ?? '';
  const date = DAY.test(day) ? day : todayText();
  const digits = me.settings.numberFormat;
  const report = useReport(`below-cost:${date}`, () => getProfit(date, date));
  const base = report.data?.baseCurrency ?? 'SYP';
  // The loss comes right after the name: on a phone the table scrolls and the loss is what was asked for
  const columns: DataColumn<BelowCostItem>[] = [
    { key: 'name', header: 'الصنف', className: 'min-w-32', cell: (r) => <bdi>{r.name}</bdi> },
    {
      key: 'loss',
      header: 'الخسارة',
      numeric: true,
      cell: (r) => <Money minor={-r.lossMinor} currency={base} negativeTone className="font-semibold" />,
    },
    {
      key: 'sold',
      header: 'بيع بـ',
      numeric: true,
      cell: (r) => <Money minor={r.soldMinor} currency={base} />,
    },
    {
      key: 'cost',
      header: 'الكلفة',
      numeric: true,
      cell: (r) => <Money minor={r.costMinor} currency={base} />,
    },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (r) => formatQuantity(r.qty, digits) },
  ];
  return (
    <AppShell>
      <title>بيع تحت الكلفة · SERVA</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          icon={<ReportsIcon />}
          title="بيع تحت الكلفة"
          description={
            <>
              الأصناف التي بيعت بأقل من كلفتها في يوم{' '}
              <bdi dir="ltr" className="num whitespace-nowrap">
                {date}
              </bdi>
              ، بعد المرتجع وبدون الضريبة.
            </>
          }
        />
        <DataTable
          caption="الأصناف المبيعة تحت الكلفة"
          columns={columns}
          rows={report.data?.belowCost ?? []}
          rowKey={(r) => r.productId}
          loading={report.loading}
          {...(report.error ? { error: report.error, onRetry: report.retry } : {})}
          empty="لا أصناف بيعت تحت الكلفة في هذا اليوم."
        />
      </div>
    </AppShell>
  );
}
