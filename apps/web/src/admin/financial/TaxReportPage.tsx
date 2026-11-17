import { useState, type ReactNode } from 'react';
import type { TaxReport, TaxReportRow } from '@serva/core';
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
import { isoDay, monthStart } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { AccountingLayout } from '../accounting/AccountingLayout';
import { PeriodBar } from '../accounting/parts';
import { downloadCsv } from '../exportCsv';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getTaxReport } from './api';
import { taxTable } from './csv';
import { CheckBadge, PrintHead, period } from './parts';

const KIND: Record<NonNullable<TaxReportRow['kind']>, string> = {
  sales: 'ضريبة مبيعات',
  consumption: 'رسم إنفاق استهلاكي',
  stamp: 'رسم طابع',
};

function Table({ report }: { report: TaxReport }) {
  const base = report.baseCurrency;
  const t = report.totals;
  const money = (minor: number) => <Money minor={minor} currency={base} negativeTone />;
  const columns: DataColumn<TaxReportRow>[] = [
    {
      key: 'rate',
      header: 'الضريبة',
      cell: (r) => (
        <span className="text-ink">
          <span className="font-semibold">{r.name}</span>
          {r.kind ? <span className="text-ink-subtle"> · {KIND[r.kind]}</span> : null}
        </span>
      ),
      total: 'المجموع',
    },
    {
      key: 'taxable',
      header: 'مبيعات بدون ضريبة',
      numeric: true,
      cell: (r) => money(r.salesTaxableMinor),
      total: money(t.salesTaxableMinor),
    },
    {
      key: 'tax',
      header: 'ضريبة المبيعات',
      numeric: true,
      cell: (r) => money(r.salesTaxMinor),
      total: money(t.salesTaxMinor),
    },
    {
      key: 'returns',
      header: 'ضريبة المرتجعات',
      numeric: true,
      cell: (r) => money(r.returnsTaxMinor),
      total: money(t.returnsTaxMinor),
    },
    {
      key: 'net',
      header: 'صافي الضريبة',
      numeric: true,
      cell: (r) => <span className="font-semibold">{money(r.netTaxMinor)}</span>,
      total: money(t.netTaxMinor),
    },
  ];
  return (
    <DataTable
      caption="الضريبة حسب النسبة"
      columns={columns}
      rows={report.rows}
      rowKey={(r) => `${r.rateId}|${r.rateBp}`}
    />
  );
}

/**
 * «تقرير الضريبة» (27, 29): for a period, the tax charged on invoices by rate, what returns took
 * back, and the net the store collected, beside the tax paid on purchases. The numbers are the tax
 * lines of the invoices and returns; a badge says they agree with the tax accounts of the books.
 * Ready for a new rate: it lists whatever rates the invoices used. Prints on A4 and saves as CSV.
 */
export function TaxReportPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const { data, error, loading, retry } = useReport(`${from}|${to}|${branchId ?? ''}`, () =>
    getTaxReport({ from, to, branchId }),
  );
  const { paper, print } = usePrint();
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const tile = (value: (r: TaxReport) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  return (
    <AccountingLayout
      title="تقرير الضريبة"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!data || data.rows.length === 0}
            onClick={() => {
              if (!data) return;
              const table = taxTable(data);
              downloadCsv(`تقرير-الضريبة-${data.from}-${data.to}`, table.headers, table.rows);
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
      <div className="grid gap-4 sm:grid-cols-3 print:hidden">
        <StatTile
          label="ضريبة المبيعات الصافية"
          footnote="بعد المرتجعات"
          value={tile((r) => (
            <Money minor={r.totals.netTaxMinor} currency={base} negativeTone />
          ))}
        />
        <StatTile
          label="ضريبة المشتريات"
          value={tile((r) => (
            <Money minor={r.inputTaxMinor} currency={base} negativeTone />
          ))}
        />
        <StatTile
          label="المستحق للدولة"
          value={tile((r) => (
            <Money minor={r.netPayableMinor} currency={base} negativeTone />
          ))}
        />
      </div>
      <div className="print:hidden">
        <PeriodBar
          me={me}
          today={today}
          from={from}
          to={to}
          branchId={branchId}
          onFrom={setFrom}
          onTo={setTo}
          onBranch={setBranchId}
        >
          {data ? (
            <CheckBadge ok={data.reconciled} good="يطابق حسابات الضريبة" bad="لا يطابق حسابات الضريبة" />
          ) : null}
        </PeriodBar>
      </div>
      <div className="print:hidden">
        {error ? (
          <DataTable
            caption="تقرير الضريبة"
            columns={[]}
            rows={[]}
            rowKey={() => 0}
            error={error}
            onRetry={retry}
          />
        ) : loading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={ReportsIcon}
            title="لا مبيعات في هذه الفترة."
            description="تظهر هنا الضريبة بعد أول فاتورة في الفترة."
          />
        ) : (
          <Table report={data} />
        )}
      </div>
      <p className="text-sm text-ink-subtle print:hidden">
        الأرقام بدون ضريبة هي ثمن المبيعات قبل الضريبة. المستحق = صافي ضريبة المبيعات − ضريبة المشتريات.
      </p>
      {data && paper ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
            <PrintHead
              me={me}
              branchId={branchId}
              title="تقرير الضريبة"
              period={period(data.from, data.to, digits)}
            />
            <Table report={data} />
            <p>
              ضريبة المشتريات: <Money minor={data.inputTaxMinor} currency={data.baseCurrency} />
            </p>
            <p className="font-bold">
              المستحق للدولة: <Money minor={data.netPayableMinor} currency={data.baseCurrency} />
            </p>
          </div>
        </PrintSheet>
      ) : null}
    </AccountingLayout>
  );
}
