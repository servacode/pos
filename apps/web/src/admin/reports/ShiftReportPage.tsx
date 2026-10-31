import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { CurrencyCode, MeResponse } from '@serva/core';
import {
  BackIcon,
  Button,
  Card,
  cn,
  DataTable,
  displayNumber,
  Money,
  PrintIcon,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { zonedClock, zonedDateTime } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { seesDifference, SHIFTS_ACCESS } from './access';
import { getShift } from './api';
import type { ShiftCurrencyRow, ShiftMovement, ShiftReport } from './contracts';
import { currencyName, methodLabel, MOVEMENT_LABEL } from './labels';
import { PageHead, ReportError, ReportLoading, ReportScreen, Section } from './parts';
import { ShiftStatus } from './ShiftsPage';
import { useReport } from './useReport';

/** «عجز 1,500 ل.س», «زيادة 500 ل.س», «لا فرق» (print/ShiftReport › الفرق). */
export function Difference({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  if (minor === 0) return <span className="text-ink-muted">لا فرق</span>;
  return (
    <span className={cn('font-semibold', minor < 0 ? 'text-danger-ink' : 'text-ink')}>
      {minor < 0 ? 'عجز' : 'زيادة'} <Money minor={minor} currency={currency} signDisplay="never" />
    </span>
  );
}

interface CashLine {
  key: string;
  label: string;
  value: (row: ShiftCurrencyRow) => ReactNode;
  strong?: boolean;
}

/** The drawer's cash, one column per currency, as the Z report lays it out. */
function cashLines(withDifference: boolean): CashLine[] {
  const money = (pick: (row: ShiftCurrencyRow) => number, sign = 1) =>
    function value(row: ShiftCurrencyRow) {
      return <Money minor={sign * pick(row)} currency={row.currency} />;
    };
  const lines: CashLine[] = [
    { key: 'opening', label: 'الرصيد الافتتاحي', value: money((r) => r.openingMinor) },
    { key: 'sales', label: 'المبيعات نقداً', value: money((r) => r.cashSalesMinor) },
    { key: 'change', label: 'الباقي المعطى', value: money((r) => r.changeGivenMinor, -1) },
    { key: 'payIn', label: 'الإيداع في الدرج', value: money((r) => r.payInMinor) },
    { key: 'payOut', label: 'السحب من الدرج', value: money((r) => r.payOutMinor, -1) },
    { key: 'drops', label: 'إلى الخزنة', value: money((r) => r.dropsMinor, -1) },
  ];
  if (withDifference) {
    lines.push({
      key: 'expected',
      label: 'النقد المتوقع',
      strong: true,
      value: (r) =>
        r.expectedMinor === null ? '—' : <Money minor={r.expectedMinor} currency={r.currency} />,
    });
  }
  lines.push({
    key: 'counted',
    label: 'المعدود',
    strong: !withDifference,
    value: (r) => (r.countedMinor === null ? '—' : <Money minor={r.countedMinor} currency={r.currency} />),
  });
  if (withDifference) {
    lines.push({
      key: 'difference',
      label: 'الفرق',
      strong: true,
      value: (r) =>
        r.differenceMinor === null ? '—' : <Difference minor={r.differenceMinor} currency={r.currency} />,
    });
  }
  return lines;
}

/** Whether to show the expected cash and the difference: allowed, and sent by the server. */
function showsDifference(me: MeResponse, report: ShiftReport): boolean {
  return (
    seesDifference(me) &&
    report.byCurrency.some((row) => row.expectedMinor !== null || row.differenceMinor !== null)
  );
}

function CashTable({ report, withDifference }: { report: ShiftReport; withDifference: boolean }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">النقد لكل عملة</caption>
        <thead>
          <tr className="h-11 border-b border-line bg-surface-muted text-[0.8125rem] text-ink-muted">
            <th scope="col" className="px-3 text-start font-semibold">
              البند
            </th>
            {report.byCurrency.map((row) => (
              <th key={row.currency} scope="col" className="px-3 text-end font-semibold">
                {currencyName(row.currency)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cashLines(withDifference).map((line) => (
            <tr
              key={line.key}
              className={cn(
                'h-11 border-b border-line last:border-0',
                line.strong && 'bg-surface-total font-bold',
              )}
            >
              <th scope="row" className="px-3 text-start font-semibold text-ink">
                {line.label}
              </th>
              {report.byCurrency.map((row) => (
                <td key={row.currency} className="num px-3 text-end whitespace-nowrap">
                  {line.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MethodRow = ShiftReport['byMethod'][number];

function movementColumns(me: MeResponse, digits: 'latn' | 'arab'): DataColumn<ShiftMovement>[] {
  return [
    {
      key: 'kind',
      header: 'الحركة',
      cell: (row) => <span className="font-semibold">{MOVEMENT_LABEL[row.kind]}</span>,
    },
    { key: 'reason', header: 'السبب', cell: (row) => row.reason ?? '—' },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (row) => <Money minor={row.amountMinor} currency={row.currency} />,
    },
    { key: 'approvedBy', header: 'وافق عليه', cell: (row) => row.approvedBy?.fullName ?? '—' },
    { key: 'at', header: 'الوقت', cell: (row) => zonedClock(row.at, me.tenant.timezone, digits) },
  ];
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}

const Rule = () => <hr className="border-0 border-t border-dashed border-ink" />;

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span>{label}</span>
      <span className="num text-end">{children}</span>
    </div>
  );
}

/** The Z report on 80 mm paper (21; print/ShiftReport › تقرير Z), in the receipt's 72 mm. */
function ShiftReceipt({
  report,
  me,
  withDifference,
}: {
  report: ShiftReport;
  me: MeResponse;
  withDifference: boolean;
}) {
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const tz = me.tenant.timezone;
  const branch = me.branches.find((b) => b.id === report.branchId);
  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label="تقرير الوردية 80 مم"
      className="flex w-[72mm] flex-col gap-2 bg-surface px-1 py-3 text-[13px]/[1.55] font-semibold text-ink"
    >
      <div className="flex flex-col items-center text-center">
        <span className="text-xl font-bold">{me.tenant.name}</span>
        <span className="text-xs">
          {branch?.name ?? ''} · جهاز <bdi className="num">{report.deviceCode}</bdi>
        </span>
      </div>
      <Rule />
      <p className="text-lg font-bold">{report.status === 'closed' ? 'تقرير Z' : 'تقرير X'}</p>
      <div className="flex flex-col text-xs">
        <Row label="الوردية">
          <bdi dir="ltr">{report.number}</bdi>
        </Row>
        <Row label="فتحها">{report.openedBy.fullName}</Row>
        <Row label="فُتحت">{zonedDateTime(report.openedAt, tz, digits)}</Row>
        {report.closedAt ? <Row label="أُغلقت">{zonedDateTime(report.closedAt, tz, digits)}</Row> : null}
      </div>
      <Rule />
      <Row label="عدد الفواتير">{displayNumber(String(report.salesCount), digits)}</Row>
      <Rule />
      <p>المبيعات حسب الطريقة والعملة</p>
      {report.byMethod.map((row) => (
        <Row key={`${row.method}-${row.currency}`} label={methodLabel(row.method, row.currency, base)}>
          <Money minor={row.amountMinor} currency={row.currency} />
        </Row>
      ))}
      <Row label={<span className="text-base font-bold">مجموع المبيعات</span>}>
        <Money minor={report.salesTotalMinor} currency={base} className="text-base font-bold" />
      </Row>
      {report.movements.length > 0 ? (
        <>
          <Rule />
          <p>الإيداع والسحب من الدرج</p>
          {report.movements.map((move) => (
            <Row
              key={move.id}
              label={move.reason ? `${MOVEMENT_LABEL[move.kind]}: ${move.reason}` : MOVEMENT_LABEL[move.kind]}
            >
              <Money minor={move.amountMinor} currency={move.currency} />
            </Row>
          ))}
        </>
      ) : null}
      <Rule />
      <p>النقد لكل عملة</p>
      {report.byCurrency.map((row) => (
        <div key={row.currency} className="flex flex-col">
          <p className="text-xs">{currencyName(row.currency)}</p>
          <Row label="الرصيد الافتتاحي">
            <Money minor={row.openingMinor} currency={row.currency} />
          </Row>
          {withDifference && row.expectedMinor !== null ? (
            <Row label="النقد المتوقع">
              <Money minor={row.expectedMinor} currency={row.currency} />
            </Row>
          ) : null}
          {row.countedMinor !== null ? (
            <Row label="المعدود">
              <Money minor={row.countedMinor} currency={row.currency} />
            </Row>
          ) : null}
          {withDifference && row.differenceMinor !== null ? (
            <Row label="الفرق">
              <Difference minor={row.differenceMinor} currency={row.currency} />
            </Row>
          ) : null}
        </div>
      ))}
      <Rule />
      <div className="flex justify-between gap-4 pt-6 text-xs">
        <span>الكاشير: {report.openedBy.fullName}</span>
        <span>المدير</span>
      </div>
      <p className="text-center text-xs">
        سيرفا ·{' '}
        <span lang="en" dir="ltr">
          Serva
        </span>
      </p>
    </div>
  );
}

/** The same report on A4, for the file (21 › التقارير على A4). */
function ShiftA4({
  report,
  me,
  withDifference,
}: {
  report: ShiftReport;
  me: MeResponse;
  withDifference: boolean;
}) {
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  return (
    <div dir="rtl" lang="ar" aria-label="تقرير الوردية A4" className="flex flex-col gap-4 text-sm text-ink">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <div>
          <p className="text-lg font-bold">{me.tenant.name}</p>
          <p>
            الوردية <bdi dir="ltr">{report.number}</bdi> · {report.openedBy.fullName}
          </p>
          <p>
            {zonedDateTime(report.openedAt, me.tenant.timezone, digits)}
            {report.closedAt ? ` — ${zonedDateTime(report.closedAt, me.tenant.timezone, digits)}` : ''}
          </p>
        </div>
        <p className="text-xl font-bold">
          {report.status === 'closed' ? 'تقرير إغلاق الوردية' : 'تقرير الوردية'}
        </p>
      </div>
      <CashTable report={report} withDifference={withDifference} />
      <table className="w-full border-collapse">
        <caption className="py-1 text-start font-semibold">المبيعات حسب الطريقة والعملة</caption>
        <tbody>
          {report.byMethod.map((row) => (
            <tr key={`${row.method}-${row.currency}`} className="border-b border-line">
              <td className="py-1">{methodLabel(row.method, row.currency, base)}</td>
              <td className="num py-1 text-end">{row.count}</td>
              <td className="py-1 text-end">
                <Money minor={row.amountMinor} currency={row.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.movements.length > 0 ? (
        <table className="w-full border-collapse">
          <caption className="py-1 text-start font-semibold">الإيداع والسحب من الدرج</caption>
          <tbody>
            {report.movements.map((move) => (
              <tr key={move.id} className="border-b border-line">
                <td className="py-1">{MOVEMENT_LABEL[move.kind]}</td>
                <td className="py-1">{move.reason ?? ''}</td>
                <td className="py-1 text-end">
                  <Money minor={move.amountMinor} currency={move.currency} />
                </td>
                <td className="py-1">{move.approvedBy ? `وافق: ${move.approvedBy.fullName}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="flex justify-between pt-10">
        <span>توقيع الكاشير</span>
        <span>توقيع المدير</span>
      </div>
    </div>
  );
}

function ShiftReportBody({ report, me }: { report: ShiftReport; me: MeResponse }) {
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const tz = me.tenant.timezone;
  const withDifference = showsDifference(me, report);
  const { paper, print } = usePrint();
  const methodColumns: DataColumn<MethodRow>[] = [
    {
      key: 'method',
      header: 'الطريقة',
      cell: (row) => <span className="font-semibold">{methodLabel(row.method, row.currency, base)}</span>,
    },
    { key: 'count', header: 'الدفعات', numeric: true, cell: (row) => row.count },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (row) => <Money minor={row.amountMinor} currency={row.currency} />,
    },
  ];

  return (
    <>
      <PageHead
        crumbs={['البيع', 'الورديات']}
        title={report.status === 'closed' ? 'تقرير إغلاق الوردية' : 'تقرير الوردية'}
        subtitle={
          <>
            <bdi dir="ltr" className="num">
              {report.number}
            </bdi>{' '}
            · {report.openedBy.fullName}
          </>
        }
        actions={
          <>
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('80mm')}>
              اطبع 80 مم
            </Button>
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('A4')}>
              اطبع A4
            </Button>
          </>
        }
      />

      <Card>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MetaItem label="الحالة">
            <ShiftStatus status={report.status} />
          </MetaItem>
          <MetaItem label="الجهاز">
            <bdi className="num">{report.deviceCode}</bdi>
          </MetaItem>
          <MetaItem label="فُتحت">{zonedDateTime(report.openedAt, tz, digits)}</MetaItem>
          <MetaItem label="أُغلقت">
            {report.closedAt ? zonedDateTime(report.closedAt, tz, digits) : 'ما زالت مفتوحة'}
          </MetaItem>
          <MetaItem label="الفواتير">{displayNumber(String(report.salesCount), digits)}</MetaItem>
          <MetaItem label="المبيعات">
            <Money minor={report.salesTotalMinor} currency={base} />
          </MetaItem>
        </dl>
      </Card>

      <Section title="النقد لكل عملة">
        <CashTable report={report} withDifference={withDifference} />
        {withDifference ? null : (
          <p className="text-sm text-ink-muted">
            النقد المتوقع والفرق يظهران لمن يملك صلاحية رؤية فرق الصندوق.
          </p>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="المبيعات حسب الطريقة والعملة">
          <DataTable
            caption="المبيعات حسب الطريقة والعملة"
            columns={methodColumns}
            rows={report.byMethod}
            rowKey={(row) => `${row.method}-${row.currency}`}
          />
          <p className="text-sm text-ink-muted">البطاقة وشام كاش تُطابقان لاحقاً مع الكشف، لا من الدرج.</p>
        </Section>
        <Section title="الإيداع والسحب من الدرج">
          <DataTable
            caption="الإيداع والسحب من الدرج"
            columns={movementColumns(me, digits)}
            rows={report.movements}
            rowKey={(row) => row.id}
            empty={<p className="px-6 py-8 text-center text-ink-muted">لا إيداع ولا سحب في هذه الوردية.</p>}
          />
        </Section>
      </div>

      {paper ? (
        <PrintSheet paper={paper}>
          {paper === '80mm' ? (
            <ShiftReceipt report={report} me={me} withDifference={withDifference} />
          ) : (
            <ShiftA4 report={report} me={me} withDifference={withDifference} />
          )}
        </PrintSheet>
      ) : null}
    </>
  );
}

/**
 * The shift close report (11 › إغلاق الوردية, 10 › مطابقة الصندوق; admin/ReturnsShifts › تقرير Z,
 * print/ShiftReport): per currency the opening float, cash sales, change given, pay-ins, pay-outs,
 * drops, expected, counted and the difference (the last two only with shift.view_difference); the
 * sales by method; the drawer movements with who approved them. Prints on 80 mm and on A4.
 */
export function ShiftReportPage() {
  const me = useMe();
  const { id = '' } = useParams();
  const { data, error, loading, retry } = useReport(id, () => getShift(id));

  return (
    <ReportScreen me={me} access={SHIFTS_ACCESS} title="تقرير الوردية">
      <Link
        to="/shifts"
        className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-brand-ink print:hidden"
      >
        <BackIcon size={16} />
        كل الورديات
      </Link>
      {loading ? <ReportLoading label="نحمّل تقرير الوردية…" /> : null}
      {error ? <ReportError message={error} onRetry={retry} /> : null}
      {data ? <ShiftReportBody report={data} me={me} /> : null}
    </ReportScreen>
  );
}
