import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { MeResponse } from '@serva/core';
import {
  BackIcon,
  Button,
  Card,
  CheckIcon,
  ClockIcon,
  EmptyState,
  EyeIcon,
  cn,
  displayNumber,
  InfoIcon,
  Money,
  PrintIcon,
  WarningIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { zonedClock, zonedDateTime } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { Amt, BarList, PageTop, Panel, SalesPage, share, SERIES, Stack, type BarItem } from '../sales/ui';
import { seesDifference, SHIFTS_ACCESS } from './access';
import { getShift } from './api';
import type { ShiftCurrencyRow, ShiftReport } from './contracts';
import { currencyName, methodLabel, MOVEMENT_LABEL } from './labels';
import { ReportError, ReportLoading, ReportScreen } from './parts';
import { Difference, ShiftStatus } from './ShiftsPage';
import { useReport } from './useReport';

interface CashLine {
  key: string;
  label: string;
  value: (row: ShiftCurrencyRow) => ReactNode;
  strong?: boolean;
  /**
   * A term of the drawer that may not have happened: its amount in a currency. A line whose amount is
   * zero in every currency folds away on the screen behind «اعرض الصفوف الصفرية».
   */
  amount?: (row: ShiftCurrencyRow) => number;
}

/** The drawer's cash, one column per currency, as the Z report lays it out. */
function cashLines(withDifference: boolean): CashLine[] {
  // A term that did not happen in the shift shows as a dash, not as a row of zeros
  const term = (key: string, label: string, pick: (row: ShiftCurrencyRow) => number, sign = 1): CashLine => ({
    key,
    label,
    amount: pick,
    value: (row) => <Amt minor={sign * pick(row)} currency={row.currency} zero="dash" />,
  });
  const lines: CashLine[] = [
    term('opening', 'الرصيد الافتتاحي', (r) => r.openingMinor),
    term('sales', 'المبيعات نقداً', (r) => r.cashSalesMinor),
    term('change', 'الباقي المعطى', (r) => r.changeGivenMinor, -1),
    term('refunds', 'المرتجعات نقداً', (r) => r.refundsMinor, -1),
    term('receipts', 'دفعات الزبائن نقداً (وعربون التأجير)', (r) => r.receiptsMinor),
    term('payIn', 'الإيداع في الدرج', (r) => r.payInMinor),
    term('payOut', 'السحب من الدرج', (r) => r.payOutMinor, -1),
    term('drops', 'إلى الخزنة', (r) => r.dropsMinor, -1),
  ];
  if (withDifference) {
    lines.push({
      key: 'expected',
      label: 'النقد المتوقع',
      strong: true,
      value: (r) => (r.expectedMinor === null ? '—' : <Amt minor={r.expectedMinor} currency={r.currency} />),
    });
  }
  lines.push({
    key: 'counted',
    label: 'المعدود',
    strong: !withDifference,
    value: (r) => (r.countedMinor === null ? '—' : <Amt minor={r.countedMinor} currency={r.currency} />),
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

/**
 * The cash result first, in one band: per currency what the drawer should hold, what was counted and
 * the difference, with one sentence under it saying what to do. An open shift says it is still open;
 * without the key to see the difference only the count shows.
 */
function CashBand({ report, withDifference }: { report: ShiftReport; withDifference: boolean }) {
  const rows = report.byCurrency;
  if (rows.length === 0) return null;
  const counted = rows.filter((row) => row.countedMinor !== null);
  const shorts = rows.filter((row) => (row.differenceMinor ?? 0) < 0);
  const overs = rows.filter((row) => (row.differenceMinor ?? 0) > 0);
  const list = (items: ShiftCurrencyRow[]) =>
    items.map((row, i) => (
      <span key={row.currency}>
        {i > 0 ? ' و' : ''}
        {currencyName(row.currency)}{' '}
        <Amt minor={row.differenceMinor ?? 0} currency={row.currency} signDisplay="never" exact />
      </span>
    ));
  let verdict: ReactNode = null;
  if (counted.length === 0) {
    verdict = (
      <p className="sx-verdict info">
        <ClockIcon size={20} />
        <span>الوردية مفتوحة ولم يُعدّ النقد بعد.</span>
      </p>
    );
  } else if (withDifference) {
    verdict =
      shorts.length > 0 ? (
        <p className="sx-verdict bad">
          <WarningIcon size={20} />
          <span>فيه عجز بالصندوق: {list(shorts)}. اسأل الكاشير عنه قبل إقفال اليوم.</span>
        </p>
      ) : overs.length > 0 ? (
        <p className="sx-verdict warn">
          <WarningIcon size={20} />
          <span>فيه زيادة بالصندوق: {list(overs)}. راجع العدّ قبل إقفال اليوم.</span>
        </p>
      ) : (
        <p className="sx-verdict good">
          <CheckIcon size={20} />
          <span>الصندوق مطابق في كل العملات.</span>
        </p>
      );
  }
  const cell = (row: ShiftCurrencyRow, index: number, node: ReactNode) => (
    <div key={row.currency} className={cn('cur', index > 0 && 'sec')}>
      <span className="v">{node}</span>
      {rows.length > 1 ? <span className="cn">{currencyName(row.currency)}</span> : null}
    </div>
  );
  return (
    <section aria-label="نتيجة الصندوق" className="sx-card">
      <div className="sx-band" style={{ '--cols': withDifference ? 3 : 1 } as CSSProperties}>
        {withDifference ? (
          <div>
            <span className="sx-eyebrow">المتوقع في الدرج</span>
            {rows.map((row, i) =>
              cell(
                row,
                i,
                row.expectedMinor === null ? (
                  <span className="sx-z">—</span>
                ) : (
                  <Amt minor={row.expectedMinor} currency={row.currency} />
                ),
              ),
            )}
          </div>
        ) : null}
        <div>
          <span className="sx-eyebrow">المعدود فعلاً</span>
          {rows.map((row, i) =>
            cell(
              row,
              i,
              row.countedMinor === null ? (
                <span className="sx-z">—</span>
              ) : (
                <Amt minor={row.countedMinor} currency={row.currency} />
              ),
            ),
          )}
        </div>
        {withDifference ? (
          <div>
            <span className="sx-eyebrow">الفرق</span>
            {rows.map((row, i) => {
              const diff = row.differenceMinor;
              return (
                <div key={row.currency} className={cn('cur', i > 0 && 'sec')}>
                  {diff === null ? (
                    <span className="v sx-z">—</span>
                  ) : diff === 0 ? (
                    <span className="res">
                      <CheckIcon size={20} />
                      مطابق
                    </span>
                  ) : (
                    <span className={cn('res', diff < 0 && 'bad')}>
                      <WarningIcon size={20} />
                      {diff < 0 ? 'عجز' : 'زيادة'}{' '}
                      <Amt minor={diff} currency={row.currency} signDisplay="never" exact />
                    </span>
                  )}
                  {rows.length > 1 ? <span className="cn">{currencyName(row.currency)}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {verdict ? <div className="sx-band-note">{verdict}</div> : null}
    </section>
  );
}

/** The cash of the drawer by currency on the screen: the terms that happened, the rest one tap away */
function CashMatrix({ report, withDifference }: { report: ShiftReport; withDifference: boolean }) {
  const [all, setAll] = useState(false);
  const lines = cashLines(withDifference);
  const folded = lines.filter(
    (line) => line.amount && report.byCurrency.every((row) => line.amount!(row) === 0),
  );
  const shown = all ? lines : lines.filter((line) => !folded.includes(line));
  return (
    <>
      <table className="sx-mx">
        <caption className="sr-only">النقد لكل عملة</caption>
        <thead>
          <tr>
            <th scope="col">البند</th>
            {report.byCurrency.map((row) => (
              <th key={row.currency} scope="col" className="e">
                {currencyName(row.currency)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((line) => {
            const short =
              line.key === 'difference' && report.byCurrency.some((row) => (row.differenceMinor ?? 0) < 0);
            return (
              <tr key={line.key} className={cn(line.strong && 'sum', short && 'd')}>
                <th scope="row">{line.label}</th>
                {report.byCurrency.map((row) => (
                  <td key={row.currency} className="e sx-n">
                    {line.value(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {folded.length > 0 ? (
        <button type="button" className="sx-zero" aria-expanded={all} onClick={() => setAll(!all)}>
          <EyeIcon size={16} />
          {all
            ? 'أخفِ الصفوف الصفرية'
            : `اعرض ${displayNumber(String(folded.length), 'latn')} صفوف صفرية (${folded
                .slice(0, 3)
                .map((line) => line.label.replace(/ \(.*\)$/, ''))
                .join('، ')}…)`}
        </button>
      ) : null}
    </>
  );
}

/** The A4 print's cash table: every line, as the Z report lays it out. */
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
        <Row label="فتحها">{report.openedBy?.fullName ?? 'غير معروف'}</Row>
        <Row label="فُتحت">{report.openedAt ? zonedDateTime(report.openedAt, tz, digits) : '—'}</Row>
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
        <span>الكاشير: {report.openedBy?.fullName ?? 'غير معروف'}</span>
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
            الوردية <bdi dir="ltr">{report.number}</bdi> · {report.openedBy?.fullName ?? 'غير معروف'}
          </p>
          <p>
            {report.openedAt ? zonedDateTime(report.openedAt, me.tenant.timezone, digits) : '—'}
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

/** A shift's sales by method, each as its share of its own currency's sales (a pound and a dollar do not add up) */
function methodItems(
  report: ShiftReport,
  base: ShiftReport['byMethod'][number]['currency'],
  digits: 'latn' | 'arab',
) {
  const totals = new Map<string, number>();
  for (const row of report.byMethod)
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amountMinor);
  return report.byMethod.map((row, index): BarItem => {
    const total = totals.get(row.currency) ?? 0;
    const w = share(row.amountMinor, total);
    return {
      key: `${row.method}-${row.currency}`,
      name: methodLabel(row.method, row.currency, base),
      small: `${displayNumber(String(row.count), digits)} دفعة`,
      value: <Amt minor={row.amountMinor} currency={row.currency} />,
      extra: `${displayNumber(String(Math.round(w)), digits)}%`,
      w,
      color: SERIES[index] ?? SERIES[3],
    };
  });
}

function ShiftReportBody({ report, me }: { report: ShiftReport; me: MeResponse }) {
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const tz = me.tenant.timezone;
  const withDifference = showsDifference(me, report);
  const { paper, print } = usePrint();
  const items = methodItems(report, base, digits);
  const stackTotal = report.byMethod.reduce((sum, row) => sum + row.amountMinor, 0);

  return (
    <>
      <PageTop
        back={
          <Link to="/shifts" className="sx-back">
            <BackIcon size={16} />
            كل الورديات
          </Link>
        }
        title={report.status === 'closed' ? 'تقرير إغلاق الوردية' : 'تقرير الوردية'}
        subtitle={
          <>
            <bdi dir="ltr" className="sx-n">
              {report.number}
            </bdi>{' '}
            · {report.openedBy?.fullName ?? 'غير معروف'}
          </>
        }
        actions={
          <>
            <Button variant="ghost" icon={<PrintIcon />} onClick={() => print('A4')}>
              اطبع A4
            </Button>
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('80mm')}>
              اطبع 80 مم
            </Button>
          </>
        }
      />

      <p className="sx-metarow print:hidden">
        <ShiftStatus status={report.status} />
        <span>
          الكاشير <b>{report.openedBy?.fullName ?? 'غير معروف'}</b>
        </span>
        <span>
          الجهاز <b className="sx-n">{report.deviceCode}</b>
        </span>
        <span>
          من <b className="sx-n">{report.openedAt ? zonedDateTime(report.openedAt, tz, digits) : '—'}</b> إلى{' '}
          <b className="sx-n">
            {report.closedAt ? zonedDateTime(report.closedAt, tz, digits) : 'ما زالت مفتوحة'}
          </b>
        </span>
        <span>
          <b className="sx-n">{displayNumber(String(report.salesCount), digits)}</b> فواتير ·{' '}
          <Amt minor={report.salesTotalMinor} currency={base} exact />
        </span>
      </p>

      <CashBand report={report} withDifference={withDifference} />

      <div className="sx-grid">
        <Panel title="النقد لكل عملة" className="sx-c7" flush>
          <CashMatrix report={report} withDifference={withDifference} />
          <div className="sx-padb">
            <p className="sx-note">
              <InfoIcon size={16} />
              <span>
                عربون التأجير المقبوض نقداً يُحسب هنا مع دفعات الزبائن. وإذا رُدّ العربون في وردية غير التي
                قُبض فيها، ينقص من نقد وردية الرد، فيظهر نقدها المتوقع أقل.
              </span>
            </p>
            {withDifference ? null : (
              <p className="sx-note tight">
                <InfoIcon size={16} />
                <span>النقد المتوقع والفرق يظهران لمن يملك صلاحية رؤية فرق الصندوق.</span>
              </p>
            )}
          </div>
        </Panel>
        <Panel title="المبيعات حسب الطريقة والعملة" className="sx-c5" fill>
          {stackTotal > 0 &&
          report.byMethod.length > 1 &&
          new Set(report.byMethod.map((r) => r.currency)).size === 1 ? (
            <Stack
              label="حصة طرق الدفع من مبيعات الوردية"
              parts={items.map((item) => ({ key: item.key, w: item.w, color: item.color ?? SERIES[0]! }))}
            />
          ) : null}
          <BarList items={items} label="المبيعات حسب الطريقة والعملة" />
          <p className="sx-note tight">
            <InfoIcon size={16} />
            <span>البطاقة وشام كاش تُطابقان لاحقاً مع الكشف، لا من الدرج.</span>
          </p>
        </Panel>
      </div>

      {report.movements.length > 0 ? (
        <Panel title="الإيداع والسحب من الدرج" flush>
          <table className="sx-mx">
            <caption className="sr-only">الإيداع والسحب من الدرج</caption>
            <thead>
              <tr>
                <th scope="col">الحركة</th>
                <th scope="col">السبب</th>
                <th scope="col" className="e">
                  المبلغ
                </th>
                <th scope="col">وافق عليه</th>
                <th scope="col">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {report.movements.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold">{MOVEMENT_LABEL[row.kind]}</td>
                  <td>{row.reason ?? '—'}</td>
                  <td className="e sx-n">
                    <Amt minor={row.amountMinor} currency={row.currency} />
                  </td>
                  <td>{row.approvedBy?.fullName ?? '—'}</td>
                  <td className="sx-n">{zonedClock(row.at, tz, digits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : (
        <Panel title="الإيداع والسحب من الدرج">
          <p className="sx-wait">لا إيداع ولا سحب في هذه الوردية.</p>
        </Panel>
      )}

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
  // A shift that does not exist (an old link, a mistyped number) is an answer, not a failure to retry
  const { data, error, loading, retry } = useReport<ShiftReport | 'missing'>(id, () =>
    getShift(id).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 404) return 'missing' as const;
      throw cause;
    }),
  );
  const ready = data && data !== 'missing' ? data : null;

  return (
    <ReportScreen me={me} access={SHIFTS_ACCESS} title="تقرير الوردية">
      <SalesPage>
        {ready ? (
          <ShiftReportBody report={ready} me={me} />
        ) : (
          <>
            <Link to="/shifts" className="sx-back print:hidden">
              <BackIcon size={16} />
              كل الورديات
            </Link>
            {loading ? <ReportLoading label="نحمّل تقرير الوردية…" /> : null}
            {error ? <ReportError message={error} onRetry={retry} /> : null}
            {data === 'missing' ? (
              <Card>
                <EmptyState
                  icon={ClockIcon}
                  title="الوردية غير موجودة"
                  description="الرابط قديم أو الرقم غير صحيح. ارجع إلى قائمة الورديات واختر منها."
                />
              </Card>
            ) : null}
          </>
        )}
      </SalesPage>
    </ReportScreen>
  );
}
