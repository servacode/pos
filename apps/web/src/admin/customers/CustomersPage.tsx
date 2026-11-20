import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CUSTOMER_KIND_LABELS,
  CUSTOMER_KINDS,
  type CurrencyCode,
  type CustomerKind,
  type CustomerListItem,
  type CustomerListResponse,
} from '@serva/core';
import {
  AddIcon,
  Avatar,
  Badge,
  BookIcon,
  Button,
  CalendarIcon,
  CashIcon,
  CustomersIcon,
  DataTable,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  Money,
  PageHeader,
  PhoneIcon,
  SearchField,
  SearchIcon,
  Select,
  SendIcon,
  Skeleton,
  KpiStrip,
  StatTile,
  ToggleChip,
  Tooltip,
  UserIcon,
  WarningIcon,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { storeSells } from '../../lib/sectors';
import { dayText, isoDay } from '../../lib/dates';
import { countWord } from '../../lib/plural';

import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { recallAnswer, rememberAnswer, SLOW_AFTER_MS } from '../reports/useReport';
import { listCustomers } from './api';
import { CustomerForm, KIND_SECTORS } from './CustomerForm';

/** Owes more than the limit set for them: the till still sells, with a warning. */
const overLimit = (c: CustomerListItem) => c.creditLimitMinor !== null && c.balanceMinor > c.creditLimitMinor;

/**
 * What a customer owes, coloured by its state and never by colour alone: owed in the warning ink,
 * past the limit in the danger ink with the words «فوق الحد», what the store owes them in the
 * success ink with «له», nothing owed in the subtle ink.
 */
function BalanceCell({ customer, currency }: { customer: CustomerListItem; currency: CurrencyCode }) {
  const { balanceMinor } = customer;
  if (balanceMinor < 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-success-ink">
        <span className="text-xs">له</span>
        <Money minor={balanceMinor} currency={currency} signDisplay="never" />
      </span>
    );
  }
  if (overLimit(customer)) {
    return (
      <span className="inline-flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
        <Badge tone="danger">فوق الحد</Badge>
        <Money minor={balanceMinor} currency={currency} className="font-bold text-danger-ink" />
      </span>
    );
  }
  return (
    <Money
      minor={balanceMinor}
      currency={currency}
      className={balanceMinor > 0 ? 'font-semibold text-warning-ink' : 'text-ink-subtle'}
    />
  );
}

/** The row's «⋯»: the statement, and a call or a WhatsApp chat when the customer has a phone. */
function RowMenu({ customer }: { customer: CustomerListItem }) {
  const label = `خيارات ${customer.name}`;
  const phone = customer.phone;
  return (
    <Menu
      label={label}
      align="end"
      trigger={
        <Tooltip content="خيارات">
          <IconButton label={label} icon={<MoreIcon />} size="sm" />
        </Tooltip>
      }
    >
      <MenuItem icon={<BookIcon />} render={(props) => <Link to={`/customers/${customer.id}`} {...props} />}>
        كشف الحساب
      </MenuItem>
      {phone ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<PhoneIcon />} href={`tel:${phone}`}>
            اتصل
          </MenuItem>
          {customer.noMessages ? null : (
            <MenuItem
              icon={<SendIcon />}
              render={({ children, ...props }) => (
                <a
                  href={`https://wa.me/${phone.replace('+', '')}`}
                  target="_blank"
                  rel="noreferrer"
                  {...props}
                >
                  {children}
                </a>
              )}
            >
              راسله على واتساب
            </MenuItem>
          )}
        </>
      ) : null}
    </Menu>
  );
}

/**
 * «الزبائن» (12 › الزبائن): every customer with what they owe, read from the books. The owner adds
 * customers and sets their credit limit here; tills find them to sell on credit and take payments.
 */
