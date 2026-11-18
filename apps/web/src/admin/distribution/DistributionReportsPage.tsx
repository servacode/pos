import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  DISTRIBUTION_REPORT_KINDS,
  DISTRIBUTION_REPORT_LABELS,
  getCurrency,
  isCurrencyId,
  TARGET_METRIC_LABELS,
  type DistributionReport,
  type DistributionReportKind,
  type CurrencyCode,
} from '@serva/core';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  formatQuantity,
  Money,
  PageHeader,
  PrintIcon,
  ReportsIcon,
  Select,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { DateField } from '../../lib/DateField';
import { errorMessage } from '../../lib/api';
import { PrintSheet, usePrint } from '../../lib/print';
import { downloadCsv } from '../exportCsv';
import { getDistributionReport, listReps } from './api';
import { useLoad } from './parts';

type Row = DistributionReport['rows'][number];
type Column = DistributionReport['columns'][number];

/** «2026-11-01» of the month `today` is in */
export const monthStart = (today: string) => `${today.slice(0, 8)}01`;

/** What a `metric` cell is, from its row's own metric: money, a quantity in thousandths, or a count */
const metricKind = (row: Row): 'money' | 'qty' | 'int' =>
  row.metric === 'net_sales' || row.metric === 'collections' ? 'money' : row.metric === 'qty' ? 'qty' : 'int';

/** The target metric key is kept in the row (it decides the cell kind) but shown by its Arabic name */
const metricName = (col: Column, value: string) =>
  col.key === 'metric' && value in TARGET_METRIC_LABELS
    ? TARGET_METRIC_LABELS[value as keyof typeof TARGET_METRIC_LABELS]
    : value;

/** The cell as plain text, for the paper and the file */
export function plainCell(col: Column, row: Row, base: string): string | number {
  const value = row[col.key];
  if (value === null || value === undefined) return '';
  if (col.kind === 'text' || col.kind === 'date') return metricName(col, String(value));
  if (typeof value !== 'number') return String(value);
  const kind = col.kind === 'metric' ? metricKind(row) : col.kind;
  if (kind === 'money') {
    const cur = String(row.currency ?? base);
    return value / 10 ** (isCurrencyId(cur) ? getCurrency(cur).decimals : 2);
  }
  if (kind === 'qty') return value / 1000;
  return value;
}

function Cell({ col, row, base }: { col: Column; row: Row; base: CurrencyCode }) {
  const value = row[col.key];
  if (value === null || value === undefined) return <>—</>;
  if (typeof value !== 'number')
    return <>{col.kind === 'date' ? <bdi className="num">{value}</bdi> : metricName(col, value)}</>;
  const kind = col.kind === 'metric' ? metricKind(row) : col.kind;
  if (kind === 'money') {
    const cur = String(row.currency ?? base);
    return <Money minor={value} currency={(isCurrencyId(cur) ? cur : base) as CurrencyCode} />;
  }
  if (kind === 'qty') return <bdi className="num">{formatQuantity(value)}</bdi>;
  if (kind === 'percent') return <bdi className="num">{value}٪</bdi>;
  return <bdi className="num">{value}</bdi>;
}

const NUMERIC = new Set(['money', 'qty', 'int', 'percent', 'metric']);

/** «تقارير التوزيع»: sales, collections, debts, van stock, returns, visits, targets and commissions by rep, route, customer and product */
export function DistributionReportsPage() {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const today = new Date().toLocaleDateString('en-CA');
  const [kind, setKind] = useState<DistributionReportKind>('sales_by_rep');
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [repId, setRepId] = useState('');
  const [report, setReport] = useState<DistributionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reps = useLoad(listReps);
  const { paper, print } = usePrint();

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    getDistributionReport(kind, from, to, repId)
      .then((r) => live && setReport(r))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [kind, from, to, repId]);

  const columns: DataColumn<Row>[] = (report?.columns ?? []).map((col) => ({
    key: col.key,
    header: col.label,
    numeric: NUMERIC.has(col.kind),
    cell: (row) => <Cell col={col} row={row} base={base} />,
    ...(report?.totals && col.key in report.totals
      ? { total: <Cell col={col} row={report.totals} base={base} /> }
      : {}),
  }));

  function exportFile() {
    if (!report) return;
    downloadCsv(
      `${DISTRIBUTION_REPORT_LABELS[kind]}-${from}-${to}`,
      report.columns.map((c) => c.label),
      report.rows.map((row) => report.columns.map((c) => plainCell(c, row, base))),
    );
  }

  const cell = { border: '1px solid #000', padding: '4pt', textAlign: 'start' } as const;
  return (
    <AppShell>
      <title>تقارير التوزيع · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="تقارير التوزيع"
          description="مبيعات المندوبين وتحصيلهم وذممهم ومخزون سياراتهم وزياراتهم وأهدافهم."
          icon={<ReportsIcon />}
          actions={
            <Link to="/distribution/today">
              <Button variant="secondary">لوحة اليوم</Button>
            </Link>
          }
        />
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="التقرير"
            value={kind}
            onChange={(e) => setKind(e.target.value as DistributionReportKind)}
          >
            {DISTRIBUTION_REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {DISTRIBUTION_REPORT_LABELS[k]}
              </option>
            ))}
          </Select>
          <DateField label="من" value={from} onChange={setFrom} max={to} required />
          <DateField label="إلى" value={to} onChange={setTo} min={from} required />
          <Select label="المندوب" value={repId} onChange={(e) => setRepId(e.target.value)}>
            <option value="">كل المندوبين</option>
            {(reps.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.userName}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!report || report.rows.length === 0} onClick={exportFile}>
            صدّر إلى إكسل
          </Button>
          <Button
            variant="secondary"
            icon={<PrintIcon />}
            disabled={!report || report.rows.length === 0}
            onClick={() => print('A4')}
          >
            اطبع
          </Button>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!me.subscription.repsEnabled ? (
          <Alert tone="info" title="التوزيع غير متاح في باقتك">
            المندوبون والتقارير تأتي مع الباقات الأعلى.
          </Alert>
        ) : (
          <DataTable
            caption={DISTRIBUTION_REPORT_LABELS[kind]}
            columns={columns}
            rows={report?.rows ?? []}
            rowKey={(row) => JSON.stringify(row)}
            loading={!report && !error}
            empty={<EmptyState icon={ReportsIcon} title="لا أرقام في هذه الفترة." />}
          />
        )}
        {report?.note ? <p className="text-sm text-ink-muted">{report.note}</p> : null}
      </div>
      {paper && report ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="text-ink" style={{ fontSize: '11pt' }}>
            <h1 style={{ fontSize: '15pt', fontWeight: 700 }}>{DISTRIBUTION_REPORT_LABELS[kind]}</h1>
            <p style={{ marginBottom: '8pt' }}>
              من {from} إلى {to}
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} style={cell}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={JSON.stringify(row)}>
                    {report.columns.map((c) => (
                      <td key={c.key} style={cell}>
                        {c.kind === 'metric' || c.kind === 'money' || c.kind === 'qty' ? (
                          <Cell col={c} row={row} base={base} />
                        ) : (
                          plainCell(c, row, base)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {report.totals ? (
                  <tr>
                    {report.columns.map((c) => (
                      <td key={c.key} style={{ ...cell, fontWeight: 700 }}>
                        {c.key in report.totals! ? <Cell col={c} row={report.totals!} base={base} /> : ''}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
            {report.note ? <p style={{ marginTop: '8pt' }}>{report.note}</p> : null}
          </div>
        </PrintSheet>
      ) : null}
    </AppShell>
  );
}
