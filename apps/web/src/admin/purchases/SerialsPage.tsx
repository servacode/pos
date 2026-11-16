import { useEffect, useMemo, useState } from 'react';
import { COUNT_NOUNS, countNoun, SERIAL_FLAG_LABELS, serialLabel, type SerialRow } from '@serva/core';
import {
  Alert,
  Badge,
  DataTable,
  EmptyState,
  Button,
  PageHeader,
  SearchField,
  SegmentedControl,
  BarcodeIcon,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { dayText } from '../../lib/dates';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { useMe } from '../../auth/useAuth';
import { fixSerialRow, serialsOf } from '../warranty/api';
import { getInventory } from './api';
import { SectionHead } from './parts';

/** A document number over its date, or a dash when there is none. */
function DocCell({ number, date }: { number: string | null; date: string | null }) {
  const digits = useDigits();
  if (!number) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="flex flex-col items-start">
      <bdi dir="ltr" className="num text-sm">
        {number}
      </bdi>
      {date ? <span className="num text-xs text-ink-subtle">{dayText(date, digits)}</span> : null}
    </span>
  );
}

/**
 * «الأرقام التسلسلية» (03 › الإلكترونيات): a phone by its IMEI — in stock or sold, when it came in
 * and went out, and until when its warranty runs.
 */
export function SerialsPage() {
  const digits = useDigits();
  const me = useMe();
  const label = serialLabel(me.tenant.sectors);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'flagged'>('all');
  const [items, setItems] = useState<SerialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Read-only check: a device with more numbers «في المحل» than pieces in stock (a sale went out without its number)
  const [all, setAll] = useState<SerialRow[] | null>(null);
  const [stock, setStock] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([serialsOf({ q: '', flagged: false }), getInventory()]).then(
      ([serialList, inventory]) => {
        if (!alive) return;
        setAll(serialList.items);
        const byVariant = new Map<string, number>();
        for (const row of inventory.items)
          byVariant.set(row.variantId, (byVariant.get(row.variantId) ?? 0) + row.qty);
        setStock(byVariant);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [reloads]);
  const ahead = useMemo(() => {
    if (!all || !stock) return [];
    const counts = new Map<string, { name: string; n: number }>();
    for (const r of all) {
      if (r.status !== 'in_stock') continue;
      const c = counts.get(r.variantId) ?? { name: r.name, n: 0 };
      c.n += 1;
      counts.set(r.variantId, c);
    }
    return [...counts.entries()]
      .map(([variantId, c]) => ({
        name: c.name,
        n: c.n,
        inStock: Math.max(0, Math.round((stock.get(variantId) ?? 0) / 1000)),
      }))
      .filter((x) => x.n > x.inStock);
  }, [all, stock]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setError(null);
      serialsOf({ q: q.trim(), flagged: view === 'flagged' })
        .then((r) => setItems(r.items))
        .catch((e: unknown) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, view, reloads]);

  /** «تصحيح»: a sold number back in stock, or an in-stock one that was sold, by its history */
  async function fix(r: SerialRow) {
    setConfirming(null);
    try {
      await fixSerialRow({ serial: r.serial, status: r.status === 'sold' ? 'in_stock' : 'sold' });
      setReloads((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const columns: DataColumn<SerialRow>[] = [
    {
      key: 'serial',
      className: 'whitespace-nowrap',
      header: label === 'IMEI' ? 'IMEI' : 'الرقم',
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
        r.status === 'sold' ? (
          <Badge tone="neutral">مباع</Badge>
        ) : r.status === 'returned' ? (
          <Badge tone="neutral">أُعيد للمورد</Badge>
        ) : r.status === 'rented' ? (
          <Badge tone="warning">مؤجَّر</Badge>
        ) : (
          <Badge tone="success">في المحل</Badge>
        ),
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
          <span className="num">{dayText(r.warrantyUntil, digits)}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'flags',
      header: 'للمراجعة',
      cell: (r) =>
        r.flags.length > 0 || r.sales.length > 1 ? (
          <span className="flex flex-col items-start gap-1">
            {r.flags.map((f) => (
              <Badge key={f} tone={f === 'override' ? 'info' : 'warning'}>
                {SERIAL_FLAG_LABELS[f]}
              </Badge>
            ))}
            {r.sales.length > 1 || r.flags.length > 0 ? (
              <span className="text-xs text-ink-muted">
                {r.sales.map((s, i) => (
                  <span key={i} className="block">
                    <bdi dir="ltr" className="num">
                      {s.saleNumber ?? '—'}
                    </bdi>
                    {s.customerName ? ` · ${s.customerName}` : ' · بدون زبون'}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'fix',
      header: '',
      cell: (r) =>
        r.flags.length === 0 && r.status === 'in_stock' ? null : confirming === r.serial ? (
          <span className="flex gap-2">
            <Button size="sm" onClick={() => void fix(r)}>
              {r.status === 'sold' ? 'نعم، أرجعه للمخزون' : 'نعم، اعتبره مباعاً'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              لا
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(r.serial)}>
            تصحيح
          </Button>
        ),
    },
  ];

  return (
    <AppShell>
      <title>الأرقام التسلسلية · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="الأرقام التسلسلية"
          description="كل جهاز برقمه: في المحل أو مباع، متى استُلم ومتى بيع، والكفالة حتى متى."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {ahead.length > 0 ? (
          <Alert tone="warning">
            <span data-testid="serials-ahead" className="flex flex-col gap-1">
              {ahead.map((x) => (
                <span key={x.name}>
                  {x.name}: {countNoun(x.n, COUNT_NOUNS.piece)} برقم مسجّل · المخزون{' '}
                  <bdi className="num font-semibold">{x.inStock}</bdi> — في بيعة بلا رقم. صحّح الرقم الزائد
                  بزر «تصحيح».
                </span>
              ))}
            </span>
          </Alert>
        ) : null}
        <section aria-label="الأجهزة" className="flex flex-col gap-3">
          <SectionHead
            title="الأجهزة"
            description={q.trim() ? 'ما يطابق بحثك.' : 'آخر ما استُلم أولاً. ابحث برقم الجهاز لتجده.'}
          >
            <SegmentedControl
              label="العرض"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'all', label: 'الكل' },
                { value: 'flagged', label: 'للمراجعة' },
              ]}
            />
            <SearchField
              label={`ابحث بـ${label === 'IMEI' ? 'IMEI' : 'الرقم التسلسلي'}`}
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
                icon={BarcodeIcon}
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
