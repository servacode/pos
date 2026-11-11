import { useState, type ReactNode } from 'react';
import {
  Badge,
  Balance,
  Button,
  CheckCircleIcon,
  DataTable,
  EmptyState,
  Money,
  ReportsIcon,
  Skeleton,
  StatTile,
  useDigits,
  WarningIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay, monthStart } from '../../lib/dates';
import { getTrialBalance } from '../reports/api';
import type { TrialBalance, TrialBalanceRow } from '../reports/contracts';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { AccountingLayout } from './AccountingLayout';
import { debitSigned, downloadText, trialBalanceCsv } from './csv';
import { AccountName, PeriodBar } from './parts';

function BalancedBadge({ report }: { report: TrialBalance }) {
  return report.balanced ? (
    <Badge tone="success">
      <CheckCircleIcon size={16} />
      متوازن
    </Badge>
  ) : (
    <Badge tone="danger">
      <WarningIcon size={16} />
      غير متوازن
    </Badge>
  );
}

/**
 * «ميزان المراجعة بالمجاميع والأرصدة» (19; admin/FinancialStatements › ميزان المراجعة): for each
 * account the opening balance, the period's debit and credit, and the closing balance, written
 * «عليه» or «له» with no minus sign (14), the «متوازن» badge, and the CSV for Excel.
 */
export function TrialBalancePage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const { data, error, loading, retry } = useReport(`${from}|${to}|${branchId ?? ''}`, () =>
    getTrialBalance({ from, to, branchId }),
  );
  const base = me.settings.baseCurrency;

  const columns: DataColumn<TrialBalanceRow>[] = [
    {
      key: 'account',
      header: 'الحساب',
      cell: (row) => (
        <AccountName code={row.accountCode} name={row.accountName} strong className="whitespace-nowrap" />
      ),
      total: 'المجموع',
    },
    {
      key: 'opening',
      header: 'رصيد أول المدة',
      numeric: true,
      cell: (row) => <Balance minor={debitSigned(row.openingMinor, row.type)} currency={base} />,
    },
    {
      key: 'debit',
      header: 'مدين',
      numeric: true,
      cell: (row) => <Money minor={row.debitMinor} currency={base} />,
      total: data ? <Money minor={data.totals.debitMinor} currency={base} /> : null,
    },
    {
      key: 'credit',
      header: 'دائن',
      numeric: true,
      cell: (row) => <Money minor={row.creditMinor} currency={base} />,
      total: data ? <Money minor={data.totals.creditMinor} currency={base} /> : null,
    },
    {
      key: 'closing',
      header: 'رصيد آخر المدة',
      numeric: true,
      cell: (row) => <Balance minor={debitSigned(row.closingMinor, row.type)} currency={base} />,
    },
  ];

  function exportCsv() {
    if (!data) return;
    downloadText(`ميزان-المراجعة-${data.from}-${data.to}.csv`, trialBalanceCsv(data, base));
  }

  // A tile's number: grey while the period loads, a dash when it could not.
  const kpi = (value: (report: TrialBalance) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  return (
    <AccountingLayout
      title="ميزان المراجعة"
      actions={
        <Button variant="secondary" disabled={!data || data.rows.length === 0} onClick={exportCsv}>
          صدّر CSV
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="مجموع المدين"
          value={kpi((report) => (
            <Money minor={report.totals.debitMinor} currency={base} />
          ))}
        />
        <StatTile
          label="مجموع الدائن"
          value={kpi((report) => (
            <Money minor={report.totals.creditMinor} currency={base} />
          ))}
        />
      </div>
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
          <>
            <BalancedBadge report={data} />
            <span className="text-sm text-ink-muted">
              من {dayText(data.from, digits)} إلى {dayText(data.to, digits)}
            </span>
          </>
        ) : null}
      </PeriodBar>
      <div className="flex flex-col gap-2">
        <DataTable
          caption="ميزان المراجعة"
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.accountCode}
          loading={loading}
          error={error ?? undefined}
          onRetry={retry}
          empty={
            <EmptyState
              icon={ReportsIcon}
              title="لا حركة على الحسابات في هذه الفترة."
              description="اختر فترة أخرى، أو انتظر وصول فواتير اليوم."
            />
          }
        />
        <p className="text-sm text-ink-subtle">«عليه» رصيد مدين، و«له» رصيد دائن.</p>
      </div>
    </AccountingLayout>
  );
}
