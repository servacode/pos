import { useState } from 'react';
import { Link } from 'react-router';
import {
  AGEING_BUCKETS,
  AGEING_LABELS,
  type SupplierAgeingReport,
  type SupplierAgeingRow,
} from '@serva/core';
import {
  Button,
  DataTable,
  EmptyState,
  Money,
  PrintIcon,
  ReportsIcon,
  Skeleton,
  StatTile,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { AccountingLayout } from '../accounting/AccountingLayout';
import { downloadCsv } from '../exportCsv';
import { DayField } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getSupplierAgeing } from './api';
import { supplierAgeingTable } from './csv';
import { PrintHead } from './parts';
import { Card } from '@serva/ui';

function Table({ report, link }: { report: SupplierAgeingReport; link: boolean }) {
  const money = (minor: number) => <Money minor={minor} currency={report.baseCurrency} />;
  const columns: DataColumn<SupplierAgeingRow>[] = [
    {
      key: 'name',
      header: 'المورد',
      className: 'whitespace-nowrap',
      total: 'الإجمالي',
      cell: (r) =>
        link ? (
          <Link
            to={`/suppliers/${r.supplierId}/statement`}
            className="font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            {r.name}
          </Link>
        ) : (
          r.name
        ),
    },
    ...AGEING_BUCKETS.map((b): DataColumn<SupplierAgeingRow> => ({
      key: b,
      header: AGEING_LABELS[b],
      numeric: true,
      cell: (r) => (r.buckets[b] ? money(r.buckets[b]) : <span className="text-ink-subtle">—</span>),
      total: money(report.totals[b]),
    })),
    {
      key: 'balance',
      header: 'الإجمالي',
      numeric: true,
      cell: (r) => <span className="font-semibold">{money(r.balanceMinor)}</span>,
      total: money(report.totals.balanceMinor),
    },
  ];
  return (
    <DataTable
      caption="أعمار ديون الموردين"
      columns={columns}
      rows={report.items}
      rowKey={(r) => r.supplierId}
    />
  );
}

/**
 * «ذمم الموردين» (10 › الذمم): what the store owes each supplier, split by how old the debt is
 * (0-30, 31-60, 61-90 and over 90 days), from the ledger lines of the suppliers' account. A payment
 * settles the oldest debt first. The customers' side is «أعمار الديون» in the reports. Read only.
 */
export function SupplierAgeingPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [asOf, setAsOf] = useState(today);
  const { data, error, loading, retry } = useReport(asOf, () => getSupplierAgeing(asOf));
  const { paper, print } = usePrint();

  return (
    <AccountingLayout
      title="ذمم الموردين"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!data || data.items.length === 0}
            onClick={() => {
              if (!data) return;
              const table = supplierAgeingTable(data);
              downloadCsv(`ذمم-الموردين-${data.asOf}`, table.headers, table.rows);
            }}
          >
            صدّر إلى إكسل
          </Button>
          <Button variant="secondary" icon={<PrintIcon />} disabled={!data} onClick={() => print('A4')}>
            اطبع
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 print:hidden">
        <StatTile
          label="ما علينا للموردين"
          value={
            data ? (
              <Money minor={data.totals.balanceMinor} currency={data.baseCurrency} />
            ) : error ? (
              '—'
            ) : (
              <Skeleton className="h-9 w-40" />
            )
          }
        />
        <StatTile
          label="أقدم من 90 يوماً"
          value={
            data ? (
              <Money minor={data.totals.d90_plus} currency={data.baseCurrency} />
            ) : error ? (
              '—'
            ) : (
              <Skeleton className="h-9 w-40" />
            )
          }
        />
      </div>
      <Card className="grid gap-4 sm:flex sm:flex-wrap sm:items-end print:hidden">
        <DayField label="حتى تاريخ" value={asOf} max={today} onChange={setAsOf} />
      </Card>
      <div className="print:hidden">
        {error ? (
          <DataTable
            caption="أعمار ديون الموردين"
            columns={[]}
            rows={[]}
            rowKey={() => 0}
            error={error}
            onRetry={retry}
          />
        ) : loading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={ReportsIcon}
            title="لا ديون للموردين."
            description="يظهر هنا المورد بعد أي فاتورة شراء بالآجل."
          />
        ) : (
          <Table report={data} link />
        )}
      </div>
      {data && paper ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
            <PrintHead
              me={me}
              branchId={null}
              title="ذمم الموردين"
              period={`بتاريخ ${dayText(data.asOf, digits)}`}
            />
            <Table report={data} link={false} />
          </div>
        </PrintSheet>
      ) : null}
    </AccountingLayout>
  );
}
