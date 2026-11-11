import { useEffect, useState } from 'react';
import type { SerialRow } from '@serva/core';
import {
  Alert,
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  SearchField,
  SerialIcon,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { findSerials } from './api';
import { SectionHead } from './parts';

/** A document number over its date, or a dash when there is none. */
function DocCell({ number, date }: { number: string | null; date: string | null }) {
  if (!number) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="flex flex-col items-start">
      <bdi dir="ltr" className="num text-sm">
        {number}
      </bdi>
      {date ? <span className="num text-xs text-ink-subtle">{date}</span> : null}
    </span>
  );
}

/**
 * «الأرقام التسلسلية» (03 › الإلكترونيات): a phone by its IMEI — in stock or sold, when it came in
 * and went out, and until when its warranty runs.
 */
export function SerialsPage() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SerialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setError(null);
      findSerials(q.trim())
        .then((r) => setItems(r.items))
        .catch((e: unknown) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const columns: DataColumn<SerialRow>[] = [
    {
      key: 'serial',
      className: 'whitespace-nowrap',
      header: 'الرقم',
      cell: (r) => (
        <bdi dir="ltr" className="num font-semibold">
          {r.serial}
        </bdi>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) =>
        r.status === 'sold' ? <Badge tone="neutral">مباع</Badge> : <Badge tone="success">في المحل</Badge>,
    },
    { key: 'name', className: 'whitespace-nowrap', header: 'الجهاز', cell: (r) => r.name },
    {
      key: 'in',
      className: 'whitespace-nowrap',
      header: 'الاستلام',
      cell: (r) => <DocCell number={r.purchaseNumber} date={r.receivedOn} />,
    },
    {
      key: 'out',
      className: 'whitespace-nowrap',
      header: 'البيع',
      cell: (r) => <DocCell number={r.saleNumber} date={r.soldOn} />,
    },
    {
      key: 'warranty',
      className: 'whitespace-nowrap',
      header: 'الكفالة حتى',
      cell: (r) =>
        r.warrantyUntil ? (
          <span className="num">{r.warrantyUntil}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ];

  return (
    <AppShell>
      <title>الأرقام التسلسلية · Serva POS</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="الأرقام التسلسلية"
          description="كل جهاز برقمه: في المحل أو مباع، متى استُلم ومتى بيع، والكفالة حتى متى."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <section aria-label="الأجهزة" className="flex flex-col gap-3">
          <SectionHead
            title="الأجهزة"
            description={q.trim() ? 'ما يطابق بحثك.' : 'آخر ما استُلم أولاً. ابحث برقم الجهاز لتجده.'}
          >
            <SearchField
              label="ابحث بالرقم التسلسلي أو IMEI"
              value={q}
              onValueChange={setQ}
              className="w-full sm:w-80"
            />
          </SectionHead>
          <DataTable
            caption="الأجهزة بأرقامها"
            columns={columns}
            rows={items ?? []}
            rowKey={(r) => r.serial}
            loading={!items && !error}
            empty={
              <EmptyState
                icon={SerialIcon}
                title="لا رقم مطابق."
                description="الأرقام تُكتب في فاتورة الشراء وتُمسح على الكاشير عند البيع."
              />
            }
          />
        </section>
      </div>
    </AppShell>
  );
}
