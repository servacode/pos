import { useCallback, useEffect, useState } from 'react';
import type { Cheque, ChequeStatus, CurrencyCode } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Money,
  SegmentedControl,
  StatTile,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { actOnCheque, listCheques } from './api';

const STATUS_TEXT: Record<ChequeStatus, string> = {
  pending: 'تحت التحصيل',
  cleared: 'حُصّل',
  bounced: 'مرتجع',
};

/** Today on the store's clock, «2026-11-03» */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());

/**
 * «الشيكات» (03 › الجملة: الآجل والشيكات): every cheque a till took, for a sale or a customer's
 * payment, waiting in «شيكات تحت التحصيل» until the owner marks it cashed into the bank or bounced
 * back onto the customer's account. Each mark is one entry in the books, and cannot be undone here.
 */
export function ChequesPage() {
  const me = useMe();
  const canManage = me.user.permissions.includes('customers.manage');
  const [filter, setFilter] = useState<ChequeStatus | 'all'>('pending');
  const [items, setItems] = useState<Cheque[] | null>(null);
  const [base, setBase] = useState<CurrencyCode>('SYP');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listCheques(filter === 'all' ? undefined : filter)
      .then((r) => {
        setItems(r.items);
        setBase(r.baseCurrency);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [filter]);
  useEffect(load, [load]);

  async function mark(c: Cheque, action: 'cleared' | 'bounced') {
    const key = `${c.sourceId}-${c.paymentNo}`;
    setBusy(key);
    setError(null);
    try {
      await actOnCheque({
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        paymentNo: c.paymentNo,
        action,
        date: today(),
      });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const pendingTotal = (items ?? [])
    .filter((c) => c.status === 'pending')
    .reduce((sum, c) => sum + c.amountMinor, 0);

  const columns: DataColumn<Cheque>[] = [
    { key: 'date', header: 'التاريخ', cell: (c) => <bdi className="num">{c.date}</bdi> },
    { key: 'customer', header: 'الزبون', cell: (c) => c.customerName ?? '—' },
    { key: 'reference', header: 'رقم الشيك', cell: (c) => c.reference ?? '—' },
    {
      key: 'doc',
      header: 'المستند',
      cell: (c) => (
        <bdi dir="ltr" className="num text-sm">
          {c.documentNumber}
        </bdi>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (c) => <Money minor={c.amountMinor} currency={c.currency} />,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (c) => (
        <Badge tone={c.status === 'pending' ? 'warning' : c.status === 'cleared' ? 'success' : 'danger'}>
          {STATUS_TEXT[c.status]}
          {c.actionDate ? ` ${c.actionDate}` : ''}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (c) =>
        c.status === 'pending' && canManage ? (
          <span className="flex gap-2">
            <Button
              size="sm"
              loading={busy === `${c.sourceId}-${c.paymentNo}`}
              onClick={() => void mark(c, 'cleared')}
            >
              حُصّل
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void mark(c, 'bounced')}>
              مرتجع
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <AppShell>
      <title>الشيكات · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">الشيكات</h1>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Alert tone="info">
          «حُصّل» ينقل المبلغ إلى البنك. «مرتجع» يعيده ديناً على الزبون في كشف حسابه. كل منهما قيد واحد في
          الدفاتر.
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile label="تحت التحصيل" value={<Money minor={pendingTotal} currency={base} />} />
          <StatTile label="عدد الشيكات" value={items?.length ?? 0} />
        </div>
        <SegmentedControl
          label="اعرض"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'pending', label: 'تحت التحصيل' },
            { value: 'cleared', label: 'المحصّلة' },
            { value: 'bounced', label: 'المرتجعة' },
            { value: 'all', label: 'الكل' },
          ]}
        />
        <DataTable
          caption="الشيكات"
          columns={columns}
          rows={items ?? []}
          rowKey={(c) => `${c.sourceType}-${c.sourceId}-${c.paymentNo}`}
          loading={!items && !error}
          {...(error ? { onRetry: load } : {})}
          empty="لا شيكات هنا. الكاشير يقبل الشيك من «الدفع» بعد اختيار الزبون."
        />
      </div>
    </AppShell>
  );
}
