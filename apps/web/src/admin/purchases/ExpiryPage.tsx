import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ExpiryResponse, ExpiryRow } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  CalendarIcon,
  DataTable,
  Dialog,
  EmptyState,
  formatQuantity,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatTile,
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { createStocktake, createSupplierReturn, listExpiry, qtyOf, setBatchBlocked, today } from './api';
import { SectionHead } from './parts';

type Urgency = 'all' | 'expired' | 'week' | 'month';
type Action = { kind: 'writeoff' | 'count' | 'return'; row: ExpiryRow };

/** A refusal made on this page before anything is sent: its message is shown as written */
class Refused extends Error {}

const daysOf = (r: ExpiryRow) => r.daysLeft ?? Number.POSITIVE_INFINITY;

/** How soon a batch ends: gone, within the week, within the month (days from today). */
const IN_URGENCY: Record<Exclude<Urgency, 'all'>, (r: ExpiryRow) => boolean> = {
  expired: (r) => daysOf(r) < 0,
  week: (r) => daysOf(r) >= 0 && daysOf(r) <= 7,
  month: (r) => daysOf(r) >= 0 && daysOf(r) <= 30,
};

const rowKey = (r: ExpiryRow) => `${r.variantId}|${r.branchId}|${r.batchNo ?? ''}|${r.expiryDate ?? ''}`;

const ACTION_TITLE: Record<Action['kind'], string> = {
  writeoff: 'أتلف الدفعة',
  count: 'عدّ الدفعة',
  return: 'أرجع للمورد',
};

/**
 * «الصلاحية» (03 › الصيدليات): the batches the store holds, with what is really left of each in
 * each branch (the batch ledger). An expired batch stays here until it is written off. Each batch
 * can be written off (through the count), counted, sent back to its supplier, or blocked so no till
 * sells it; «سحب دفعة» finds a batch by its number and everyone who got it.
 */
