import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { getCurrency, type CurrencyCode, type PartyStatement, type PartyStatementLine } from '@serva/core';
import {
  AddIcon,
  BackIcon,
  BookIcon,
  Button,
  Card,
  DataTable,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Money,
  MoreIcon,
  PrintIcon,
  Skeleton,
  StatTile,
  ToggleChip,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { PrintSheet, usePrint } from '../../lib/print';
import { downloadText } from '../accounting/csv';
import { DayField, PageHead, ReportScreen } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { CustomerMoneyDialog } from '../customers/CustomerMoneyDialog';
import { getStatement } from './api';
import { statementCsv, statementWhat } from './csv';
import '../customers/customers.css';

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
    backLabel: 'الموردون',
    access: ['purchases.manage'],
    // A supplier's balance is what the store owes it: «له».
    signed: (minor: number) => -minor,
  },
} as const;

/** Period presets of the statement: the first and last day of each, as ISO days, from today's day */
export function statementPeriods(today: string): { key: string; label: string; from: string; to: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  return [
    { key: 'month', label: 'هذا الشهر', from: iso(year, month, 1), to: today },
    { key: 'last', label: 'الشهر الماضي', from: iso(year, month - 1, 1), to: iso(year, month, 0) },
    { key: 'q', label: 'آخر 3 أشهر', from: iso(year, month - 2, 1), to: today },
    { key: 'year', label: 'هذه السنة', from: `${year}-01-01`, to: today },
  ];
}

type Copy = (typeof COPY)[keyof typeof COPY];

/**
 * The two sides of the account in the words of its owner (round 44): a customer's are «عليه / له»; a
 * supplier's are what the store paid it and what it bought from it, so a shop owner need not flip sides.
 */
const SIDES = {
  customer: { debit: 'عليه', credit: 'له' },
  supplier: { debit: 'دفعنا له', credit: 'اشترينا منه' },
} as const;

/**
 * The balance in words: «عليه» or «له» and the amount (no arrow: the word says the side). The words
 * are the owner's, as the statement has always shown them.
 */
