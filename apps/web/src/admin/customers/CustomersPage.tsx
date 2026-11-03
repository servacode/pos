import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CustomerListItem, CustomerListResponse } from '@serva/core';
import { Button, DataTable, Money, SearchField, StatTile, ToggleChip, type DataColumn } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { listCustomers } from './api';
import { CustomerForm } from './CustomerForm';

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
  const columns: DataColumn<CustomerListItem>[] = [
    {
      key: 'name',
      header: 'الزبون',
      cell: (c) => (
        <Link to={`/customers/${c.id}`} className="font-semibold text-brand-ink hover:underline">
          {c.name}
          {c.archived ? <span className="ms-2 text-xs text-ink-muted">(مؤرشف)</span> : null}
        </Link>
      ),
    },
    {
      key: 'phone',
      header: 'الجوال',
      cell: (c) =>
        c.phone ? (
          <bdi dir="ltr" className="num">
            {c.phone}
          </bdi>
        ) : (
          '—'
        ),
    },
    {
      key: 'limit',
      header: 'حد الدين',
      numeric: true,
      cell: (c) => (c.creditLimitMinor === null ? '—' : <Money minor={c.creditLimitMinor} currency={base} />),
    },
    {
      key: 'balance',
      header: 'الرصيد',
      numeric: true,
      cell: (c) => (
        <Money
          minor={c.balanceMinor}
          currency={base}
          className={
            c.creditLimitMinor !== null && c.balanceMinor > c.creditLimitMinor
              ? 'font-bold text-danger-ink'
              : 'font-semibold'
          }
        />
      ),
    },
  ];

  return (
    <AppShell>
      <title>الزبائن · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex items-center gap-4">
          <h1 className="flex-1 text-2xl font-bold text-ink">الزبائن</h1>
          {canManage && !adding ? <Button onClick={() => setAdding(true)}>زبون جديد</Button> : null}
        </div>
        {adding ? (
          <CustomerForm onSaved={(c) => navigate(`/customers/${c.id}`)} onCancel={() => setAdding(false)} />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="الديون على الزبائن"
            value={<Money minor={list?.totalOwedMinor ?? 0} currency={base} />}
          />
          <StatTile label="عدد الزبائن" value={list?.items.length ?? 0} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            label="ابحث بالاسم أو الجوال"
            value={search}
            onValueChange={setSearch}
            className="min-w-64 flex-1"
          />
          <ToggleChip label="من عليه دين فقط" checked={owing} onChange={(e) => setOwing(e.target.checked)} />
        </div>
        <DataTable
          caption="الزبائن وأرصدتهم"
          columns={columns}
          rows={list?.items ?? []}
          rowKey={(c) => c.id}
          loading={!list && !error}
          {...(error ? { error, onRetry: load } : {})}
          empty={owing ? 'لا أحد عليه دين.' : 'لا زبائن بعد. أضف أول زبون، أو يضيفه الكاشير من شاشة البيع.'}
        />
      </div>
    </AppShell>
  );
}
