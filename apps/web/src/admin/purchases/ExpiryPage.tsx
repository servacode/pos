import { useCallback, useEffect, useState } from 'react';
import type { ExpiryResponse, ExpiryRow } from '@serva/core';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  DataTable,
  ExpiryIcon,
  PageHeader,
  WarningIcon,
  formatQuantity,
  SegmentedControl,
  StatTile,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { listExpiry } from './api';

/**
 * «الصلاحية» (03 › الصيدليات): batches on the shelf that have expired or soon will, earliest first,
 * from the expiry typed on each purchase line. What is left of a batch is estimated: the stock is
 * taken from the newest receipts first, as the oldest sell first.
 */
export function ExpiryPage() {
  const [days, setDays] = useState<'30' | '90' | '180'>('90');
  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listExpiry(Number(days))
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [days]);
  useEffect(load, [load]);

  const items = data?.items ?? [];
  const expired = items.filter((r) => r.daysLeft < 0).length;
  const week = items.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 7).length;
  const month = items.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30).length;
  const columns: DataColumn<ExpiryRow>[] = [
    { key: 'name', header: 'الصنف', cell: (r) => r.name },
    { key: 'batch', header: 'الدفعة', cell: (r) => r.batchNo ?? '—' },
    { key: 'expiry', header: 'تاريخ الانتهاء', cell: (r) => <bdi className="num">{r.expiryDate}</bdi> },
    {
      key: 'left',
      header: 'الحالة',
      cell: (r) =>
        r.daysLeft < 0 ? (
          <Badge tone="danger">منتهٍ منذ {-r.daysLeft} يوماً</Badge>
        ) : r.daysLeft <= 30 ? (
          <Badge tone="warning">باقٍ {r.daysLeft} يوماً</Badge>
        ) : (
          <Badge tone="neutral">باقٍ {r.daysLeft} يوماً</Badge>
        ),
    },
    { key: 'qty', header: 'على الرف (تقديراً)', numeric: true, cell: (r) => formatQuantity(r.qty) },
    {
      key: 'purchase',
      header: 'الاستلام',
      cell: (r) => (
        <bdi dir="ltr" className="num text-sm">
          {r.purchaseNumber} · {r.receivedOn}
        </bdi>
      ),
    },
  ];

  return (
    <AppShell>
      <title>الصلاحية · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          className="mb-0"
          icon={ExpiryIcon}
          title="الصلاحية"
          description="الدفعات المنتهية والقريبة من الانتهاء، الأقرب أولاً"
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="منتهية"
            icon={WarningIcon}
            tone={expired > 0 ? 'danger' : 'neutral'}
            value={expired}
          />
          <StatTile
            label="تنتهي خلال 7 أيام"
            icon={ExpiryIcon}
            tone={week > 0 ? 'warning' : 'neutral'}
            value={week}
          />
          <StatTile
            label="تنتهي خلال 30 يوماً"
            icon={ExpiryIcon}
            tone={month > 0 ? 'warning' : 'neutral'}
            value={month}
          />
        </div>
        <SegmentedControl
          label="خلال"
          value={days}
          onValueChange={setDays}
          options={[
            { value: '30', label: '30 يوماً' },
            { value: '90', label: '3 أشهر' },
            { value: '180', label: '6 أشهر' },
          ]}
        />
        <Card>
          <CardHeader icon={ExpiryIcon} title="الدفعات حسب الصلاحية" description="مرتبة من الأقرب انتهاءً" />
          <DataTable
            caption="الدفعات حسب الصلاحية"
            columns={columns}
            rows={items}
            rowKey={(r) => `${r.purchaseNumber}-${r.variantId}`}
            loading={!data && !error}
            {...(error ? { onRetry: load } : {})}
            empty="لا شيء ينتهي في هذه المدة. اكتب الدفعة وتاريخ الانتهاء في فاتورة الشراء ليظهر هنا."
          />
        </Card>
      </div>
    </AppShell>
  );
}
