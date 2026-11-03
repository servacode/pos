import { useEffect, useState } from 'react';
import type { SerialRow } from '@serva/core';
import { Alert, Badge, DataTable, SearchField, type DataColumn } from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { findSerials } from './api';

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
      header: 'الرقم',
      cell: (r) => (
        <bdi dir="ltr" className="num font-semibold">
          {r.serial}
        </bdi>
      ),
    },
    { key: 'name', header: 'الجهاز', cell: (r) => r.name },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) =>
        r.status === 'sold' ? <Badge tone="neutral">مباع</Badge> : <Badge tone="success">في المحل</Badge>,
    },
    {
      key: 'in',
      header: 'الاستلام',
      cell: (r) => (r.purchaseNumber ? `${r.purchaseNumber} · ${r.receivedOn}` : '—'),
    },
    { key: 'out', header: 'البيع', cell: (r) => (r.saleNumber ? `${r.saleNumber} · ${r.soldOn}` : '—') },
    { key: 'warranty', header: 'الكفالة حتى', cell: (r) => r.warrantyUntil ?? '—' },
  ];

  return (
    <AppShell>
      <title>الأرقام التسلسلية · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">الأرقام التسلسلية</h1>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <SearchField label="ابحث بالرقم التسلسلي أو IMEI" value={q} onValueChange={setQ} />
        <DataTable
          caption="الأجهزة بأرقامها"
          columns={columns}
          rows={items ?? []}
          rowKey={(r) => r.serial}
          loading={!items && !error}
          empty="لا رقم مطابق. الأرقام تُكتب في فاتورة الشراء وتُمسح على الكاشير عند البيع."
        />
      </div>
    </AppShell>
  );
}