export function CustomersPage() {
  const me = useMe();
  const digits = useDigits();
  const navigate = useNavigate();
  const canManage = me.user.permissions.includes('customers.manage');
  // The last list is on screen at once while the new one loads (kept in memory, wiped at sign-out)
  const [list, setList] = useState<CustomerListResponse | null>(() =>
    recallAnswer<CustomerListResponse>('customers||0|'),
  );
  const [error, setError] = useState<string | null>(null);
  const shown = useRef(list !== null);
  shown.current = list !== null;
  const [search, setSearch] = useState('');
  const [owing, setOwing] = useState(false);
  const [away, setAway] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [kind, setKind] = useState<CustomerKind | ''>('');
  const [adding, setAdding] = useState(false);
  // Every customer, whatever the search says, for the duplicate warning of the new-customer form
  const [everyone, setEveryone] = useState<CustomerListItem[]>([]);
  useEffect(() => {
    if (!adding) return;
    listCustomers()
      .then((all) => setEveryone(all.items))
      .catch(() => setEveryone([]));
  }, [adding]);

  const load = useCallback(() => {
    setError(null);
    // Ten seconds without an answer and nothing older to show: say so, with a retry
    const slow = setTimeout(() => {
      if (!shown.current) setError((was) => was ?? 'تأخّر الرد أكثر من المعتاد. أعد المحاولة.');
    }, SLOW_AFTER_MS);
    listCustomers(search.trim(), owing, kind || undefined)
      .then((answer) => {
        clearTimeout(slow);
        rememberAnswer(`customers|${search.trim()}|${owing ? 1 : 0}|${kind}`, answer);
        setList(answer);
        setError(null);
      })
      .catch((e: unknown) => {
        clearTimeout(slow);
        setError(errorMessage(e));
      });
  }, [search, owing, kind]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const base = list?.baseCurrency ?? 'SYP';
  const today = isoDay(Date.now(), me.tenant.timezone);
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  // «لم يزر منذ 90 يوماً»: bought before, but not in the last 90 days
  const items = (list?.items ?? []).filter(
    (c) =>
      (!away || (!!c.lastPurchaseDate && c.lastPurchaseDate < cutoff)) &&
      (!waiting || c.approvalStatus === 'pending'),
  );
  const waitingCount = (list?.items ?? []).filter((c) => c.approvalStatus === 'pending').length;
  const owingCount = items.filter((c) => c.balanceMinor > 0).length;
  // The debt tile follows the same filter as the other tiles (all of them say so below when it is on)
  const owedMinor = away
    ? items.reduce((sum, c) => sum + Math.max(0, c.balanceMinor), 0)
    : (list?.totalOwedMinor ?? 0);
  const overCount = items.filter(overLimit).length;
  // A number of the tiles: a placeholder while the list loads, a dash when it could not.
  const kpi = (value: ReactNode) => (list ? value : error ? '—' : <Skeleton className="h-9 w-24" />);

  const clothing = storeSells(me.tenant.sectors, ['clothing']);
  const columns: DataColumn<CustomerListItem>[] = [
    {
      key: 'name',
      header: 'الزبون',
      // On a phone the name takes what the balance leaves (long lines cut with «…»), so the balance
      // is never pushed out of the screen
      className: 'w-full max-w-0 md:max-w-none',
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3 py-2">
          <Avatar name={c.name} size="sm" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                to={`/customers/${c.id}`}
                className="rounded-sm font-semibold text-ink underline decoration-transparent underline-offset-4 transition-[color,text-decoration-color] duration-120 ease-standard hover:text-brand-ink hover:decoration-current"
              >
                {c.name}
              </Link>
              {c.priceTier === 'wholesale' ? <Badge tone="brand">جملة</Badge> : null}
              {c.kind ? <Badge tone="info">{CUSTOMER_KIND_LABELS[c.kind]}</Badge> : null}
              {c.archived ? <Badge>مؤرشف</Badge> : null}
              {c.approvalStatus === 'pending' ? <Badge tone="warning">بانتظار الموافقة</Badge> : null}
            </span>
            {c.phone && !((clothing && c.favouriteSize) || c.lastPurchaseDate) ? (
              <span className="text-xs text-ink-muted md:hidden">
                <bdi dir="ltr" className="num">
                  {c.phone}
                </bdi>
              </span>
            ) : null}
            {(clothing && c.favouriteSize) || c.lastPurchaseDate ? (
              // The columns that are hidden on a phone, said under the name: two short facts that wrap
              // to a second line rather than being cut (the phone is in the row's «⋯»: call or WhatsApp)
              <span className="flex flex-wrap gap-x-3 text-xs text-ink-muted md:hidden">
                {clothing && c.favouriteSize ? (
                  <span className="whitespace-nowrap">المقاس المفضّل {c.favouriteSize}</span>
                ) : null}
                {c.lastPurchaseDate ? (
                  <span className="whitespace-nowrap">آخر شراء {dayText(c.lastPurchaseDate, digits)}</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'الجوال',
      className: 'hidden md:table-cell',
      cell: (c) =>
        c.phone ? (
          <bdi dir="ltr" className="num text-ink-muted">
            {c.phone}
          </bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'last',
      header: 'آخر شراء',
      className: 'hidden lg:table-cell',
      cell: (c) =>
        c.lastPurchaseDate ? (
          <bdi className="num whitespace-nowrap text-ink-muted">{dayText(c.lastPurchaseDate, digits)}</bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'spent',
      header: 'مجموع المشتريات',
      numeric: true,
      className: 'hidden lg:table-cell',
      cell: (c) =>
        c.spentMinor ? (
          <Money minor={c.spentMinor} currency={base} className="text-ink-muted" />
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    ...(clothing
      ? [
          {
            key: 'size',
            header: 'المقاس المفضّل',
            className: 'hidden xl:table-cell',
            cell: (c: CustomerListItem) =>
              c.favouriteSize ? <Badge>{c.favouriteSize}</Badge> : <span className="text-ink-subtle">—</span>,
          } satisfies DataColumn<CustomerListItem>,
        ]
      : []),
    {
      key: 'limit',
      header: 'حد الدين',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (c) =>
        c.creditLimitMinor === null ? (
          <span className="text-ink-subtle">—</span>
        ) : (
          <Money minor={c.creditLimitMinor} currency={base} className="text-ink-muted" />
        ),
    },
    {
      key: 'balance',
      header: 'الرصيد',
      numeric: true,
      cell: (c) => <BalanceCell customer={c} currency={base} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">خيارات</span>,
      className: 'relative w-px',
      cell: (c) => <RowMenu customer={c} />,
    },
  ];

  const typed = search.trim() !== '';
  const empty = owing ? (
    <EmptyState icon={CashIcon} title="لا أحد عليه دين." description="كل زبائنك سدّدوا ما عليهم." />
  ) : away ? (
    <EmptyState
      icon={CalendarIcon}
      title="لا زبون غاب أكثر من 90 يوماً."
      description="كل من اشترى منك اشترى خلال آخر 90 يوماً."
    />
  ) : typed ? (
    <EmptyState
      icon={SearchIcon}
      title="لا زبون بهذا الاسم أو الجوال."
      description="جرّب جزءاً من الاسم، أو آخر أرقام الجوال."
    />
  ) : (
    <EmptyState
      icon={CustomersIcon}
      title="لا زبائن بعد."
      description="أضف أول زبون، أو يضيفه الكاشير من شاشة البيع."
      action={
        canManage && !adding ? (
          <Button icon={<AddIcon />} onClick={() => setAdding(true)}>
            أضف أول زبون
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <AppShell>
      <title>الزبائن · SERVA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="الزبائن"
          description="ما على كل زبون وحدّ دينه، كما في دفاتر المتجر."
          actions={
            canManage && !adding ? (
              <Button icon={<AddIcon />} onClick={() => setAdding(true)}>
                زبون جديد
              </Button>
            ) : null
          }
        />
        {adding ? (
          <CustomerForm
            existing={everyone}
            onSaved={(c) => navigate(`/customers/${c.id}`)}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {away ? <p className="text-sm text-ink-muted">الأرقام أدناه لمن لم يزر منذ 90 يوماً فقط.</p> : null}
        {/* On a phone the money tile takes the first row and the two counts sit side by side below it */}
        <KpiStrip columns={3} className="max-sm:*:first:col-span-2 max-sm:*:last:odd:col-span-1!">
          <StatTile
            label="الديون على الزبائن"
            icon={<CashIcon />}
            value={kpi(<Money minor={owedMinor} currency={base} />)}
          />
          <StatTile
            label="عليهم دين"
            icon={<UserIcon />}
            iconTone={owingCount > 0 ? 'warning' : 'neutral'}
            value={kpi(<bdi className="num">{owingCount}</bdi>)}
          />
          <StatTile
            label="فوق حد الدين"
            icon={<WarningIcon />}
            iconTone={overCount > 0 ? 'danger' : 'neutral'}
            value={kpi(<bdi className="num">{overCount}</bdi>)}
          />
        </KpiStrip>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              label="ابحث بالاسم أو الجوال"
              value={search}
              onValueChange={setSearch}
              className="min-w-0 flex-1 basis-64 sm:max-w-md"
            />
            {/* Clinics, hospitals and offices: only for shops that sell to them */}
            {storeSells(me.tenant.sectors, KIND_SECTORS) ? (
              <Select
                label="نوع الزبون"
                hideLabel
                value={kind}
                onChange={(e) => setKind(e.target.value as CustomerKind | '')}
              >
                <option value="">كل الأنواع</option>
                {CUSTOMER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CUSTOMER_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            ) : null}
            <ToggleChip
              label="من عليه دين فقط"
              checked={owing}
              onChange={(e) => setOwing(e.target.checked)}
            />
            <ToggleChip
              label="لم يزر منذ 90 يوماً"
              checked={away}
              onChange={(e) => setAway(e.target.checked)}
            />
            {waitingCount > 0 ? (
              <ToggleChip
                label={`بانتظار الموافقة (${waitingCount})`}
                checked={waiting}
                onChange={(e) => setWaiting(e.target.checked)}
              />
            ) : null}
          </div>
          {/* The count is a line over the list, not a card of its own */}
          {list ? (
            <p className="text-sm text-ink-muted">
              <bdi className="num font-semibold text-ink">{items.length}</bdi>{' '}
              {countWord(items.length, { one: 'زبون', two: 'زبونان', few: 'زبائن' })}
            </p>
          ) : null}
          <DataTable
            caption="الزبائن وأرصدتهم"
            columns={columns}
            rows={items}
            rowKey={(c) => c.id}
            loading={!list && !error}
            {...(error ? { error, onRetry: load } : {})}
            empty={empty}
          />
        </div>
      </div>
    </AppShell>
  );
}
