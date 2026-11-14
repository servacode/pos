import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AGEING_BUCKETS,
  AGEING_LABELS,
  getCurrency,
  type DebtAgeingReport,
  type DebtAgeingRow,
} from '@serva/core';
import {
  Alert,
  Button,
  CustomersIcon,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { downloadCsv } from '../exportCsv';
import { SectionHead } from '../purchases/parts';
import { getDebtAgeing } from './api';

/** An amount as a spreadsheet cell: major units, no thousands separator */
const cellText = (minor: number, report: DebtAgeingReport) =>
  (minor / 10 ** getCurrency(report.baseCurrency).decimals).toFixed(
    getCurrency(report.baseCurrency).decimals,
  );

/** The CSV of the report: one row per customer and a totals row */
export function ageingCsv(report: DebtAgeingReport): { headers: string[]; rows: (string | number)[][] } {
  const headers = ['الزبون', 'الجوال', ...AGEING_BUCKETS.map((b) => AGEING_LABELS[b]), 'الإجمالي'];
  const rows = report.items.map((r) => [
    r.name,
    r.phone ?? '',
    ...AGEING_BUCKETS.map((b) => cellText(r.buckets[b], report)),
    cellText(r.balanceMinor, report),
  ]);
  rows.push([
    'الإجمالي',
    '',
    ...AGEING_BUCKETS.map((b) => cellText(report.totals[b], report)),
    cellText(report.totals.balanceMinor, report),
  ]);
  return { headers, rows };
}

/**
 * «أعمار الديون» (10 › الذمم): what each customer owes split by how old the debt is, 0-30, 31-60,
 * 61-90 and over 90 days, from the ledger. A payment settles the oldest debt first. Read only.
 */
export function DebtAgeingPage() {
  const [asOf, setAsOf] = useState('');
  const [report, setReport] = useState<DebtAgeingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getDebtAgeing(asOf || undefined)
      .then(setReport)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [asOf]);
  useEffect(load, [load]);

  const money = (minor: number) => (report ? <Money minor={minor} currency={report.baseCurrency} /> : null);

  const columns: DataColumn<DebtAgeingRow>[] = [
    {
      key: 'name',
      header: 'الزبون',
      className: 'whitespace-nowrap',
      total: 'الإجمالي',
      cell: (r) => (
        <Link
          to={`/customers/${r.customerId}`}
          className="font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    ...AGEING_BUCKETS.map((b): DataColumn<DebtAgeingRow> => ({
      key: b,
      header: AGEING_LABELS[b],
      numeric: true,
      cell: (r) => (r.buckets[b] ? money(r.buckets[b]) : <span className="text-ink-subtle">—</span>),
      total: report ? money(report.totals[b]) : null,
    })),
    {
      key: 'balance',
      header: 'الإجمالي',
      numeric: true,
      cell: (r) => <span className="font-semibold">{money(r.balanceMinor)}</span>,
      total: report ? money(report.totals.balanceMinor) : null,
    },
  ];

  return (
    <AppShell>
      <title>أعمار الديون · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="أعمار الديون"
          description="كم عمر ما يدين به كل زبون: حتى 30 يوماً، 31-60، 61-90، وأكثر من 90. الدفعة تسدّد أقدم دين أولاً."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <section aria-label="الذمم" className="flex flex-col gap-3">
          <SectionHead title="الزبائن المدينون">
            <TextField
              label="حتى تاريخ (فارغ: اليوم)"
              type="date"
              dir="ltr"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={!report || report.items.length === 0}
              onClick={() => {
                if (!report) return;
                const csv = ageingCsv(report);
                downloadCsv(`أعمار-الديون-${report.asOf}`, csv.headers, csv.rows);
              }}
            >
              صدّر CSV
            </Button>
          </SectionHead>
          <DataTable
            caption="أعمار الديون"
            columns={columns}
            rows={report?.items ?? []}
            rowKey={(r) => r.customerId}
            loading={!report && !error}
            {...(error ? { onRetry: load } : {})}
            empty={
              <EmptyState
                icon={CustomersIcon}
                title="لا ديون على الزبائن."
                description="يظهر هنا من يدين للمحل بعد أي بيع بالآجل أو رصيد افتتاحي."
              />
            }
          />
        </section>
      </div>
    </AppShell>
  );
}
