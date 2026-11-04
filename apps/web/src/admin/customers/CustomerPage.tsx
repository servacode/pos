import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { CustomerDetail, CustomerPurchases, StatementLine } from '@serva/core';
import {
  Alert,
  BackIcon,
  Button,
  DataTable,
  FullScreenLoader,
  Money,
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex items-center gap-4">
          <Link to="/customers" className="inline-flex items-center gap-1 font-semibold text-brand-ink">
            <BackIcon size={16} /> الزبائن
          </Link>
          <h1 className="flex-1 text-2xl font-bold text-ink">{customer?.name ?? ''}</h1>
          {customer && canManage && !editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                عدّل
              </Button>
              <Button variant="ghost" onClick={() => void archive(!customer.archived)}>
                {customer.archived ? 'أرجعه' : 'أرشفه'}
              </Button>
            </>
          ) : null}
        </div>
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
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                hero
                label={customer.balanceMinor >= 0 ? 'عليه' : 'له عند المتجر'}
                value={<Money minor={Math.abs(customer.balanceMinor)} currency={base} />}
              />
              <StatTile
                label="حد الدين"
                value={
                  customer.creditLimitMinor === null ? (
                    'بلا حد'
                  ) : (
                    <Money minor={customer.creditLimitMinor} currency={base} />
                  )
                }
              />
              <StatTile
                label="الجوال"
                value={
                  customer.phone ? (
                    <bdi dir="ltr" className="num">
                      {customer.phone}
                    </bdi>
                  ) : (
                    '—'
                  )
                }
              />
            </div>
            {purchases ? (
              <section aria-label="مشترياته" className="flex flex-col gap-3">
                <h2 className="text-xl font-bold text-ink">مشترياته</h2>
                <p className="text-ink-muted">
                  <span className="num">{purchases.pieces / 1000}</span> قطعة بـ{' '}
                  <Money minor={purchases.spentMinor} currency={base} /> بعد المرتجعات.
                </p>
                {purchases.sizes.map((s) => (
                  <p key={s.name}>
                    <span className="font-semibold">{s.name}: </span>
                    {s.values.map((v) => `${v.value} (${v.qty / 1000})`).join('، ')}
                  </p>
                ))}
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
    </AppShell>
  );
}
