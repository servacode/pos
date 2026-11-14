import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { SupplierListResponse, SupplierRow } from '@serva/core';
import {
  Badge,
  DataTable,
  Money,
  PageHeader,
  SearchField,
  StatTile,
  ToggleChip,
  UserIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { ReportScreen } from '../reports/parts';
import { listSuppliers } from './api';

/**
 * «الموردون»: every supplier with what the store owes them, each linked to their statement. New
 * suppliers and payments stay on «المشتريات».
 */
export function SuppliersPage() {
  const me = useMe();
  const [list, setList] = useState<SupplierListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [owed, setOwed] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listSuppliers()
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const base = list?.baseCurrency ?? me.settings.baseCurrency;
  const needle = search.trim().toLowerCase();
  const items = (list?.items ?? []).filter(
    (s) =>
      (!needle || s.name.toLowerCase().includes(needle) || (s.phone ?? '').includes(needle)) &&
      (!owed || s.balanceMinor > 0),
  );

  const columns: DataColumn<SupplierRow>[] = [
    {
      key: 'name',
      header: 'المورد',
      cell: (s) => (
        <span className="flex flex-col gap-0.5 py-2">
          <Link
            to={`/suppliers/${s.id}/statement`}
            className="font-semibold text-ink hover:text-brand-ink hover:underline"
          >
            {s.name}
          </Link>
          {s.phone ? (
            <bdi dir="ltr" className="num text-xs text-ink-muted sm:hidden">
              {s.phone}
            </bdi>
          ) : null}
          {s.archived ? <Badge>مؤرشف</Badge> : null}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'الجوال',
      className: 'hidden sm:table-cell',
      cell: (s) =>
        s.phone ? (
          <bdi dir="ltr" className="num text-ink-muted">
            {s.phone}
          </bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'balance',
      header: 'له عليك',
      numeric: true,
      cell: (s) => <Money minor={s.balanceMinor} currency={base} className="font-semibold" />,
    },
    {
      key: 'statement',
      header: <span className="sr-only">كشف الحساب</span>,
      cell: (s) => (
        <Link
          to={`/suppliers/${s.id}/statement`}
          className="text-sm font-semibold text-brand-ink hover:underline"
        >
          كشف الحساب
        </Link>
      ),
    },
  ];

  return (
    <ReportScreen me={me} access={['purchases.manage']} title="الموردون">
      <PageHeader
        title="الموردون"
        description="من تشتري منهم، وكم لهم عليك. لإضافة مورد أو تسجيل دفعة افتح «المشتريات»."
        icon={<UserIcon />}
      />
      <StatTile
        label="ما عليك للموردين"
        icon={<UserIcon />}
        value={<Money minor={list?.totalOwedMinor ?? 0} currency={base} />}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          label="ابحث بالاسم أو الجوال"
          value={search}
          onValueChange={setSearch}
          className="min-w-0 flex-1 basis-64 sm:max-w-md"
        />
        <ToggleChip label="من له مبلغ فقط" checked={owed} onChange={(e) => setOwed(e.target.checked)} />
      </div>
      <DataTable
        caption="الموردون وأرصدتهم"
        columns={columns}
        rows={items}
        rowKey={(s) => s.id}
        loading={!list && !error}
        {...(error ? { error, onRetry: load } : {})}
        empty={<p className="p-4 text-ink-muted">لا موردين بهذا البحث.</p>}
      />
    </ReportScreen>
  );
}
