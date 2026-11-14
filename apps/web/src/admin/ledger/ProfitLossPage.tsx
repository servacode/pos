import { useState, type ReactNode } from 'react';
import type { MeResponse, PnlAccount, ProfitLoss } from '@serva/core';
import { Button, Card, EmptyState, Money, PrintIcon, ReportsIcon, Skeleton, StatTile, cn } from '@serva/ui';
import { useDigits } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay, monthStart } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { AccountingLayout } from '../accounting/AccountingLayout';
import { downloadText } from '../accounting/csv';
import { AccountName, PeriodBar } from '../accounting/parts';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getProfitLoss } from './api';
import { profitLossCsv } from './csv';

function branchName(me: MeResponse, branchId: string | null): string {
  if (!branchId) return 'كل الفروع';
  return me.branches.find((branch) => branch.id === branchId)?.name ?? 'الفرع';
}

/** One line of the statement: a label and its amount, a total line in bold above a rule. */
function Row({
  label,
  children,
  strong = false,
  indent = false,
}: {
  label: ReactNode;
  children: ReactNode;
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5',
        indent && 'ps-6 text-ink-muted',
        strong && 'border-t border-line pt-2.5 font-bold text-ink',
      )}
    >
      <dt>{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function Accounts({ accounts, base }: { accounts: PnlAccount[]; base: ProfitLoss['baseCurrency'] }) {
  return (
    <>
      {accounts.map((a) => (
        <Row key={a.accountCode} indent label={<AccountName code={a.accountCode} name={a.accountName} />}>
          <Money minor={a.amountMinor} currency={base} />
        </Row>
      ))}
    </>
  );
}

/** The statement itself: used on screen and, in the same words, on the A4 sheet. */
function Statement({ p }: { p: ProfitLoss }) {
  const base = p.baseCurrency;
  return (
    <dl className="flex flex-col">
      <Row label="الإيرادات (بعد الحسميات والمردودات)" strong>
        <Money minor={p.revenue.totalMinor} currency={base} />
      </Row>
      <Accounts accounts={p.revenue.accounts} base={base} />
      <Row label="كلفة المبيعات" strong>
        <Money minor={p.costOfSales.totalMinor} currency={base} />
      </Row>
      <Accounts accounts={p.costOfSales.accounts} base={base} />
      <Row label="مجمل الربح" strong>
        <Money minor={p.grossProfitMinor} currency={base} negativeTone />
      </Row>
      {p.otherIncome.accounts.length > 0 ? (
        <>
          <Row label="إيرادات أخرى" strong>
            <Money minor={p.otherIncome.totalMinor} currency={base} />
          </Row>
          <Accounts accounts={p.otherIncome.accounts} base={base} />
        </>
      ) : null}
      <Row label="المصروفات" strong>
        <Money minor={p.expenses.totalMinor} currency={base} />
      </Row>
      {p.expenses.groups.map((g) => (
        <div key={g.code}>
          <Row label={g.name} indent>
            <Money minor={g.totalMinor} currency={base} />
          </Row>
          {g.accounts.map((a) => (
            <Row key={a.accountCode} indent label={<AccountName code={a.accountCode} name={a.accountName} />}>
              <span className="text-sm">
                <Money minor={a.amountMinor} currency={base} />
              </span>
            </Row>
          ))}
        </div>
      ))}
      <Row label="صافي الربح" strong>
        <Money minor={p.netProfitMinor} currency={base} negativeTone className="text-lg" />
      </Row>
    </dl>
  );
}

/**
 * «قائمة الدخل» (29): for a period and a branch, read from the journal: revenue after discounts and
 * returns, the cost of sales, the gross profit, the expenses by kind and the net. A cancelled
 * expense or a reversed entry nets out of it. It prints on A4 and saves as CSV.
 */
export function ProfitLossPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const { data, error, loading } = useReport(`${from}|${to}|${branchId ?? ''}`, () =>
    getProfitLoss({ from, to, branchId }),
  );
  const { paper, print } = usePrint();
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const empty =
    data !== null &&
    data.revenue.accounts.length === 0 &&
    data.costOfSales.accounts.length === 0 &&
    data.expenses.groups.length === 0 &&
    data.otherIncome.accounts.length === 0;

  const tile = (value: (p: ProfitLoss) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  return (
    <AccountingLayout
      title="قائمة الدخل"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!data || empty}
            onClick={() =>
              data && downloadText(`قائمة-الدخل-${data.from}-${data.to}.csv`, profitLossCsv(data))
            }
          >
            صدّر CSV
          </Button>
          <Button variant="secondary" icon={<PrintIcon />} disabled={!data} onClick={() => print('A4')}>
            اطبع
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3 print:hidden">
        <StatTile
          label="الإيرادات"
          value={tile((p) => (
            <Money minor={p.revenue.totalMinor} currency={base} />
          ))}
        />
        <StatTile
          label="مجمل الربح"
          value={tile((p) => (
            <Money minor={p.grossProfitMinor} currency={base} negativeTone />
          ))}
        />
        <StatTile
          label="صافي الربح"
          value={tile((p) => (
            <Money minor={p.netProfitMinor} currency={base} negativeTone />
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
        />
      </div>
      <Card className="print:hidden">
        {error ? (
          <p role="alert" className="text-danger-ink">
            {error}
          </p>
        ) : loading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : empty ? (
          <EmptyState
            icon={ReportsIcon}
            title="لا حركة في هذه الفترة."
            description="تظهر هنا المبيعات والكلفة والمصاريف حين تُسجَّل."
          />
        ) : (
          <Statement p={data} />
        )}
      </Card>
      <p className="text-sm text-ink-subtle print:hidden">
        الكلفة تدخل بقيد الكلفة اليومي، فإن لم يُرحَّل بعد لأيام الفترة ظهر مجمل الربح أكبر مما هو.
      </p>
      {data && paper ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
            <div className="flex items-start justify-between border-b border-ink pb-2">
              <div>
                <p className="text-lg font-bold">{me.tenant.name}</p>
                <p>{branchName(me, branchId)}</p>
              </div>
              <div className="text-end">
                <p className="text-xl font-bold">قائمة الدخل</p>
                <p>
                  من {dayText(data.from, digits)} إلى {dayText(data.to, digits)}
                </p>
              </div>
            </div>
            <Statement p={data} />
          </div>
        </PrintSheet>
      ) : null}
    </AccountingLayout>
  );
}
