import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { CurrencyCode, CustomerDetail, CustomerPurchases, StatementLine } from '@serva/core';
import {
  Alert,
  ArchiveIcon,
  Avatar,
  BackIcon,
  Badge,
  BookIcon,
  Button,
  Card,
  CardHeader,
  DataTable,
  EditIcon,
  EmptyState,
  Money,
  ProgressBar,
  SalesIcon,
  ShirtIcon,
  Skeleton,
  SkeletonText,
  UndoIcon,
  cn,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay } from '../../lib/dates';
import { getCustomer, getPurchases, updateCustomer } from './api';
import { CustomerForm } from './CustomerForm';

const SOURCE_TEXT: Record<string, string> = {
  sale: 'فاتورة آجل',
  return: 'مرتجع',
  receipt: 'دفعة',
};

/** A title over a table, with a line of what it holds. */
function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted">{description}</p>
    </div>
  );
}

/**
 * A document number («INV-001-002-0000419») that may break only before its last part, so a narrow
 * column shows «INV-001-002-» over «0000419» instead of three broken pieces.
 */
function DocNumber({ value }: { value: string }) {
  const cut = value.lastIndexOf('-') + 1;
  return (
    <bdi dir="ltr" className="num">
      <span className="whitespace-nowrap">{value.slice(0, cut)}</span>
      <wbr />
      <span className="whitespace-nowrap">{value.slice(cut)}</span>
    </bdi>
  );
}

