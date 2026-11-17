import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { AccountLedger, AccountLedgerLine, AccountRow, JournalSourceType } from '@serva/core';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Money,
  PrintIcon,
  ReportsIcon,
  Select,
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
import { listAccounts } from '../reports/api';
import { sourceLabel } from '../reports/labels';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getAccountLedger } from './api';
import { accountLedgerTable } from './csv';
import { PrintHead, period } from './parts';

const isDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

function Lines({
  ledger,
  loading,
  error,
  limit,
}: {
  ledger: AccountLedger | null;
  loading: boolean;
  error?: string;
  /** How many lines the screen draws (the sheet draws all) */
  limit?: number;
}) {
  const base = ledger?.baseCurrency ?? 'SYP';
  const columns: DataColumn<AccountLedgerLine>[] = [
    { key: 'date', header: 'التاريخ', cell: (l) => <bdi className="num">{l.date}</bdi> },
    {
      key: 'entry',
      header: 'رقم القيد',
      cell: (l) => (
        <bdi dir="ltr" className="num">
          {l.entryNumber}
        </bdi>
      ),
    },
    {
      key: 'what',
      header: 'البيان',
      cell: (l) => (
        <span className="text-ink">
          {sourceLabel(l.sourceType as JournalSourceType)}
          {l.sourceNumber ? (
            <>
              {' '}
              <bdi dir="ltr" className="num">
                {l.sourceNumber}
              </bdi>
            </>
          ) : null}
          {ledger?.account.isGroup ? <span className="text-ink-subtle"> · {l.accountName}</span> : null}
          {l.memo ? <span className="text-ink-muted"> · {l.memo}</span> : null}
        </span>
      ),
      total: 'المجموع',
    },
    {
      key: 'debit',
      header: 'مدين',
      numeric: true,
      cell: (l) => (l.debitMinor ? <Money minor={l.debitMinor} currency={base} /> : '—'),
      total: ledger ? <Money minor={ledger.totalDebitMinor} currency={base} /> : null,
    },
    {
      key: 'credit',
      header: 'دائن',
      numeric: true,
      cell: (l) => (l.creditMinor ? <Money minor={l.creditMinor} currency={base} /> : '—'),
      total: ledger ? <Money minor={ledger.totalCreditMinor} currency={base} /> : null,
    },
    {
      key: 'balance',
      header: 'الرصيد',
      numeric: true,
      cell: (l) => <Money minor={l.balanceMinor} currency={base} negativeTone />,
      total: ledger ? <Money minor={ledger.closingMinor} currency={base} negativeTone /> : null,
    },
  ];
  return (
    <DataTable
      caption="حركة الحساب"
      columns={columns}
      rows={limit ? (ledger?.lines.slice(0, limit) ?? []) : (ledger?.lines ?? [])}
      rowKey={(l) => `${l.entryId}|${l.accountCode}|${l.debitMinor}|${l.creditMinor}|${l.balanceMinor}`}
      loading={loading}
      error={error}
      empty={
        <EmptyState
          icon={ReportsIcon}
          title="لا حركة على هذا الحساب في الفترة."
          description="الرصيد أول المدة هو نفسه آخرها."
        />
      }
    />
  );
}

/**
 * «دفتر الأستاذ» (19): every movement on one account in a period, one line per journal line, with
 * the running balance on the account's own side (a cash account: what it holds; sales: what was
 * earned). A group (the drawers) takes in the accounts under it. The account, period and branch
 * are in the address, so a balance-sheet line opens straight onto it. Prints on A4 and saves as CSV.
 */
export function AccountLedgerPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(() => params.get('code') ?? '1110');
  const [from, setFrom] = useState(() =>
    isDay(params.get('from')) ? params.get('from')! : monthStart(today),
  );
  const [to, setTo] = useState(() => (isDay(params.get('to')) ? params.get('to')! : today));
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me, true));
  const accounts = useReport('accounts', () => listAccounts());
  const { data, error, loading } = useReport(`${code}|${from}|${to}|${branchId ?? ''}`, () =>
    getAccountLedger({ code, from, to, branchId }),
  );
  const { paper, print } = usePrint();
  const [shown, setShown] = useState(50);

  const choose = (next: { code?: string; from?: string; to?: string }) => {
    if (next.code !== undefined) setCode(next.code);
    if (next.from !== undefined) setFrom(next.from);
    if (next.to !== undefined) setTo(next.to);
    setParams(
      {
        code: next.code ?? code,
        from: next.from ?? from,
        to: next.to ?? to,
      },
      { replace: true },
    );
  };
  // Levels one and two are only headings; the rest are the accounts and the groups of sub-accounts
  const choices: AccountRow[] = (accounts.data?.items ?? []).filter((a) => a.code.length >= 4);

  return (
    <AccountingLayout
      title="دفتر الأستاذ"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!data || data.lines.length === 0}
            onClick={() => {
              if (!data) return;
              const table = accountLedgerTable(data);
              downloadCsv(
                `دفتر-الأستاذ-${data.account.code}-${data.from}-${data.to}`,
                table.headers,
                table.rows,
              );
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
          label="الرصيد أول المدة"
          value={data ? <Money minor={data.openingMinor} currency={data.baseCurrency} negativeTone /> : '—'}
        />
        <StatTile
          label="مدين / دائن"
          value={
            data ? (
              <span>
                <Money minor={data.totalDebitMinor} currency={data.baseCurrency} /> /{' '}
                <Money minor={data.totalCreditMinor} currency={data.baseCurrency} />
              </span>
            ) : (
              '—'
            )
          }
        />
        <StatTile
          label="الرصيد آخر المدة"
          value={data ? <Money minor={data.closingMinor} currency={data.baseCurrency} negativeTone /> : '—'}
        />
      </div>
      <div className="print:hidden">
        <PeriodBar
          me={me}
          today={today}
          from={from}
          to={to}
          branchId={branchId}
          onFrom={(day) => choose({ from: day })}
          onTo={(day) => choose({ to: day })}
          onBranch={setBranchId}
        >
          <Select
            label="الحساب"
            value={code}
            onChange={(event) => choose({ code: event.target.value })}
            className="min-w-56"
          >
            {choices.length === 0 ? <option value={code}>{code}</option> : null}
            {choices.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
        </PeriodBar>
      </div>
      {data?.truncated ? (
        <Alert tone="warning">
          الفترة فيها حركات أكثر مما يُعرض هنا، فالجدول يقف قبل نهايتها. اختر فترة أقصر، فأرصدة أول المدة
          وآخرها صحيحة.
        </Alert>
      ) : null}
      <div className="print:hidden">
        <Lines ledger={data} loading={loading} error={error ?? undefined} limit={shown} />
      </div>
      {data && data.lines.length > shown ? (
        <div className="print:hidden">
          <Button variant="secondary" onClick={() => setShown((n) => n + 100)}>
            اعرض المزيد ({data.lines.length - shown} حركة باقية)
          </Button>
        </div>
      ) : null}
      {data && paper ? (
        <PrintSheet paper={paper}>
          <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
            <PrintHead
              me={me}
              branchId={branchId}
              title={`دفتر الأستاذ · ${data.account.code} ${data.account.name}`}
              period={period(data.from, data.to, digits)}
            />
            <Lines ledger={data} loading={false} />
          </div>
        </PrintSheet>
      ) : null}
    </AccountingLayout>
  );
}
