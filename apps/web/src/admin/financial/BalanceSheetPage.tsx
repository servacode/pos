import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { BalanceSheet, BalanceSheetSection } from '@serva/core';
import { Button, EmptyState, Money, PrintIcon, ReportsIcon, Skeleton, StatTile, useDigits } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { AccountingLayout } from '../accounting/AccountingLayout';
import { AccountName } from '../accounting/parts';
import { downloadCsv } from '../exportCsv';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getBalanceSheet } from './api';
import { balanceSheetTable } from './csv';
import { CheckBadge, DayBar, PrintHead, StatementCard, StatementLine } from './parts';
import { DayField } from '../reports/parts';

/** The last day of the month before `day`: the date a month-on-month comparison starts from. */
function monthBefore(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m - 1, 0));
  return last.toISOString().slice(0, 10);
}

function Section({
  title,
  section,
  sheet,
  link,
}: {
  title: string;
  section: BalanceSheetSection;
  sheet: BalanceSheet;
  link: boolean;
}) {
  const base = sheet.baseCurrency;
  const compare = sheet.compareTo !== null;
  const money = (minor: number | null) => <Money minor={minor ?? 0} currency={base} negativeTone />;
  const values = (now: number, before: number | null) =>
    compare ? [money(now), money(before)] : [money(now)];
  return (
    <dl className="flex flex-col">
      <StatementLine label={title} values={values(section.totalMinor, section.previousTotalMinor)} strong />
      {section.groups.map((g) => (
        <div key={g.code}>
          <StatementLine label={g.name} values={values(g.totalMinor, g.previousTotalMinor)} indent />
          {g.accounts.map((a) => (
            <StatementLine
              key={`${a.accountCode}|${a.accountName}`}
              indent
              label={
                a.accountCode && link ? (
                  <Link
                    to={`/accounting/reports/ledger?code=${a.accountCode}&from=${sheet.yearStart}&to=${sheet.asOf}`}
                    className="font-semibold text-brand-ink underline-offset-4 hover:underline"
                  >
                    <AccountName code={a.accountCode} name={a.accountName} />
                  </Link>
                ) : a.accountCode ? (
                  <AccountName code={a.accountCode} name={a.accountName} />
                ) : (
                  a.accountName
                )
              }
              values={values(a.amountMinor, a.previousMinor)}
            />
          ))}
        </div>
      ))}
    </dl>
  );
}

/** The statement itself: on screen (with a link from each account to its ledger) and, in the same words, on A4. */
function Statement({ sheet, link }: { sheet: BalanceSheet; link: boolean }) {
  const base = sheet.baseCurrency;
  const compare = sheet.compareTo !== null;
  const digits = useDigits();
  return (
    <div className="flex flex-col gap-4">
      {compare ? (
        <StatementLine
          label=""
          muted
          values={[dayText(sheet.asOf, digits), dayText(sheet.compareTo!, digits)]}
        />
      ) : null}
      <Section title="الأصول" section={sheet.assets} sheet={sheet} link={link} />
      <Section title="الخصوم" section={sheet.liabilities} sheet={sheet} link={link} />
      <Section title="حقوق الملكية" section={sheet.equity} sheet={sheet} link={link} />
      <dl>
        <StatementLine
          label="مجموع الخصوم وحقوق الملكية"
          strong
          values={[
            <Money key="n" minor={sheet.liabilitiesAndEquityMinor} currency={base} negativeTone />,
            ...(compare
              ? [
                  <Money
                    key="p"
                    minor={sheet.previousLiabilitiesAndEquityMinor ?? 0}
                    currency={base}
                    negativeTone
                  />,
                ]
              : []),
          ]}
        />
      </dl>
    </div>
  );
}

/**
 * «الميزانية العمومية» (19, 29): what the store has and owes on a day, grouped by the chart of
 * accounts: assets, liabilities and equity, with the profit made so far shown inside equity so that
 * assets always equal liabilities plus equity. A second date shows beside it. Each account opens its
 * ledger. Read from the journal; it prints on A4 and saves as CSV.
 */
export function BalanceSheetPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [asOf, setAsOf] = useState(today);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const { data, error, loading } = useReport(`${asOf}|${compareTo ?? ''}|${branchId ?? ''}`, () =>
    getBalanceSheet({ asOf, compareTo, branchId }),
  );
  const { paper, print } = usePrint();
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const empty =
    data !== null &&
    data.assets.groups.length + data.liabilities.groups.length + data.equity.groups.length === 0;
  const tile = (value: (s: BalanceSheet) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  return (
    <AccountingLayout
      title="الميزانية العمومية"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!data || empty}
            onClick={() => {
              if (!data) return;
              const table = balanceSheetTable(data);
              downloadCsv(`الميزانية-${data.asOf}`, table.headers, table.rows);
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
          label="مجموع الأصول"
          value={tile((s) => (
            <Money minor={s.assets.totalMinor} currency={base} />
          ))}
        />
        <StatTile
          label="مجموع الخصوم"
          value={tile((s) => (
            <Money minor={s.liabilities.totalMinor} currency={base} />
          ))}
        />
        <StatTile
          label="حقوق الملكية"
          footnote="مع ربح الفترة"
          value={tile((s) => (
            <Money minor={s.equity.totalMinor} currency={base} negativeTone />
          ))}
        />
      </div>
      <div className="print:hidden">
        <DayBar
          me={me}
          today={today}
          label="الوضع بتاريخ"
          value={asOf}
          onChange={setAsOf}
          branchId={branchId}
          onBranch={setBranchId}
        >
          {compareTo ? (
            <>
              <DayField label="قارن مع" value={compareTo} max={asOf} onChange={setCompareTo} />
              <Button variant="secondary" onClick={() => setCompareTo(null)}>
                بدون مقارنة
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setCompareTo(monthBefore(asOf))}>
              قارن بتاريخ سابق
            </Button>
          )}
          {data ? (
            <CheckBadge ok={data.balanced} good="الأصول = الخصوم + الملكية" bad="الميزانية غير متوازنة" />
          ) : null}
        </DayBar>
      </div>
      <StatementCard error={error} loading={loading || !data}>
        {data && empty ? (
          <EmptyState
            icon={ReportsIcon}
            title="لا أرصدة حتى هذا التاريخ."
            description="تظهر هنا الأصول والخصوم بعد أول قيد في الدفاتر."
          />
        ) : data ? (
          <Statement sheet={data} link />
        ) : null}
      </StatementCard>
      <p className="text-sm text-ink-subtle print:hidden">
        ربح السنة الحالية يدخل حقوق الملكية حتى يُرحَّل في نهاية السنة. زبون دفع أكثر من دينه يظهر في الخصوم.
      </p>
      {data && paper ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
            <PrintHead
              me={me}
              branchId={branchId}
              title="الميزانية العمومية"
              period={`بتاريخ ${dayText(data.asOf, digits)}`}
            />
            <Statement sheet={data} link={false} />
          </div>
        </PrintSheet>
      ) : null}
    </AccountingLayout>
  );
}
