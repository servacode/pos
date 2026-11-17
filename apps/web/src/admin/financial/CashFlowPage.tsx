import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CASH_FLOW_LABEL, type CashFlow, type CashFlowAccount, type CashFlowCategoryRow } from '@serva/core';
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
import { AccountName, PeriodBar } from '../accounting/parts';
import { downloadCsv } from '../exportCsv';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getCashFlow } from './api';
import { cashFlowTable } from './csv';
import { CheckBadge, PrintHead, period } from './parts';

function Tables({ flow, link }: { flow: CashFlow; link: boolean }) {
  const base = flow.baseCurrency;
  const kinds: DataColumn<CashFlowCategoryRow>[] = [
    {
      key: 'kind',
      header: 'نوع الحركة',
      cell: (r) => <span className="font-semibold text-ink">{CASH_FLOW_LABEL[r.category]}</span>,
      total: 'المجموع',
    },
    {
      key: 'in',
      header: 'قبض',
      numeric: true,
      cell: (r) => <Money minor={r.inMinor} currency={base} />,
      total: <Money minor={flow.totals.inMinor} currency={base} />,
    },
    {
      key: 'out',
      header: 'دفع',
      numeric: true,
      cell: (r) => <Money minor={r.outMinor} currency={base} />,
      total: <Money minor={flow.totals.outMinor} currency={base} />,
    },
    {
      key: 'net',
      header: 'الصافي',
      numeric: true,
      cell: (r) => <Money minor={r.netMinor} currency={base} negativeTone />,
      total: (
        <Money minor={flow.totals.closingMinor - flow.totals.openingMinor} currency={base} negativeTone />
      ),
    },
  ];
  const accounts: DataColumn<CashFlowAccount>[] = [
    {
      key: 'account',
      header: 'الحساب النقدي',
      cell: (a) =>
        link ? (
          <Link
            to={`/accounting/reports/ledger?code=${a.accountCode}&from=${flow.from}&to=${flow.to}`}
            className="font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            <AccountName code={a.accountCode} name={a.accountName} />
          </Link>
        ) : (
          <AccountName code={a.accountCode} name={a.accountName} />
        ),
      total: 'المجموع',
    },
    {
      key: 'opening',
      header: 'أول المدة',
      numeric: true,
      cell: (a) => <Money minor={a.openingMinor} currency={base} negativeTone />,
      total: <Money minor={flow.totals.openingMinor} currency={base} negativeTone />,
    },
    {
      key: 'in',
      header: 'قبض',
      numeric: true,
      cell: (a) => <Money minor={a.inMinor} currency={base} />,
    },
    {
      key: 'out',
      header: 'دفع',
      numeric: true,
      cell: (a) => <Money minor={a.outMinor} currency={base} />,
    },
    {
      key: 'closing',
      header: 'آخر المدة',
      numeric: true,
      cell: (a) => <Money minor={a.closingMinor} currency={base} negativeTone />,
      total: <Money minor={flow.totals.closingMinor} currency={base} negativeTone />,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="القبض والدفع حسب النوع"
        columns={kinds}
        rows={flow.categories}
        rowKey={(r) => r.category}
      />
      <DataTable
        caption="الصندوق والخزنة والبنك والمحافظ"
        columns={accounts}
        rows={flow.accounts}
        rowKey={(a) => a.accountCode}
      />
    </div>
  );
}

/**
 * «التدفق النقدي» (19, 29): the direct method. For a period, the money that came into and went out
 * of the cash drawers, the safe, the bank and the wallets, by kind (sales, customer receipts,
 * supplier payments, expenses, owner's capital and drawings, others), and each cash account from
 * its opening balance to its closing balance. A move between the store's own cash accounts nets to
 * nothing. Read from the journal; the closing equals the accounts' balances.
 */
export function CashFlowPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const { data, error, loading, retry } = useReport(`${from}|${to}|${branchId ?? ''}`, () =>
    getCashFlow({ from, to, branchId }),
  );
  const { paper, print } = usePrint();
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const tile = (value: (f: CashFlow) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  return (
    <AccountingLayout
      title="التدفق النقدي"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!data || data.accounts.length === 0}
            onClick={() => {
              if (!data) return;
              const table = cashFlowTable(data);
              downloadCsv(`التدفق-النقدي-${data.from}-${data.to}`, table.headers, table.rows);
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
      <div className="grid gap-4 sm:grid-cols-4 print:hidden">
        <StatTile
          label="النقد أول المدة"
          value={tile((f) => (
            <Money minor={f.totals.openingMinor} currency={base} negativeTone />
          ))}
        />
        <StatTile
          label="مجموع القبض"
          value={tile((f) => (
            <Money minor={f.totals.inMinor} currency={base} />
          ))}
        />
        <StatTile
          label="مجموع الدفع"
          value={tile((f) => (
            <Money minor={f.totals.outMinor} currency={base} />
          ))}
        />
        <StatTile
          label="النقد آخر المدة"
          value={tile((f) => (
            <Money minor={f.totals.closingMinor} currency={base} negativeTone />
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
            <CheckBadge ok={data.balanced} good="الرصيد الأخير يطابق الحركة" bad="الرصيد الأخير لا يطابق" />
          ) : null}
        </PeriodBar>
      </div>
      <div className="print:hidden">
        {error ? (
          <DataTable
            caption="التدفق النقدي"
            columns={[]}
            rows={[]}
            rowKey={() => 0}
            error={error}
            onRetry={retry}
          />
        ) : loading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : data.accounts.length === 0 ? (
          <EmptyState
            icon={ReportsIcon}
            title="لا حركة نقدية في هذه الفترة."
            description="اختر فترة أخرى، أو انتظر وصول فواتير اليوم."
          />
        ) : (
          <Tables flow={data} link />
        )}
      </div>
      <p className="text-sm text-ink-subtle print:hidden">
        التحويل بين الصندوق والخزنة والبنك لا يغيّر مجموع النقد، ويظهر بسطر مستقل.
      </p>
      {data && paper ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
            <PrintHead
              me={me}
              branchId={branchId}
              title="التدفق النقدي"
              period={period(data.from, data.to, digits)}
            />
            <Tables flow={data} link={false} />
          </div>
        </PrintSheet>
      ) : null}
    </AccountingLayout>
  );
}