function Balance({
  minor,
  currency,
  className,
  symbol,
}: {
  minor: number;
  currency: CurrencyCode;
  className?: string;
  symbol?: boolean;
}) {
  const side = minor > 0 ? 'عليه' : minor < 0 ? 'له' : null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-ink ${className ?? ''}`}>
      {side ? <span className="font-semibold">{side}</span> : null}
      <Money minor={minor} currency={currency} signDisplay="never" symbol={symbol} />
    </span>
  );
}

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
  const digits = useDigits();
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
            من {dayText(s.from, digits)} إلى {dayText(s.to, digits)}
          </p>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink">
            <th className="py-1 text-start">التاريخ</th>
            <th className="py-1 text-start">البيان</th>
            <th className="py-1 text-end">{SIDES[s.type].debit}</th>
            <th className="py-1 text-end">{SIDES[s.type].credit}</th>
            <th className="py-1 text-end">الرصيد</th>
            {s.usd ? <th className="py-1 text-end">بالدولار</th> : null}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line font-semibold">
            <td className="py-1 whitespace-nowrap">{dayText(s.from, digits)}</td>
            <td className="py-1">رصيد أول المدة</td>
            <td />
            <td />
            <td className="py-1 text-end">
              <Balance minor={copy.signed(s.openingMinor)} currency={base} />
            </td>
            {s.usd ? (
              <td className="py-1 text-end">
                <Balance minor={copy.signed(s.usd.openingMinor)} currency="USD" />
              </td>
            ) : null}
          </tr>
          {s.lines.map((l, index) => (
            <tr key={`${l.sourceId}-${index}`} className="border-b border-line">
              <td className="py-1 whitespace-nowrap">{dayText(l.date, digits)}</td>
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
              {s.usd ? (
                <td className="py-1 text-end">
                  {l.usdBalanceMinor !== undefined ? (
                    <Balance minor={copy.signed(l.usdBalanceMinor)} currency="USD" />
                  ) : null}
                </td>
              ) : null}
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
            {s.usd ? (
              <td className="py-1 text-end">
                <Balance minor={copy.signed(s.usd.closingMinor)} currency="USD" />
              </td>
            ) : null}
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
  const phone = useIsPhone();
  const copy = COPY[type];
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const { data, error, loading, retry } = useReport(`${type}|${id}|${from}|${to}`, () =>
    getStatement(type, id, { from, to }),
  );
  const { paper, print } = usePrint();
  const [money, setMoney] = useState<'payment' | 'opening' | null>(null);
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const canReceive = type === 'customer' && me.user.permissions.includes('receipt.create');
  const canOpen = type === 'customer' && me.user.permissions.includes('accounting.post');

  const unit = getCurrency(base).symbolAr;
  const columns: DataColumn<PartyStatementLine>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      className: 'hidden sm:table-cell',
      cell: (l) => <span className="whitespace-nowrap text-ink-muted">{dayText(l.date, digits)}</span>,
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
          <span className="text-xs text-ink-muted sm:hidden">{dayText(l.date, digits)}</span>
        </div>
      ),
    },
    {
      key: 'debit',
      header: `${SIDES[type].debit} (${unit})`,
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => (l.debitMinor ? <Money minor={l.debitMinor} currency={base} symbol={false} /> : ''),
      total: data ? <Money minor={data.totalDebitMinor} currency={base} symbol={false} /> : null,
    },
    {
      key: 'credit',
      header: `${SIDES[type].credit} (${unit})`,
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => (l.creditMinor ? <Money minor={l.creditMinor} currency={base} symbol={false} /> : ''),
      total: data ? <Money minor={data.totalCreditMinor} currency={base} symbol={false} /> : null,
    },
    {
      key: 'move',
      header: 'الحركة',
      numeric: true,
      className: 'sm:hidden',
      cell: (l) => (
        <div className="flex flex-col items-end">
          <span className="text-xs text-ink-muted">
            {l.debitMinor ? SIDES[type].debit : SIDES[type].credit}
          </span>
          <Money minor={l.debitMinor || l.creditMinor} currency={base} />
        </div>
      ),
    },
    {
      key: 'balance',
      header: `الرصيد (${unit})`,
      numeric: true,
      cell: (l) => <Balance minor={copy.signed(l.balanceMinor)} currency={base} symbol={false} />,
      total: data ? <Balance minor={copy.signed(data.closingMinor)} currency={base} symbol={false} /> : null,
    },
    // A supplier with dollar invoices (round 36, decision 11): the same account in dollars
    ...(data?.usd
      ? [
          {
            key: 'usd',
            header: 'بالدولار ($)',
            numeric: true,
            cell: (l: PartyStatementLine) =>
              l.usdBalanceMinor === undefined ? null : l.usdBalanceMinor === 0 &&
                !l.usdDebitMinor &&
                !l.usdCreditMinor ? (
                <span className="text-ink-subtle">—</span>
              ) : (
                <div className="flex flex-col items-end">
                  {l.usdDebitMinor || l.usdCreditMinor ? (
                    <span className="text-xs text-ink-muted">
                      {l.usdDebitMinor ? SIDES[type].debit : SIDES[type].credit}{' '}
                      <Money minor={l.usdDebitMinor || l.usdCreditMinor || 0} currency="USD" symbol={false} />
                    </span>
                  ) : null}
                  <Balance minor={copy.signed(l.usdBalanceMinor)} currency="USD" symbol={false} />
                </div>
              ),
            total: <Balance minor={copy.signed(data.usd.closingMinor)} currency="USD" symbol={false} />,
          } satisfies DataColumn<PartyStatementLine>,
        ]
      : []),
  ];

  const tile = (value: (s: PartyStatement) => ReactNode) =>
    data ? value(data) : error ? '—' : <Skeleton className="h-9 w-40" />;

  const backTo = type === 'customer' ? `/customers/${id}` : '/suppliers';
  // Two identical lines of one document must not share a key
  const lineKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const keys = new WeakMap<object, string>();
    for (const l of data?.lines ?? []) {
      const base = `${l.sourceId}:${l.balanceMinor}:${l.debitMinor}:${l.creditMinor}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      keys.set(l, n > 1 ? `${base}:${n}` : base);
    }
    return keys;
  }, [data]);

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
            {canReceive ? (
              <Button icon={<AddIcon />} disabled={!data} onClick={() => setMoney('payment')}>
                استلم دفعة
              </Button>
            ) : (
              <Button variant="secondary" icon={<PrintIcon />} disabled={!data} onClick={() => print('A4')}>
                اطبع
              </Button>
            )}
            <Menu
              label="المزيد"
              align="end"
              trigger={<IconButton label="المزيد" icon={<MoreIcon />} size="md" disabled={!data} />}
            >
              {canReceive ? (
                <MenuItem icon={<PrintIcon />} onSelect={() => print('A4')}>
                  اطبع الكشف
                </MenuItem>
              ) : null}
              <MenuItem
                onSelect={() =>
                  data &&
                  downloadText(
                    `${copy.title}-${data.party.name}-${data.from}-${data.to}.csv`,
                    statementCsv(data),
                  )
                }
              >
                صدّر إلى إكسل
              </MenuItem>
              {canOpen ? (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={() => setMoney('opening')}>سجّل دين افتتاحي</MenuItem>
                </>
              ) : null}
            </Menu>
          </>
        }
      />
      <Card className="grid gap-4 sm:flex sm:flex-wrap sm:items-end print:hidden">
        <div role="radiogroup" aria-label="الفترة" className="flex w-full flex-wrap gap-2">
          {statementPeriods(today).map((period) => (
            <ToggleChip
              key={period.key}
              type="radio"
              name="statement-period"
              label={period.label}
              checked={from === period.from && to === period.to}
              onChange={() => {
                setFrom(period.from);
                setTo(period.to);
              }}
            />
          ))}
        </div>
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
              {SIDES[type].debit} <Money minor={s.totalDebitMinor} currency={base} /> · {SIDES[type].credit}{' '}
              <Money minor={s.totalCreditMinor} currency={base} />
            </span>
          ))}
        />
        <StatTile
          label="رصيد آخر المدة"
          value={tile((s) => (
            <Balance minor={copy.signed(s.closingMinor)} currency={base} />
          ))}
          footnote={
            data?.usd ? (
              <>
                منه بالدولار <Balance minor={copy.signed(data.usd.closingMinor)} currency="USD" />
              </>
            ) : undefined
          }
        />
      </div>
      <div className="flex flex-col gap-2 print:hidden">
        {phone && data && data.lines.length > 0 ? (
          <Card className="p-0">
            <ul className="cx-stm" aria-label={copy.title}>
              {data.lines.map((l) => (
                <li key={lineKeys.get(l) ?? `${l.sourceId}:${l.balanceMinor}`}>
                  <span className="what">
                    {statementWhat(l)}
                    {l.number ? (
                      <>
                        {' '}
                        <DocNumber value={l.number} />
                      </>
                    ) : null}
                  </span>
                  <span className="num end font-semibold">
                    <span className="text-xs text-ink-muted">
                      {l.debitMinor ? SIDES[type].debit : SIDES[type].credit}{' '}
                    </span>
                    <Money minor={l.debitMinor || l.creditMinor} currency={base} />
                  </span>
                  <span className="row2">
                    <span>{dayText(l.date, digits)}</span>
                    <Balance minor={copy.signed(l.balanceMinor)} currency={base} className="num" />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <DataTable
            className="cx-stm-tbl"
            caption={copy.title}
            columns={columns}
            rows={data?.lines ?? []}
            rowKey={(l) => lineKeys.get(l) ?? `${l.sourceId}:${l.balanceMinor}`}
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
        )}
        {data ? (
          <p className="text-sm text-ink-subtle">
            من {dayText(data.from, digits)} إلى {dayText(data.to, digits)}.
          </p>
        ) : null}
      </div>
      {data && money ? (
        <CustomerMoneyDialog
          kind={money}
          customer={{ id: data.party.id, name: data.party.name }}
          onCancel={() => setMoney(null)}
          onDone={() => {
            setMoney(null);
            retry();
          }}
        />
      ) : null}
      {data && paper ? (
        <PrintSheet paper={paper}>
          <StatementSheet s={data} store={me.tenant.name} copy={copy} />
        </PrintSheet>
      ) : null}
    </ReportScreen>
  );
}
