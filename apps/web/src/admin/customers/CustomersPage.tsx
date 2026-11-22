import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  CUSTOMER_KIND_LABELS,
  CUSTOMER_KINDS,
  type CurrencyCode,
  type CustomerKind,
  type CustomerGroup,
  type CustomerListItem,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  BookIcon,
  Button,
  CalendarIcon,
  CashIcon,
  CustomersIcon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  PhoneIcon,
  SearchField,
  SearchIcon,
  Select,
  SendIcon,
  Tooltip,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay } from '../../lib/dates';
import { storeSells } from '../../lib/sectors';
import { useIsPhone } from '../../lib/useIsPhone';
import { countWord } from '../../lib/plural';
import { downloadText } from '../accounting/csv';
import { Pager, useCursorPages } from '../pager';
import { Amt, DownloadGlyph, PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { exportCustomers, listCustomerPage, listGroups, type CustomerPageQuery } from './api';
import { customersCsv } from './csv';
import { CustomerForm, KIND_SECTORS } from './CustomerForm';
import { birthdayLink, birthdayTiming, debtReminderLink } from './debtReminder';
import { Ago, BalanceCell, CheckChip, CountLine, Empty, SortHead, Who } from './parts';
import { BulkReminder } from './BulkReminder';
import { GroupsDialog } from './GroupsDialog';

const VouchersPanel = lazy(() => import('./VouchersPanel').then((m) => ({ default: m.VouchersPanel })));

const PAGE = 50;
/** The longest search the server takes */
const SEARCH_MAX = 60;

/** The row's «⋯»: the customer's page, a call, a WhatsApp chat, and the debt reminder with the amount. */
function RowMenu({ customer, store, today }: { customer: CustomerListItem; store: string; today: string }) {
  const me = useMe();
  const label = `خيارات ${customer.name}`;
  const phone = customer.phone;
  const reminder = customer.noMessages
    ? null
    : debtReminderLink(phone, {
        name: customer.name,
        balanceMinor: customer.balanceMinor,
        currency: me.settings.baseCurrency,
        store,
      });
  // The birthday greeting is offered in the month of the birthday
  const greeting =
    customer.noMessages || !customer.birthDate || customer.birthDate.slice(5, 7) !== today.slice(5, 7)
      ? null
      : birthdayLink(phone, { name: customer.name, store });
  return (
    <Menu
      label={label}
      align="end"
      trigger={
        <Tooltip content="خيارات">
          <IconButton label={label} icon={<MoreIcon />} size="md" />
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
          {reminder ? (
            <MenuItem
              icon={<CashIcon />}
              render={({ children, ...props }) => (
                <a href={reminder} target="_blank" rel="noreferrer" {...props}>
                  {children}
                </a>
              )}
            >
              ذكّره بالدين على واتساب
            </MenuItem>
          ) : null}
          {greeting ? (
            <MenuItem
              icon={<SendIcon />}
              render={({ children, ...props }) => (
                <a href={greeting} target="_blank" rel="noreferrer" {...props}>
                  {children}
                </a>
              )}
            >
              هنّئه بعيد ميلاده على واتساب
            </MenuItem>
          ) : null}
        </>
      ) : null}
    </Menu>
  );
}

/** In the birthday view: the greeting as a visible button (the same WhatsApp link as the row's «⋯») */
function BirthdayGreet({
  customer,
  store,
  today,
}: {
  customer: CustomerListItem;
  store: string;
  today: string;
}) {
  const link =
    customer.noMessages || !birthdayTiming(customer.birthDate, today)
      ? null
      : birthdayLink(customer.phone, { name: customer.name, store });
  if (!link) return null;
  return (
    <a href={link} target="_blank" rel="noreferrer" className="sx-fbtn">
      <SendIcon size={16} /> هنّئه على واتساب
    </a>
  );
}

