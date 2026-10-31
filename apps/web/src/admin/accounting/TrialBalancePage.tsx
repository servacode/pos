import { useState } from 'react';
import {
  Badge,
  Balance,
  Button,
  Card,
  CheckCircleIcon,
  DataTable,
  EmptyState,
  Money,
  ReportsIcon,
  useDigits,
  WarningIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay, monthStart } from '../../lib/dates';
import { getTrialBalance } from '../reports/api';
import type { TrialBalance, TrialBalanceRow } from '../reports/contracts';
import { BranchSelect, DayField, defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { AccountingLayout } from './AccountingLayout';
import { debitSigned, downloadText, trialBalanceCsv } from './csv';

function BalancedBadge({ report }: { report: TrialBalance }) {
  return report.balanced ? (
    <Badge tone="success" className="gap-1">
      <CheckCircleIcon size={16} />
      متوازن
    </Badge>
  ) : (
    <Badge tone="danger" className="gap-1">
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
        <span>
          <bdi className="num text-ink-muted">{row.accountCode}</bdi> {row.accountName}
        </span>
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

  return (
    <AccountingLayout
      title="ميزان المراجعة"
      actions={
        <Button variant="secondary" disabled={!data || data.rows.length === 0} onClick={exportCsv}>
          صدّر CSV
        </Button>
      }
    >
      <Card className="flex flex-wrap items-end gap-4">
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
      </Card>
      {data ? (
        <div className="flex flex-wrap items-center gap-3">
          <BalancedBadge report={data} />
          <span className="text-sm text-ink-muted">
            من {dayText(data.from, digits)} إلى {dayText(data.to, digits)} · «عليه» رصيد مدين و«له» رصيد دائن
          </span>
        </div>
      ) : null}
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
    </AccountingLayout>
  );
}