/** The pieces of an invoice: each line with its quantity, and what came back of it. */
function InvoiceLines({ lines }: { lines: CustomerPurchases['invoices'][number]['lines'] }) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((l, index) => (
        <li key={index} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{l.name}</span>
          <span className="num text-ink-muted">×{l.qty / 1000}</span>
          {l.returnedQty > 0 ? (
            <Badge tone="warning">
              رجع <bdi className="num">{l.returnedQty / 1000}</bdi>
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One fact of the profile: a small label over its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-semibold text-ink-subtle">{label}</dt>
      <dd className="truncate text-sm text-ink">{children}</dd>
    </div>
  );
}

/** A label and its value on one line of a summary card. */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}

/**
 * The side summary: what the customer owes (or is owed), and how much of the credit limit that is,
 * from the balance and limit the page already has.
 */
function BalanceCard({ customer, currency }: { customer: CustomerDetail; currency: CurrencyCode }) {
  const balance = customer.balanceMinor;
  const limit = customer.creditLimitMinor;
  const owed = Math.max(0, balance);
  const over = limit !== null && balance > limit;
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">{balance >= 0 ? 'عليه' : 'له عند المتجر'}</p>
          {over ? <Badge tone="danger">فوق حد الدين</Badge> : null}
        </div>
        <p className="num text-kpi font-bold tracking-tight text-ink">
          <Money
            minor={Math.abs(balance)}
            currency={currency}
            unitClassName="text-base font-semibold text-ink-subtle"
          />
        </p>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line pt-4">
        <dl>
          <SummaryRow label="حد الدين">
            {limit === null ? 'بلا حد' : <Money minor={limit} currency={currency} />}
          </SummaryRow>
        </dl>
        {limit !== null && limit > 0 ? (
          <>
            <ProgressBar
              label="ما استُخدم من حد الدين"
              value={owed}
              max={limit}
              tone={over ? 'danger' : owed >= limit * 0.8 ? 'warning' : 'brand'}
            />
            <p className="text-xs text-ink-subtle">
              {over ? (
                <>
                  تجاوز الحد بـ <Money minor={balance - limit} currency={currency} />
                </>
              ) : (
                <>
                  يبقى <Money minor={limit - owed} currency={currency} /> قبل الحد
                </>
              )}
            </p>
          </>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * «مشترياته»: what the customer bought in all, the sizes they buy most (the most first, so the
 * till can advise «ريم تلبس M») and the day of their latest purchase.
 */
function SizesCard({ purchases, currency }: { purchases: CustomerPurchases; currency: CurrencyCode }) {
  const digits = useDigits();
  const latest = purchases.invoices[0];
  return (
    <section aria-label="مشترياته">
      <Card>
        <CardHeader
          icon={<ShirtIcon />}
          title="مشترياته"
          description={
            <>
              <bdi className="num">{purchases.pieces / 1000}</bdi> قطعة بـ{' '}
              <Money minor={purchases.spentMinor} currency={currency} /> بعد المرتجعات.
            </>
          }
        />
        {purchases.sizes.length === 0 ? (
          <p className="text-sm text-ink-muted">لا مقاسات في مشترياته بعد.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {purchases.sizes.map((s) => (
              <div key={s.name} className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-ink-subtle">{s.name}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {s.values.map((v, index) => (
                    <li
                      key={v.value}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-small px-2.5 py-1 text-sm',
                        index === 0 ? 'bg-brand-soft text-brand-ink' : 'bg-surface-muted text-ink',
                      )}
                    >
                      <bdi className="font-semibold">{v.value}</bdi>
                      <span className={cn('num text-xs', index === 0 ? 'text-brand-ink' : 'text-ink-muted')}>
                        ×{v.qty / 1000}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <dl className="mt-5 border-t border-line pt-4">
          <SummaryRow label="آخر شراء">
            {latest ? <bdi className="num">{dayText(latest.date, digits)}</bdi> : '—'}
          </SummaryRow>
        </dl>
      </Card>
    </section>
  );
}

/** The page's shape while the customer loads. */
function LoadingCustomer() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Card className="flex items-center gap-4">
        <Skeleton className="size-10" />
        <span className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </span>
      </Card>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <SkeletonText lines={5} />
        </Card>
        <Card>
          <SkeletonText lines={3} />
        </Card>
      </div>
    </div>
  );
}

/** One customer (12 › كشف حساب زبون): what they owe, every sale on credit and every payment. */
export function CustomerPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const digits = useDigits();
  const canManage = me.user.permissions.includes('customers.manage');
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [purchases, setPurchases] = useState<CustomerPurchases | null>(null);

  const load = useCallback(() => {
    setError(null);
    getCustomer(id)
      .then(setCustomer)
      .catch((e: unknown) => setError(errorMessage(e)));
    getPurchases(id)
      .then(setPurchases)
      .catch(() => setPurchases(null));
  }, [id]);
  useEffect(load, [load]);

  async function archive(archived: boolean) {
    if (!customer) return;
    try {
      setCustomer(await updateCustomer(customer.id, { name: customer.name, archived }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const base = customer?.baseCurrency ?? 'SYP';
  // On a phone «عليه» and «له» share one column, and the date moves under the entry.
  const columns: DataColumn<StatementLine>[] = [
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
          <span className="font-semibold">{SOURCE_TEXT[l.sourceType] ?? l.memo}</span>
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
    },
    {
      key: 'credit',
      header: 'له',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => (l.creditMinor ? <Money minor={l.creditMinor} currency={base} /> : ''),
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
      cell: (l) => <Money minor={l.balanceMinor} currency={base} className="font-semibold" />,
    },
  ];

  return (
    <AppShell>
      <title>{`${customer?.name ?? 'زبون'} · Serva POS`}</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 self-start rounded-small text-sm font-semibold text-ink-muted transition-colors duration-120 ease-standard hover:text-ink"
        >
          <BackIcon size={16} /> الزبائن
        </Link>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!customer && !error ? <LoadingCustomer /> : null}
        {customer ? (
          <>
            <Card>
              <div className="flex flex-wrap items-start gap-4">
                <Avatar name={customer.name} />
                <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h1 className="text-2xl font-bold text-ink">{customer.name}</h1>
                    {customer.priceTier === 'wholesale' ? <Badge tone="brand">زبون جملة</Badge> : null}
                    {customer.archived ? <Badge>مؤرشف</Badge> : null}
                    {customer.noMessages ? <Badge>لا يريد رسائل</Badge> : null}
                  </div>
                  <p className="text-sm text-ink-muted">
                    زبون منذ{' '}
                    <bdi className="num">
                      {dayText(isoDay(Date.parse(customer.createdAt), me.tenant.timezone), digits)}
                    </bdi>
                  </p>
                </div>
                {canManage && !editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" icon={<EditIcon />} onClick={() => setEditing(true)}>
                      عدّل
                    </Button>
                    <Button
                      variant="ghost"
                      icon={customer.archived ? <UndoIcon /> : <ArchiveIcon />}
                      onClick={() => void archive(!customer.archived)}
                    >
                      {customer.archived ? 'أرجعه' : 'أرشفه'}
                    </Button>
                  </div>
                ) : null}
              </div>
              <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3">
                <Fact label="الجوال">
                  {customer.phone ? (
                    <bdi dir="ltr" className="num">
                      {customer.phone}
                    </bdi>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact label="العنوان">{customer.address ?? '—'}</Fact>
                <Fact label="الرقم الضريبي">
                  {customer.taxNumber ? <bdi className="num">{customer.taxNumber}</bdi> : '—'}
                </Fact>
              </dl>
              {customer.notes ? (
                <p className="mt-4 rounded-control bg-surface-muted px-4 py-3 text-sm text-ink-muted">
                  <span className="font-semibold text-ink">ملاحظات: </span>
                  {customer.notes}
                </p>
              ) : null}
            </Card>
            {customer.archived ? (
              <Alert tone="info">هذا الزبون مؤرشف: لا يظهر على أجهزة الكاشير.</Alert>
            ) : null}
            {editing ? (
              <CustomerForm
                customer={customer}
                onSaved={(c) => {
                  setCustomer(c);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : null}
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
                <BalanceCard customer={customer} currency={base} />
                {purchases ? <SizesCard purchases={purchases} currency={base} /> : null}
              </aside>
              <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
                {purchases ? (
                  <section className="flex flex-col gap-3">
                    <SectionTitle
                      title="آخر الفواتير"
                      description="أحدث ما اشتراه، قطعة قطعة، وما رجع منه."
                    />
                    <DataTable
                      caption="آخر الفواتير"
                      columns={[
                        {
                          key: 'number',
                          header: 'الفاتورة',
                          cell: (r) => (
                            <div className="flex flex-col gap-0.5 py-2.5">
                              <span className="font-semibold">
                                <DocNumber value={r.number} />
                              </span>
                              <span className="text-xs text-ink-muted">
                                <bdi className="num">{r.date}</bdi>
                              </span>
                              <div className="mt-1.5 sm:hidden">
                                <InvoiceLines lines={r.lines} />
                              </div>
                            </div>
                          ),
                        },
                        {
                          key: 'lines',
                          header: 'القطع',
                          className: 'hidden sm:table-cell',
                          cell: (r) => (
                            <div className="py-2.5">
                              <InvoiceLines lines={r.lines} />
                            </div>
                          ),
                        },
                        {
                          key: 'total',
                          header: 'المبلغ',
                          numeric: true,
                          cell: (r) => (
                            <Money minor={r.totalMinor} currency={r.currency} className="font-semibold" />
                          ),
                        },
                      ]}
                      rows={purchases.invoices}
                      rowKey={(r) => r.id}
                      empty={<EmptyState icon={SalesIcon} title="لم يشترِ شيئاً بعد." />}
                    />
                  </section>
                ) : null}
                <section className="flex flex-col gap-3">
                  <SectionTitle
                    title="كشف الحساب"
                    description="كل بيع بالآجل وكل دفعة ومرتجع، والرصيد بعد كل حركة."
                  />
                  <DataTable
                    caption="كشف الحساب"
                    columns={columns}
                    rows={customer.statement}
                    rowKey={(l) => `${l.sourceId}:${l.balanceMinor}:${l.debitMinor}:${l.creditMinor}`}
                    empty={
                      <EmptyState
                        icon={BookIcon}
                        title="لا حركة على حساب هذا الزبون بعد."
                        description="يظهر هنا كل بيع بالآجل له، وكل دفعة يدفعها."
                      />
                    }
                  />
                </section>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