/** A customer as a card on a phone: name and balance, then what else is known */
function CustomerCard({
  customer,
  base,
  clothing,
  store,
  today,
  birthdays,
}: {
  customer: CustomerListItem;
  base: CurrencyCode;
  clothing: boolean;
  store: string;
  today: string;
  birthdays: boolean;
}) {
  const digits = useDigits();
  return (
    <li className="sx-scard">
      <Link to={`/customers/${customer.id}`} className="cx-who">
        <Who name={customer.name}>
          <span className="nm">{customer.name}</span>
          <span className="cx-badges">
            {customer.priceTier === 'wholesale' ? <StatusPill kind="ok">جملة</StatusPill> : null}
            {customer.archived ? <StatusPill kind="open">مؤرشف</StatusPill> : null}
            {birthdays && birthdayTiming(customer.birthDate, today) === 'today' ? (
              <StatusPill kind="warn">اليوم</StatusPill>
            ) : null}
            {customer.approvalStatus === 'pending' ? (
              <StatusPill kind="warn">بانتظار الموافقة</StatusPill>
            ) : null}
          </span>
        </Who>
      </Link>
      <span className="flex items-center gap-1 justify-self-end text-end">
        <BalanceCell customer={customer} currency={base} />
        <RowMenu customer={customer} store={store} today={today} />
      </span>
      <span className="x">
        {birthdays ? <BirthdayGreet customer={customer} store={store} today={today} /> : null}
        <span>
          {customer.lastPurchaseDate ? (
            <>
              آخر شراء{' '}
              <Ago
                day={customer.lastPurchaseDate}
                today={today}
                long={dayText(customer.lastPurchaseDate, digits)}
              />
            </>
          ) : (
            'لم يشترِ بعد'
          )}
          {clothing && customer.favouriteSize ? ` · المقاس ${customer.favouriteSize}` : ''}
        </span>
      </span>
    </li>
  );
}

/**
 * «الزبائن» (12 › الزبائن): every customer with what they owe, read from the books, a page at a time.
 * The search, «من عليه دين» and «لم يزر منذ 90 يوماً» are answered by the server (they are in the
 * address), so the list and the numbers above it stay right however many customers there are.
 */
