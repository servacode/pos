import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CurrencyCode, CustomerListItem, CustomerListResponse } from '@serva/core';
import {
  AddIcon,
  Avatar,
  Badge,
  BookIcon,
  Button,
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
  SendIcon,
  Skeleton,
  StatTile,
  ToggleChip,
  Tooltip,
  UserIcon,
  WarningIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { listCustomers } from './api';
import { CustomerForm } from './CustomerForm';

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
      <span className="inline-flex items-center gap-2">
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
  const navigate = useNavigate();
  const canManage = me.user.permissions.includes('customers.manage');
  const [list, setList] = useState<CustomerListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [owing, setOwing] = useState(false);
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
    listCustomers(search.trim(), owing)
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [search, owing]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const base = list?.baseCurrency ?? 'SYP';
  const items = list?.items ?? [];
  const owingCount = items.filter((c) => c.balanceMinor > 0).length;
  const overCount = items.filter(overLimit).length;
  // A number of the tiles: a placeholder while the list loads, a dash when it could not.
  const kpi = (value: ReactNode) => (list ? value : error ? '—' : <Skeleton className="h-9 w-24" />);

  const columns: DataColumn<CustomerListItem>[] = [
    {
      key: 'name',
      header: 'الزبون',
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
              {c.archived ? <Badge>مؤرشف</Badge> : null}
            </span>
            {c.phone ? (
              <span className="text-xs text-ink-muted md:hidden">
                <bdi dir="ltr" className="num">
                  {c.phone}
                </bdi>
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
      <title>الزبائن · SERFA</title>
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="الديون على الزبائن"
            icon={<CashIcon />}
            value={kpi(<Money minor={list?.totalOwedMinor ?? 0} currency={base} />)}
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
          <StatTile
            label="عدد الزبائن"
            icon={<CustomersIcon />}
            iconTone="neutral"
            value={kpi(<bdi className="num">{items.length}</bdi>)}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              label="ابحث بالاسم أو الجوال"
              value={search}
              onValueChange={setSearch}
              className="min-w-0 flex-1 basis-64 sm:max-w-md"
            />
            <ToggleChip
              label="من عليه دين فقط"
              checked={owing}
              onChange={(e) => setOwing(e.target.checked)}
            />
          </div>
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
