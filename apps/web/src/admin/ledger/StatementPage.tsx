import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { PartyStatement, PartyStatementLine } from '@serva/core';
import {
  Balance,
  BackIcon,
  BookIcon,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  PrintIcon,
  Skeleton,
  StatTile,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { downloadText } from '../accounting/csv';
import { DayField, PageHead, ReportScreen } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { getStatement } from './api';
import { statementCsv, statementWhat } from './csv';

const COPY = {
  customer: {
    title: 'كشف حساب زبون',
    backLabel: 'الزبون',
    access: ['customers.view'],
    // A customer's balance is what they owe: «عليه».
    signed: (minor: number) => minor,
  },
  supplier: {
    title: 'كشف حساب مورد',
    backLabel: 'المشتريات',
    access: ['purchases.manage'],
    // A supplier's balance is what the store owes it: «له».
    signed: (minor: number) => -minor,
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

function DocNumber({ value }: { value: string }) {
  return (
    <bdi dir="ltr" className="num">
      {value}
    </bdi>
  );
}

/** The sheet on A4, light: header, period, opening balance, movements, totals and closing balance. */
function StatementSheet({ s, store, copy }: { s: PartyStatement; store: string; copy: Copy }) {
  const base = s.baseCurrency;
  return (
    <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <div>
          <p className="text-lg font-bold">{store}</p>
          <p>
            {s.party.name}
            {s.party.phone ? (
              <>
                {' · '}
                <bdi dir="ltr" className="num">
                  {s.party.phone}
                </bdi>
              </>
            ) : null}
          </p>
        </div>
        <div className="text-end">
          <p className="text-xl font-bold">{copy.title}</p>
          <p>
            من <bdi className="num">{s.from}</bdi> إلى <bdi className="num">{s.to}</bdi>
          </p>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink">
            <th className="py-1 text-start">التاريخ</th>
            <th className="py-1 text-start">البيان</th>
            <th className="py-1 text-end">عليه</th>
            <th className="py-1 text-end">له</th>
            <th className="py-1 text-end">الرصيد</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line font-semibold">
            <td className="num py-1">{s.from}</td>
            <td className="py-1">رصيد أول المدة</td>
            <td />
            <td />
            <td className="py-1 text-end">
              <Balance minor={copy.signed(s.openingMinor)} currency={base} />
            </td>
          </tr>
          {s.lines.map((l, index) => (
            <tr key={`${l.sourceId}-${index}`} className="border-b border-line">
              <td className="num py-1 whitespace-nowrap">{l.date}</td>
              <td className="py-1">
                {statementWhat(l)}
                {l.number ? (
                  <>
                    {' '}
                    <DocNumber value={l.number} />
                  </>
                ) : null}
              </td>
              <td className="py-1 text-end">
                {l.debitMinor ? <Money minor={l.debitMinor} currency={base} /> : ''}
              </td>
              <td className="py-1 text-end">
                {l.creditMinor ? <Money minor={l.creditMinor} currency={base} /> : ''}
              </td>
              <td className="py-1 text-end">
                <Balance minor={copy.signed(l.balanceMinor)} currency={base} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink font-bold">
            <td className="py-1" colSpan={2}>
              المجموع
            </td>
            <td className="py-1 text-end">
              <Money minor={s.totalDebitMinor} currency={base} />
            </td>
            <td className="py-1 text-end">
              <Money minor={s.totalCreditMinor} currency={base} />
            </td>
            <td className="py-1 text-end">
              <Balance minor={copy.signed(s.closingMinor)} currency={base} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * «كشف حساب» of a customer or a supplier (29; 12 › كشف حساب زبون): for a date range, the opening
 * balance, every movement with its running balance, and the closing balance, read from the ledger.
 * It prints on A4 and saves as CSV.
 */
export function StatementPage({ type }: { type: 'customer' | 'supplier' }) {
  const { id = '' } = useParams();
  const me = useMe();
  const digits = useDigits();
  const copy = COPY[type];
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const { data, error, loading, retry } = useReport(`${type}|${id}|${from}|${to}`, () =>
    getStatement(type, id, { from, to }),
  );
  const { paper, print } = usePrint();
  const base = data?.baseCurrency ?? me.settings.baseCurrency;

  const columns: DataColumn<PartyStatementLine>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      className: 'hidden sm:table-cell',
      cell: (l) => <bdi className="num whitespace-nowrap text-ink-muted">{l.date}</bdi>,
    },
    {
      key: 'what',
      header: 'البيان',
      cell: (l) => (
        <div className="flex flex-col gap-0.5 py-2">
          <span className="font-semibold">{statementWhat(l)}</span>
          {l.number ? (
            <span className="text-xs text-ink-muted">
              <DocNumber value={l.number} />
            </span>
          ) : null}
          <span className="text-xs text-ink-muted sm:hidden">
            <bdi className="num">{l.date}</bdi>
          </span>
        </div>
      ),
    },
    {
      key: 'debit',
      header: 'عليه',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => (l.debitMinor ? <Money minor={l.debitMinor} currency={base} /> : ''),
      total: data ? <Money minor={data.totalDebitMinor} currency={base} /> : null,
    },
    {
      key: 'credit',
      header: 'له',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => (l.creditMinor ? <Money minor={l.creditMinor} currency={base} /> : ''),
      total: data ? <Money minor={data.totalCreditMinor} currency={base} /> : null,
    },
    {
      key: 'move',
      header: 'الحركة',
      numeric: true,
      className: 'sm:hidden',
      cell: (l) => (
        <div className="flex flex-col items-end">
          <span className="text-xs text-ink-muted">{l.debitMinor ? 'عليه' : 'له'}</span>
          <Money minor={l.debitMinor || l.creditMinor} currency={base} />
        </div>
      ),
    },
    {
      key: 'balance',
      header: 'الرصيد',
      numeric: true,
      cell: (l) => <Balance minor={copy.signed(l.balanceMinor)} currency={base} />,
      total: data ? <Balance minor={copy.signed(data.closingMinor)} currency={base} /> : null,
    },
  ];

  const tile = (value: (s: PartyStatement) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  const backTo = type === 'customer' ? `/customers/${id}` : '/purchases';

  return (
    <ReportScreen me={me} access={copy.access} title={copy.title}>
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 self-start rounded-small text-sm font-semibold text-ink-muted transition-colors duration-120 ease-standard hover:text-ink print:hidden"
      >
        <BackIcon size={16} /> {type === 'customer' ? (data?.party.name ?? copy.backLabel) : copy.backLabel}
      </Link>
      <PageHead
        icon={<BookIcon />}
        title={copy.title}
        subtitle={data ? data.party.name : undefined}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!data}
              onClick={() =>
                data &&
                downloadText(
                  `${copy.title}-${data.party.name}-${data.from}-${data.to}.csv`,
                  statementCsv(data),
                )
              }
            >
              صدّر CSV
            </Button>
            <Button variant="secondary" icon={<PrintIcon />} disabled={!data} onClick={() => print('A4')}>
              اطبع
            </Button>
          </>
        }
      />
      <Card className="grid gap-4 sm:flex sm:flex-wrap sm:items-end print:hidden">
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
      </Card>
      <div className="grid gap-4 sm:grid-cols-3 print:hidden">
        <StatTile
          label="رصيد أول المدة"
          value={tile((s) => (
            <Balance minor={copy.signed(s.openingMinor)} currency={base} />
          ))}
        />
        <StatTile
          label="حركة الفترة"
          value={tile((s) => (
            <span className="text-base">
              عليه <Money minor={s.totalDebitMinor} currency={base} /> · له{' '}
              <Money minor={s.totalCreditMinor} currency={base} />
            </span>
          ))}
        />
        <StatTile
          label="رصيد آخر المدة"
          value={tile((s) => (
            <Balance minor={copy.signed(s.closingMinor)} currency={base} />
          ))}
        />
      </div>
      <div className="flex flex-col gap-2 print:hidden">
        <DataTable
          caption={copy.title}
          columns={columns}
          rows={data?.lines ?? []}
          rowKey={(l) => `${l.sourceId}:${l.balanceMinor}:${l.debitMinor}:${l.creditMinor}`}
          loading={loading}
          error={error ?? undefined}
          onRetry={retry}
          empty={
            <EmptyState
              icon={BookIcon}
              title="لا حركة في هذه الفترة."
              description={
                data && data.openingMinor !== 0
                  ? 'رصيد أول المدة يحمل ما قبلها.'
                  : 'اختر فترة أخرى لترى الحركات.'
              }
            />
          }
        />
        {data ? (
          <p className="text-sm text-ink-subtle">
            من {dayText(data.from, digits)} إلى {dayText(data.to, digits)}.
          </p>
        ) : null}
      </div>
      {data && paper ? (
        <PrintSheet paper={paper}>
          <StatementSheet s={data} store={me.tenant.name} copy={copy} />
        </PrintSheet>
      ) : null}
    </ReportScreen>
  );
}