export function CustomersPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canManage = me.user.permissions.includes('customers.manage');
  const view = params.get('view') === 'vouchers' ? 'vouchers' : 'customers';
  const search = params.get('q') ?? '';
  const owing = params.get('owing') === '1';
  const away = params.get('away') === '1';
  const waiting = params.get('waiting') === '1';
  const kind = (CUSTOMER_KINDS as readonly string[]).includes(params.get('kind') ?? '')
    ? (params.get('kind') as CustomerKind)
    : '';
  const sortKey = (['name', 'last', 'spent', 'balance'] as const).find((k) => k === params.get('sort'));
  const sortDir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const groupId = params.get('group') ?? '';
  const birthdays = params.get('birthdays') === '1';
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [dialog, setDialog] = useState<'groups' | 'remind' | null>(null);
  useEffect(() => {
    listGroups()
      .then((g) => setGroups(g.filter((x) => !x.archived)))
      .catch(() => setGroups([]));
  }, [dialog]);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Built from the address as it is when it runs, so a chip pressed while the search timer waits is kept
  const setFilter = (name: string, value: string | null) => {
    setParams(
      (was) => {
        const next = new URLSearchParams(was);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  };

  // The server is asked once the owner stops typing
  const [typed, setTyped] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== search) setFilter('q', typed.trim() || null);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed text starts a search
  }, [typed]);

  const today = isoDay(Date.now(), me.tenant.timezone);
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const query = useMemo<Omit<CustomerPageQuery, 'cursor'>>(
    () => ({
      q: search.slice(0, SEARCH_MAX),
      owing,
      kind,
      ...(away ? { lastBefore: cutoff } : {}),
      ...(waiting ? { approval: 'pending' as const } : {}),
      ...(sortKey ? { sort: sortKey, dir: sortDir } : {}),
      ...(groupId ? { groupId } : {}),
      ...(birthdays ? { birthMonth: Number(today.slice(5, 7)) } : {}),
      limit: PAGE,
    }),
    [search, owing, kind, away, waiting, cutoff, sortKey, sortDir, groupId, birthdays, today],
  );
  const key = JSON.stringify(query);
  const { data, error, loading, retry, pager, topRef } = useCursorPages(
    key,
    (cursor) => listCustomerPage({ ...query, cursor }),
    { pageSize: PAGE },
  );

  // The figures above the list stay on screen while the next answer loads
  const [strip, setStrip] = useState(data);
  useEffect(() => {
    if (data) setStrip(data);
  }, [data]);

  const base = data?.baseCurrency ?? strip?.baseCurrency ?? me.settings.baseCurrency;
  const clothing = storeSells(me.tenant.sectors, ['clothing']);
  const items = data?.items ?? [];
  const anyLimit = items.some((c) => c.creditLimitMinor !== null);
  const pendingCount = strip?.pendingCount ?? 0;
  const filtered = search !== '' || owing || away || waiting || kind !== '' || groupId !== '' || birthdays;

  /** Pressing a title sorts by it; pressing it again flips the order (names A to Z first, money the most first) */
  const sortBy = (key: 'name' | 'last' | 'spent' | 'balance') => {
    const next = new URLSearchParams(params);
    const first = key === 'name' ? 'asc' : 'desc';
    const was = sortKey ?? 'balance';
    const wasDir = sortKey ? sortDir : 'desc';
    next.set('sort', key);
    next.set('dir', was === key ? (wasDir === 'asc' ? 'desc' : 'asc') : first);
    setParams(next, { replace: true });
  };
  const head = (key: 'name' | 'last' | 'spent' | 'balance', label: string) => (
    <SortHead
      label={label}
      active={(sortKey ?? 'balance') === key}
      dir={sortKey ? sortDir : 'desc'}
      onSort={() => sortBy(key)}
    />
  );

  const columns: SxColumn<CustomerListItem>[] = [
    {
      key: 'name',
      header: head('name', 'الزبون'),
      lead: true,
      cell: (c) => (
        <Who name={c.name}>
          <span className="cx-badges">
            <Link to={`/customers/${c.id}`} className="nm">
              {c.name}
            </Link>
            {c.priceTier === 'wholesale' ? <StatusPill kind="ok">جملة</StatusPill> : null}
            {c.kind ? <StatusPill kind="ok">{CUSTOMER_KIND_LABELS[c.kind]}</StatusPill> : null}
            {c.groupName ? <StatusPill kind="ok">{c.groupName}</StatusPill> : null}
            {c.archived ? <StatusPill kind="open">مؤرشف</StatusPill> : null}
            {c.approvalStatus === 'pending' ? <StatusPill kind="warn">بانتظار الموافقة</StatusPill> : null}
            {birthdays && birthdayTiming(c.birthDate, today) === 'today' ? (
              <StatusPill kind="warn">اليوم</StatusPill>
            ) : null}
          </span>
          {birthdays ? <BirthdayGreet customer={c} store={me.tenant.name} today={today} /> : null}
          {c.phone ? (
            <span className="sx-subline">
              <bdi dir="ltr" className="sx-n">
                {c.phone}
              </bdi>
            </span>
          ) : null}
          {(clothing && c.favouriteSize) || c.lastPurchaseDate ? (
            // What the narrow screens hide, said under the name
            <span className="sx-subline cx-lt-lg">
              {clothing && c.favouriteSize ? (
                <span className="whitespace-nowrap">المقاس المفضّل {c.favouriteSize} </span>
              ) : null}
              {c.lastPurchaseDate ? (
                <span className="whitespace-nowrap">آخر شراء {dayText(c.lastPurchaseDate, digits)}</span>
              ) : null}
            </span>
          ) : null}
        </Who>
      ),
    },
    {
      key: 'last',
      header: head('last', 'آخر شراء'),
      hideBelowLg: true,
      cell: (c) =>
        c.lastPurchaseDate ? (
          <span className="sx-n sx-mute">
            <Ago day={c.lastPurchaseDate} today={today} long={dayText(c.lastPurchaseDate, digits)} />
          </span>
        ) : (
          <span className="sx-z">—</span>
        ),
    },
    {
      key: 'spent',
      header: head('spent', 'مجموع المشتريات'),
      numeric: true,
      hideBelowLg: true,
      cell: (c) =>
        c.spentMinor ? (
          <Amt minor={c.spentMinor} currency={base} className="sx-mute" />
        ) : (
          <span className="sx-z">—</span>
        ),
    },
    ...(clothing && items.some((c) => c.favouriteSize)
      ? [
          {
            key: 'size',
            header: 'المقاس المفضّل',
            hideBelowLg: true,
            cell: (c: CustomerListItem) =>
              c.favouriteSize ? (
                <StatusPill kind="ok">{c.favouriteSize}</StatusPill>
              ) : (
                <span className="sx-z">—</span>
              ),
          } satisfies SxColumn<CustomerListItem>,
        ]
      : []),
    ...(anyLimit
      ? [
          {
            key: 'limit',
            header: 'حد الدين',
            numeric: true,
            hideBelowLg: true,
            cell: (c: CustomerListItem) =>
              c.creditLimitMinor === null ? (
                <span className="sx-z">—</span>
              ) : (
                <Amt minor={c.creditLimitMinor} currency={base} className="sx-mute" />
              ),
          } satisfies SxColumn<CustomerListItem>,
        ]
      : []),
    {
      key: 'balance',
      header: head('balance', 'الرصيد'),
      numeric: true,
      strong: true,
      cell: (c) => <BalanceCell customer={c} currency={base} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">خيارات</span>,
      cell: (c) => <RowMenu customer={c} store={me.tenant.name} today={today} />,
    },
  ];

  const empty = owing ? (
    <Empty icon={<CashIcon size={24} />} title="لا أحد عليه دين.">
      <p>كل زبائنك سدّدوا ما عليهم.</p>
    </Empty>
  ) : away ? (
    <Empty icon={<CalendarIcon size={24} />} title="لا زبون غاب أكثر من 90 يوماً.">
      <p>كل من اشترى منك اشترى خلال آخر 90 يوماً.</p>
    </Empty>
  ) : birthdays && search === '' ? (
    <Empty icon={<CalendarIcon size={24} />} title="لا عيد ميلاد لأحد من زبائنك هذا الشهر.">
      <p>أضف تاريخ الميلاد في صفحة الزبون ليظهر هنا.</p>
    </Empty>
  ) : waiting && search === '' ? (
    <Empty icon={<CustomersIcon size={24} />} title="لا زبون بانتظار الموافقة.">
      <p>كل ما أضافه المندوبون صار موافقاً عليه.</p>
    </Empty>
  ) : search !== '' || kind !== '' || groupId !== '' ? (
    <Empty icon={<SearchIcon size={24} />} title="لا زبون بهذا الاسم أو الجوال.">
      <p>جرّب جزءاً من الاسم، أو آخر أرقام الجوال.</p>
    </Empty>
  ) : (
    <Empty icon={<CustomersIcon size={24} />} title="لا زبائن بعد.">
      <p>أضف أول زبون، أو يضيفه الكاشير من شاشة البيع.</p>
      {canManage && !adding ? (
        <Button icon={<AddIcon />} onClick={() => setAdding(true)}>
          أضف أول زبون
        </Button>
      ) : null}
    </Empty>
  );

  /** Every customer of the current filters, in one request, into a file for Excel */
  async function exportAll() {
    setExporting(true);
    setExportError(null);
    try {
      const all = await exportCustomers(query);
      downloadText(`customers-${today}.csv`, customersCsv(all.items, base));
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const kpi = (value: ReactNode) => (strip ? value : <span className="sx-z">—</span>);
  const owingN = strip?.owingCount ?? 0;

  return (
    <AppShell>
      <title>الزبائن · SERVA</title>
      <SalesPage>
        <PageTop
          title="الزبائن"
          subtitle="ما على كل زبون وحدّ دينه، كما في دفاتر المتجر."
          actions={
            canManage && !adding && view === 'customers' ? (
              <Button icon={<AddIcon />} onClick={() => setAdding(true)}>
                زبون جديد
              </Button>
            ) : null
          }
        />
        <div className="cx-tabs print:hidden" role="tablist" aria-label="أقسام الزبائن">
          <button
            type="button"
            role="tab"
            className="cx-tab"
            aria-selected={view === 'customers'}
            onClick={() => setFilter('view', null)}
          >
            الزبائن
          </button>
          <button
            type="button"
            role="tab"
            className="cx-tab"
            aria-selected={view === 'vouchers'}
            onClick={() => setFilter('view', 'vouchers')}
          >
            القسائم
          </button>
        </div>
        {view === 'vouchers' ? (
          <Suspense fallback={<p className="sx-wait">نحمّل القسائم…</p>}>
            <VouchersPanel />
          </Suspense>
        ) : (
          <>
            {adding ? (
              <CustomerForm
                onSaved={(c) => navigate(`/customers/${c.id}`)}
                onCancel={() => setAdding(false)}
              />
            ) : null}
            {away ? <p className="sx-wait">الأرقام أدناه لمن لم يزر منذ 90 يوماً فقط.</p> : null}
            <div className="sx-card sx-strip cx3">
              <div>
                <span className="sx-eyebrow">الديون على الزبائن</span>
                <span className="v">{kpi(<Amt minor={strip?.totalOwedMinor ?? 0} currency={base} />)}</span>
                {(strip?.archivedOwedMinor ?? 0) > 0 ? (
                  <span className="sx-subline">
                    منها <Amt minor={strip?.archivedOwedMinor ?? 0} currency={base} /> على زبائن مؤرشفين
                  </span>
                ) : null}
              </div>
              <div>
                <span className="sx-eyebrow">عليهم دين</span>
                <span className="v">{kpi(<span className="sx-n">{owingN}</span>)}</span>
              </div>
              <div>
                <span className="sx-eyebrow">كل الزبائن</span>
                <span className="v">{kpi(<span className="sx-n">{strip?.allCount ?? 0}</span>)}</span>
              </div>
            </div>
            <div className="sx-card sx-filterbar print:hidden">
              <div className="sx-search">
                <SearchField
                  label="ابحث بالاسم أو الجوال"
                  value={typed}
                  onValueChange={(v) => setTyped(v.slice(0, SEARCH_MAX))}
                />
              </div>
              {storeSells(me.tenant.sectors, KIND_SECTORS) ? (
                <Select
                  label="نوع الزبون"
                  hideLabel
                  value={kind}
                  onChange={(e) => setFilter('kind', e.target.value || null)}
                >
                  <option value="">كل الأنواع</option>
                  {CUSTOMER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CUSTOMER_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              ) : null}
              {groups.length > 0 ? (
                <Select
                  label="المجموعة"
                  hideLabel
                  value={groupId}
                  onChange={(e) => setFilter('group', e.target.value || null)}
                >
                  <option value="">كل المجموعات</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <div className="sx-chips scroll cx-chips">
                <CheckChip
                  label="من عليه دين فقط"
                  checked={owing}
                  onChange={(v) => setFilter('owing', v ? '1' : null)}
                />
                <CheckChip
                  label="لم يزر منذ 90 يوماً"
                  checked={away}
                  onChange={(v) => setFilter('away', v ? '1' : null)}
                />
                <CheckChip
                  label="أعياد ميلاد هذا الشهر"
                  checked={birthdays}
                  onChange={(v) => setFilter('birthdays', v ? '1' : null)}
                />
                {pendingCount > 0 ? (
                  <CheckChip
                    label={`بانتظار الموافقة (${pendingCount})`}
                    checked={waiting}
                    onChange={(v) => setFilter('waiting', v ? '1' : null)}
                  />
                ) : null}
              </div>
              <Menu
                label="أدوات"
                align="end"
                trigger={
                  <Button variant="secondary" icon={<MoreIcon />} loading={exporting}>
                    أدوات
                  </Button>
                }
              >
                {canManage ? <MenuItem onSelect={() => setDialog('groups')}>المجموعات</MenuItem> : null}
                {(strip?.owingCount ?? 0) > 0 ? (
                  <MenuItem icon={<CashIcon />} onSelect={() => setDialog('remind')}>
                    تذكير جماعي للمدينين
                  </MenuItem>
                ) : null}
                <MenuItem icon={<DownloadGlyph />} onSelect={() => void exportAll()}>
                  صدّر إلى إكسل
                </MenuItem>
              </Menu>
            </div>
            {exportError ? <Alert tone="error">{exportError}</Alert> : null}
            <div ref={topRef} />
            {data ? (
              <CountLine>
                <bdi className="sx-n font-semibold">{data.totalCount ?? items.length}</bdi>{' '}
                {countWord(data.totalCount ?? items.length, { one: 'زبون', two: 'زبونان', few: 'زبائن' })}
                {filtered ? ' بحسب البحث' : ''}
              </CountLine>
            ) : null}
            {phone && data && items.length > 0 ? (
              <ul className="sx-cards" aria-label="الزبائن وأرصدتهم">
                {items.map((c) => (
                  <CustomerCard
                    key={c.id}
                    customer={c}
                    base={base}
                    clothing={clothing}
                    store={me.tenant.name}
                    today={today}
                    birthdays={birthdays}
                  />
                ))}
              </ul>
            ) : (
              <SxTable
                caption="الزبائن وأرصدتهم"
                columns={columns}
                rows={items}
                rowKey={(c) => c.id}
                loading={loading}
                {...(error ? { error, onRetry: retry } : {})}
                empty={empty}
                onRowClick={(c) => navigate(`/customers/${c.id}`)}
              />
            )}
            <Pager noun="الزبائن" pager={pager} />
            {dialog === 'groups' ? (
              <GroupsDialog canManage={canManage} onClose={() => setDialog(null)} />
            ) : null}
            {dialog === 'remind' ? <BulkReminder onClose={() => setDialog(null)} /> : null}
          </>
        )}
      </SalesPage>
    </AppShell>
  );
}
