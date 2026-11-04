import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { CustomerDetail, CustomerPurchases, StatementLine } from '@serva/core';
import {
  Alert,
  Avatar,
  BackIcon,
  Badge,
  Button,
  Card,
  CardHeader,
  CartIcon,
  CashIcon,
  DataTable,
  EditIcon,
  FullScreenLoader,
  Money,
  PageHeader,
  PhoneIcon,
  ReportsIcon,
  StatTile,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getCustomer, getPurchases, updateCustomer } from './api';
import { CustomerForm } from './CustomerForm';

const SOURCE_TEXT: Record<string, string> = {
  sale: 'فاتورة آجل',
  return: 'مرتجع',
  receipt: 'دفعة',
};

/** One customer (12 › كشف حساب زبون): what they owe, every sale on credit and every payment. */
export function CustomerPage() {
  const { id = '' } = useParams();
  const me = useMe();
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
  const columns: DataColumn<StatementLine>[] = [
    { key: 'date', header: 'التاريخ', cell: (l) => <span className="num">{l.date}</span> },
    {
      key: 'what',
      header: 'البيان',
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-semibold">{SOURCE_TEXT[l.sourceType] ?? l.memo}</span>
          {l.number ? (
            <bdi dir="ltr" className="num text-xs text-ink-muted">
              {l.number}
            </bdi>
          ) : null}
        </span>
      ),
    },
    {
      key: 'debit',
      header: 'عليه',
      numeric: true,
      cell: (l) => (l.debitMinor ? <Money minor={l.debitMinor} currency={base} /> : ''),
    },
    {
      key: 'credit',
      header: 'له',
      numeric: true,
      cell: (l) => (l.creditMinor ? <Money minor={l.creditMinor} currency={base} /> : ''),
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
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <PageHeader
          title={customer?.name ?? 'زبون'}
          description="كشف حساب الزبون ومشترياته."
          icon={CashIcon}
          eyebrow={
            <Link to="/customers" className="inline-flex items-center gap-1 font-semibold text-brand-ink">
              <BackIcon size={16} /> الزبائن
            </Link>
          }
          actions={
            customer && canManage && !editing ? (
              <>
                <Button variant="secondary" icon={<EditIcon />} onClick={() => setEditing(true)}>
                  عدّل
                </Button>
                <Button variant="ghost" onClick={() => void archive(!customer.archived)}>
                  {customer.archived ? 'أرجعه' : 'أرشفه'}
                </Button>
              </>
            ) : null
          }
        />
        <div className="flex flex-col gap-6">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {!customer && !error ? <FullScreenLoader /> : null}
          {customer && editing ? (
            <CustomerForm
              customer={customer}
              onSaved={(c) => {
                setCustomer(c);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : null}
          {customer ? (
            <>
              {customer.archived ? (
                <Alert tone="info">هذا الزبون مؤرشف: لا يظهر على أجهزة الكاشير.</Alert>
              ) : null}
              <Card className="flex flex-col gap-5 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <Avatar name={customer.name} size="md" className="size-16 text-xl" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-lg font-bold text-ink">{customer.name}</p>
                    <p className="flex items-center gap-1.5 text-ink-muted">
                      <PhoneIcon size={16} />
                      {customer.phone ? (
                        <bdi dir="ltr" className="num">
                          {customer.phone}
                        </bdi>
                      ) : (
                        '—'
                      )}
                    </p>
                    {customer.archived ? <Badge className="self-start">مؤرشف</Badge> : null}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:w-3/5">
                  <StatTile
                    hero
                    className="shadow-none"
                    icon={CashIcon}
                    label={customer.balanceMinor >= 0 ? 'عليه' : 'له عند المتجر'}
                    value={<Money minor={Math.abs(customer.balanceMinor)} currency={base} />}
                  />
                  <StatTile
                    className="shadow-none"
                    icon={ReportsIcon}
                    tone="info"
                    label="حد الدين"
                    value={
                      customer.creditLimitMinor === null ? (
                        'بلا حد'
                      ) : (
                        <Money minor={customer.creditLimitMinor} currency={base} />
                      )
                    }
                  />
                </div>
              </Card>
              {purchases ? (
                <section aria-label="مشترياته" className="flex flex-col gap-4">
                  <Card>
                    <CardHeader
                      icon={CartIcon}
                      title="مشترياته"
                      description={
                        <>
                          <span className="num">{purchases.pieces / 1000}</span> قطعة بـ{' '}
                          <Money minor={purchases.spentMinor} currency={base} /> بعد المرتجعات.
                        </>
                      }
                    />
                    {purchases.sizes.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {purchases.sizes.map((s) => (
                          <p key={s.name} className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{s.name}: </span>
                            {s.values.map((v) => `${v.value} (${v.qty / 1000})`).join('، ')}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                  <DataTable
                    caption="آخر الفواتير"
                    columns={[
                      {
                        key: 'number',
                        header: 'الفاتورة',
                        cell: (r) => (
                          <bdi dir="ltr" className="num font-semibold">
                            {r.number}
                          </bdi>
                        ),
                      },
                      { key: 'date', header: 'التاريخ', cell: (r) => <span className="num">{r.date}</span> },
                      {
                        key: 'lines',
                        header: 'القطع',
                        cell: (r) =>
                          r.lines
                            .map(
                              (l) =>
                                `${l.name} ×${l.qty / 1000}${l.returnedQty > 0 ? ` (رجع ${l.returnedQty / 1000})` : ''}`,
                            )
                            .join('، '),
                      },
                      {
                        key: 'total',
                        header: 'المبلغ',
                        numeric: true,
                        cell: (r) => <Money minor={r.totalMinor} currency={r.currency} />,
                      },
                    ]}
                    rows={purchases.invoices}
                    rowKey={(r) => r.id}
                    empty="لم يشترِ شيئاً بعد."
                  />
                </section>
              ) : null}
              <DataTable
                caption="كشف الحساب"
                columns={columns}
                rows={customer.statement}
                rowKey={(l) => `${l.sourceId}:${l.balanceMinor}:${l.debitMinor}:${l.creditMinor}`}
                empty="لا حركة على حساب هذا الزبون بعد."
              />
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