export function ExpiryPage() {
  const digits = useDigits();
  const [days, setDays] = useState<'30' | '90' | '180'>('90');
  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [urgency, setUrgency] = useState<Urgency>('all');
  const [action, setAction] = useState<Action | null>(null);
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState<ExpiryRow | null>(null);

  const load = useCallback(() => {
    setError(null);
    listExpiry(Number(days))
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [days]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(null);
  }, [printing]);

  const items = data?.items ?? [];
  const expired = items.filter(IN_URGENCY.expired);
  const week = items.filter(IN_URGENCY.week);
  const month = items.filter(IN_URGENCY.month);
  const shown = urgency === 'all' ? items : items.filter(IN_URGENCY[urgency]);

  function open(kind: Action['kind'], row: ExpiryRow) {
    setAction({ kind, row });
    setQty(kind === 'writeoff' ? '' : String(row.qty / 1000));
    setError(null);
    setDone(null);
  }

  async function confirm() {
    if (!action) return;
    const { kind, row } = action;
    const typed = qtyOf(qty);
    const label = `${row.batchNo ?? ''} من «${row.name}»`;
    setSaving(true);
    setError(null);
    try {
      if (kind === 'writeoff') {
        // The existing write-off path: a count of this batch alone, down to nothing, noted «هدر»
        await createStocktake({
          branchId: row.branchId,
          date: today(),
          note: 'هدر',
          lines: [
            { variantId: row.variantId, countedQty: 0, batchNo: row.batchNo, expiryDate: row.expiryDate },
          ],
        });
        setDone(`أُتلفت الدفعة ${label} وخرجت من المخزون.`);
      } else if (kind === 'count') {
        if (typed === null) throw new Refused('اكتب الكمية التي عددتها.');
        await createStocktake({
          branchId: row.branchId,
          date: today(),
          lines: [
            { variantId: row.variantId, countedQty: typed, batchNo: row.batchNo, expiryDate: row.expiryDate },
          ],
        });
        setDone(`سُجّل عدّ الدفعة ${label}.`);
      } else {
        if (!row.supplierId) {
          throw new Refused('لا مورد معروف لهذه الدفعة. سجّل المرتجع من صفحة «مرتجع إلى المورد».');
        }
        if (typed === null || typed <= 0) throw new Refused('اكتب كمية المرتجع.');
        await createSupplierReturn({
          supplierId: row.supplierId,
          branchId: row.branchId,
          date: today(),
          refund: 'credit',
          note: `دفعة ${row.batchNo ?? ''}`,
          lines: [{ variantId: row.variantId, qty: typed, batchNo: row.batchNo, expiryDate: row.expiryDate }],
        });
        setDone(`أُرجعت الدفعة ${label} إلى ${row.supplierName ?? 'المورد'}.`);
      }
      setAction(null);
      load();
    } catch (e) {
      setError(e instanceof Refused ? e.message : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBlock(row: ExpiryRow) {
    if (!row.batchNo) return;
    setError(null);
    setDone(null);
    try {
      await setBatchBlocked({ batchNo: row.batchNo, variantId: row.variantId }, !row.blocked);
      setDone(
        row.blocked
          ? `رُفع الإيقاف عن الدفعة ${row.batchNo}.`
          : `أُوقف بيع الدفعة ${row.batchNo} في كل الفروع.`,
      );
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const columns: DataColumn<ExpiryRow>[] = [
    { key: 'name', className: 'whitespace-nowrap', header: 'الصنف', cell: (r) => r.name },
    {
      key: 'left',
      className: 'whitespace-nowrap',
      header: 'الحالة',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {r.daysLeft === null ? (
            <Badge tone="neutral">بلا تاريخ</Badge>
          ) : r.daysLeft < 0 ? (
            <Badge tone="danger">منتهٍ منذ {-r.daysLeft} يوماً</Badge>
          ) : r.daysLeft <= 30 ? (
            <Badge tone="warning">باقٍ {r.daysLeft} يوماً</Badge>
          ) : (
            <Badge tone="neutral">باقٍ {r.daysLeft} يوماً</Badge>
          )}
          {r.blocked ? <Badge tone="danger">موقوفة</Badge> : null}
        </span>
      ),
    },
    {
      key: 'expiry',
      className: 'whitespace-nowrap',
      header: 'تاريخ الانتهاء',
      cell: (r) =>
        r.expiryDate ? <bdi className="num">{r.expiryDate}</bdi> : <span className="text-ink-subtle">—</span>,
    },
    {
      key: 'batch',
      className: 'whitespace-nowrap',
      header: 'الدفعة',
      cell: (r) =>
        r.batchNo ? (
          <bdi dir="ltr" className="num">
            {r.batchNo}
          </bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    { key: 'branch', className: 'whitespace-nowrap', header: 'الفرع', cell: (r) => r.branchName },
    {
      key: 'qty',
      header: 'المتبقي',
      numeric: true,
      cell: (r) => formatQuantity(r.qty, digits),
    },
    {
      key: 'purchase',
      className: 'whitespace-nowrap',
      header: 'الاستلام',
      cell: (r) =>
        r.purchaseNumber ? (
          <span className="flex flex-col items-start">
            <bdi dir="ltr" className="num text-sm">
              {r.purchaseNumber}
            </bdi>
            <span className="text-xs text-ink-subtle">
              {r.supplierName} · <span className="num">{r.receivedOn}</span>
            </span>
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 print:hidden">
          <Button size="sm" variant="secondary" onClick={() => open('writeoff', r)}>
            أتلف الدفعة
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open('count', r)}>
            عدّ
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open('return', r)}>
            أرجع للمورد
          </Button>
          {r.batchNo ? (
            <Button size="sm" variant="secondary" onClick={() => void toggleBlock(r)}>
              {r.blocked ? 'ارفع الإيقاف' : 'أوقف البيع'}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setPrinting(r)}>
            اطبع
          </Button>
        </span>
      ),
    },
  ];

  const count = (n: number) => (data ? n : <Skeleton className="h-9 w-12" />);
  return (
    <AppShell>
      <title>الصلاحية · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="الصلاحية"
          description="الدفعات التي انتهت أو تقترب من نهايتها بكمياتها الحقيقية في كل فرع. المنتهية تبقى هنا حتى تُتلَف."
          actions={
            <Link
              to="/recall"
              className="inline-flex min-h-11 items-center rounded-control border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
            >
              سحب دفعة
            </Link>
          }
        />
        {error && !action ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatTile
            label="منتهية"
            value={count(expired.length)}
            footnote={expired[0] ? `أقدمها: ${expired[0].name}` : data ? 'لا شيء منتهٍ' : undefined}
          />
          <StatTile
            label="تنتهي خلال 7 أيام"
            value={count(week.length)}
            footnote={week[0] ? `أقربها: ${week[0].name}` : data ? 'لا شيء هذا الأسبوع' : undefined}
          />
          <StatTile
            label="تنتهي خلال 30 يوماً"
            value={count(month.length)}
            footnote={month[0] ? `أقربها: ${month[0].name}` : data ? 'لا شيء هذا الشهر' : undefined}
          />
        </div>
        <section aria-label="الدفعات" className="flex flex-col gap-3">
          <SectionHead
            title="الدفعات"
            description="ما بقي من كل دفعة محسوب من الاستلام والبيع والمرتجع والإتلاف."
          >
            <SegmentedControl
              label="اعرض"
              value={urgency}
              onValueChange={setUrgency}
              options={[
                { value: 'all', label: 'الكل' },
                { value: 'expired', label: <UrgencyLabel text="منتهية" n={data ? expired.length : null} /> },
                { value: 'week', label: <UrgencyLabel text="هذا الأسبوع" n={data ? week.length : null} /> },
                { value: 'month', label: <UrgencyLabel text="هذا الشهر" n={data ? month.length : null} /> },
              ]}
            />
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="text-sm text-ink-muted">
                خلال
              </span>
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
            </span>
          </SectionHead>
          <DataTable
            caption="الدفعات حسب الصلاحية"
            columns={columns}
            rows={shown}
            rowKey={rowKey}
            loading={!data && !error}
            {...(error && !data ? { onRetry: load } : {})}
            empty={
              items.length > 0 ? (
                <EmptyState
                  icon={CalendarIcon}
                  title="لا دفعات في هذه المجموعة."
                  description="اختر «الكل» لترى الباقي."
                />
              ) : (
                <EmptyState
                  icon={CalendarIcon}
                  title="لا شيء ينتهي في هذه المدة."
                  description="اكتب الدفعة وتاريخ الانتهاء في فاتورة الشراء ليظهر هنا."
                />
              )
            }
          />
        </section>
      </div>
      {printing ? (
        <div className="hidden print:block" aria-hidden="true">
          <h1 className="text-lg font-bold">دفعة {printing.batchNo ?? ''}</h1>
          <p>{printing.name}</p>
          <p>الفرع: {printing.branchName}</p>
          <p>تنتهي: {printing.expiryDate ?? '—'}</p>
          <p>المتبقي: {formatQuantity(printing.qty, digits)}</p>
          <p>المورد: {printing.supplierName ?? '—'}</p>
        </div>
      ) : null}
      <Dialog
        open={action !== null}
        onOpenChange={(o) => !o && setAction(null)}
        title={action ? `${ACTION_TITLE[action.kind]} ${action.row.batchNo ?? ''}` : ''}
        description={action?.row.name}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>
              تراجع
            </Button>
            <Button loading={saving} onClick={() => void confirm()}>
              {action ? ACTION_TITLE[action.kind] : ''}
            </Button>
          </>
        }
      >
        {action?.kind === 'writeoff' ? (
          <p className="text-sm text-ink-muted">
            يخرج كل ما بقي من الدفعة ({formatQuantity(action.row.qty, digits)}) من المخزون كهدر، وتُسجَّل
            خسارته بكلفته.
          </p>
        ) : action ? (
          <TextField
            label={action.kind === 'count' ? 'الكمية التي عددتها' : 'الكمية الراجعة'}
            dir="ltr"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputClassName="num"
          />
        ) : null}
        {error && action ? <Alert tone="error">{error}</Alert> : null}
      </Dialog>
    </AppShell>
  );
}

/** A group's name with how many batches it holds. */
function UrgencyLabel({ text, n }: { text: string; n: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {n !== null ? <span className="num text-xs text-ink-subtle">{n}</span> : null}
    </span>
  );
}
