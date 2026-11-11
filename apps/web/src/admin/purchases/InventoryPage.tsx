import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { InventoryResponse, InventoryRow, ProfitReport, StocktakeDetail } from '@serva/core';
import {
  AlertCircleIcon,
  Alert,
  Badge,
  BarcodeIcon,
  Button,
  Card,
  CardHeader,
  CheckCircleIcon,
  cn,
  CONTROL_HEIGHT,
  DataTable,
  DeleteIcon,
  displayNumber,
  EmptyState,
  formatQuantity,
  ListIcon,
  Money,
  PageHeader,
  ProgressBar,
  ReportsIcon,
  SearchField,
  Select,
  Skeleton,
  StatTile,
  StockIcon,
  TextField,
  useDensity,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { lookupBarcode } from '../catalog/api';
import { createStocktake, getInventory, getProfit, qtyOf, today } from './api';
import { SectionHead } from './parts';

const monthStart = () => `${today().slice(0, 8)}01`;

/**
 * «المخزون والأرباح» (10 › الكلفة والربح): what each item's stock is worth at its average cost, the
 * month's gross profit from the books, and a count of the shelves that posts what is missing or
 * over.
 */
export function InventoryPage() {
  const me = useMe();
  const digits = useDigits();
  const density = useDensity();
  const canCount = me.user.permissions.includes('inventory.adjust');
  const canProfit = me.user.permissions.includes('reports.financial');
  const [stock, setStock] = useState<InventoryResponse | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<StocktakeDetail | null>(null);
  const [saving, setSaving] = useState(false);
  // «سجّل هدراً» (03 › الخضار والمخابز: تسجيل الهدر): what spoiled, out of stock at its cost
  const [wasteKey, setWasteKey] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  // Counting by scanning (03 › الألبسة: الجرد بالمسح): each scan adds one piece (or its pack)
  const [scan, setScan] = useState('');
  const [scanned, setScanned] = useState<{ variantId: string; name: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  // What the table shows: a search by name and, with branches, one branch
  const [query, setQuery] = useState('');
  const [branchShown, setBranchShown] = useState('');

  const load = useCallback(() => {
    setError(null);
    getInventory()
      .then(setStock)
      .catch((e: unknown) => setError(errorMessage(e)));
    if (canProfit)
      getProfit(monthStart(), today())
        .then(setProfit)
        .catch(() => setProfit(null));
  }, [canProfit]);
  useEffect(load, [load]);

  const base = stock?.baseCurrency ?? 'SYP';
  const manyBranches = me.branches.length > 1;
  const branchName = (id: string) => me.branches.find((b) => b.id === id)?.name ?? '';
  const items = stock?.items ?? [];
  const onShelf = items.reduce((sum, r) => sum + r.qty, 0);
  const kinds = new Set(items.map((r) => r.variantId)).size;
  const soldOut = items.filter((r) => r.qty <= 0).length;
  const counted = Object.values(counts).filter((text) => qtyOf(text) !== null).length;
  const needle = query.trim();
  const shown = items.filter(
    (r) => (!branchShown || r.branchId === branchShown) && (!needle || r.name.includes(needle)),
  );

  const columns: DataColumn<InventoryRow>[] = [
    {
      key: 'name',
      className: 'whitespace-nowrap',
      header: 'الصنف',
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{r.name}</span>
          {manyBranches ? <span className="text-xs text-ink-subtle">{branchName(r.branchId)}</span> : null}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'الكمية',
      numeric: true,
      // A shelf sold below nothing reads «−1», not «1-»
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.qty <= 0 ? <Badge tone="danger">نفد</Badge> : null}
          <bdi dir="ltr" className="num">
            {formatQuantity(r.qty, digits)}
          </bdi>
        </span>
      ),
    },
    {
      key: 'unit',
      header: 'كلفة الوحدة',
      numeric: true,
      cell: (r) =>
        r.unitCostMinor === null ? (
          <span className="text-ink-subtle">—</span>
        ) : (
          <Money minor={Math.round(r.unitCostMinor)} currency={base} className="text-ink-muted" />
        ),
    },
    {
      key: 'value',
      header: 'القيمة',
      numeric: true,
      cell: (r) => <Money minor={r.valueMinor} currency={base} className="font-semibold" />,
    },
    ...(counting
      ? [
          {
            key: 'counted',
            header: 'المعدود',
            cell: (r: InventoryRow) => (
              <TextField
                label={`المعدود من ${r.name}`}
                hideLabel
                inputMode="decimal"
                dir="ltr"
                placeholder="—"
                value={counts[r.variantId] ?? ''}
                onChange={(e) => setCounts((c) => ({ ...c, [r.variantId]: e.target.value }))}
                className="relative w-28"
                inputClassName="num"
              />
            ),
          },
        ]
      : []),
  ];

  async function addScan() {
    const code = scan.trim();
    setScan('');
    if (!code) return;
    setScanError(null);
    try {
      const hit = await lookupBarcode(code);
      const row = stock?.items.find((r) => r.variantId === hit.variantId);
      setCounts((c) => ({
        ...c,
        [hit.variantId]: String(((qtyOf(c[hit.variantId] ?? '') ?? 0) + hit.barcode.packQty) / 1000),
      }));
      setScanned({ variantId: hit.variantId, name: row?.name ?? code });
    } catch {
      setScanned(null);
      setScanError(`لا صنف بالباركود ${code}.`);
    }
  }

  async function saveCount() {
    const lines = Object.entries(counts)
      .map(([variantId, text]) => ({ variantId, countedQty: qtyOf(text) }))
      .filter((l): l is { variantId: string; countedQty: number } => l.countedQty !== null);
    if (lines.length === 0) return;
    setSaving(true);
    try {
      setResult(await createStocktake({ date: today(), note: null, lines }));
      setCounting(false);
      setCounts({});
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveWaste() {
    const row = stock?.items.find((r) => `${r.branchId}:${r.variantId}` === wasteKey);
    const qty = qtyOf(wasteQty);
    if (!row || !qty || qty <= 0) {
      setError('اختر الصنف واكتب كمية الهدر.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setResult(
        await createStocktake({
          branchId: row.branchId,
          date: today(),
          note: 'هدر',
          lines: [{ variantId: row.variantId, countedQty: Math.max(0, row.qty - qty) }],
        }),
      );
      setWasteKey('');
      setWasteQty('');
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const showWaste = canCount && !counting && (stock?.items.length ?? 0) > 0;
  const margin =
    profit && profit.netSalesMinor > 0 ? (profit.grossProfitMinor / profit.netSalesMinor) * 100 : null;

  return (
    <AppShell>
      <title>المخزون والأرباح · Serva POS</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="المخزون والأرباح"
          description={
            counting
              ? 'جرد الرفوف: امسح القطع أو اكتب ما عددته، ثم سجّل الجرد.'
              : 'ما على رفوفك بكلفته، وربح هذا الشهر من الدفاتر.'
          }
          actions={
            <>
              {canCount && !counting ? (
                <Button icon={<ListIcon />} onClick={() => setCounting(true)}>
                  جرد الرفوف
                </Button>
              ) : null}
              {counting ? (
                <>
                  <Button variant="ghost" onClick={() => setCounting(false)}>
                    إلغاء
                  </Button>
                  <Button icon={<ListIcon />} onClick={() => void saveCount()} loading={saving}>
                    سجّل الجرد
                  </Button>
                </>
              ) : null}
            </>
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {result ? (
          <Alert tone={result.diffValueMinor < 0 ? 'info' : 'success'}>
            سُجّل الجرد {result.number}. الفرق:{' '}
            <Money minor={result.diffValueMinor} currency={base} className="font-bold" />
          </Alert>
        ) : null}
        {counting ? (
          <Card>
            <CardHeader
              icon={<BarcodeIcon />}
              title="العدّ بالمسح"
              description="امسح كل قطعة على الرف بقارئ الباركود فتُعدّ وحدها، أو اكتب ما عددته لكل صنف في الجدول. ما تتركه فارغاً لا يُغيَّر."
            />
            <form
              aria-label="العدّ بالمسح"
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void addScan();
              }}
            >
              <TextField
                label="امسح الباركود"
                dir="ltr"
                autoFocus
                autoComplete="off"
                value={scan}
                onChange={(e) => setScan(e.target.value.slice(0, 40))}
                className="w-full sm:w-72"
                inputClassName="num"
                startAdornment={<BarcodeIcon className="ms-3" />}
              />
              {scanned ? (
                <p
                  role="status"
                  className={cn(
                    'flex items-center gap-2 rounded-control bg-success-soft px-3 font-semibold text-success-ink',
                    CONTROL_HEIGHT[density],
                  )}
                >
                  <CheckCircleIcon />
                  {scanned.name}: <bdi className="num">{counts[scanned.variantId] ?? ''}</bdi>
                </p>
              ) : null}
              {scanError ? (
                <p
                  className={cn(
                    'flex items-center gap-2 font-semibold text-danger-ink',
                    CONTROL_HEIGHT[density],
                  )}
                >
                  <AlertCircleIcon />
                  {scanError}
                </p>
              ) : null}
            </form>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              الأصناف المعدودة حتى الآن
              <Badge tone={counted ? 'brand' : 'neutral'}>
                <bdi className="num">{counted}</bdi>
              </Badge>
            </p>
          </Card>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatTile
            label="قيمة المخزون بالكلفة"
            value={
              stock ? (
                <Money minor={stock.totalValueMinor} currency={base} />
              ) : (
                <Skeleton className="h-9 w-36" />
              )
            }
            footnote="بمتوسط كلفة كل صنف"
          />
          <StatTile
            label="الكمية على الرفوف"
            value={stock ? formatQuantity(onShelf, digits) : <Skeleton className="h-9 w-20" />}
            footnote={
              stock ? (
                <>
                  عدد الأصناف: <span className="num">{kinds}</span>
                </>
              ) : undefined
            }
          />
          <StatTile
            label="نفد من الرف"
            value={stock ? soldOut : <Skeleton className="h-9 w-12" />}
            footnote={
              stock ? (soldOut ? 'أصناف بلا قطع، معلَّمة في الجدول' : 'في كل صنف قطع على الرف') : undefined
            }
          />
        </div>
        {profit || showWaste ? (
          <div
            className={cn(
              'grid grid-cols-1 gap-6',
              profit && showWaste && 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]',
            )}
          >
            {profit ? (
              <Card>
                <CardHeader
                  icon={<ReportsIcon />}
                  title="ربح هذا الشهر"
                  description="من الدفاتر، من أول الشهر حتى اليوم."
                />
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Figure term="صافي المبيعات هذا الشهر">
                    <Money minor={profit.netSalesMinor} currency={base} />
                  </Figure>
                  <Figure term="كلفة المبيعات">
                    <Money minor={profit.costOfSalesMinor} currency={base} />
                  </Figure>
                  <Figure term="مجمل الربح">
                    <Money minor={profit.grossProfitMinor} currency={base} className="text-brand-ink" />
                  </Figure>
                </dl>
                {margin !== null ? (
                  <div className="mt-5 flex flex-col gap-2">
                    <ProgressBar
                      label="هامش الربح من صافي المبيعات"
                      value={Math.max(0, margin)}
                      valueText={`${displayNumber(margin.toFixed(1), digits)}%`}
                    />
                    <p className="text-sm text-ink-muted">
                      هامش{' '}
                      <bdi className="num font-semibold text-ink">
                        {displayNumber(margin.toFixed(1), digits)}%
                      </bdi>{' '}
                      من صافي المبيعات
                      {profit.stockLossMinor ? (
                        <>
                          {' · '}تلف وفقد: <Money minor={profit.stockLossMinor} currency={base} />
                        </>
                      ) : null}
                    </p>
                  </div>
                ) : profit.stockLossMinor ? (
                  <p className="mt-4 text-sm text-ink-muted">
                    تلف وفقد: <Money minor={profit.stockLossMinor} currency={base} />
                  </p>
                ) : null}
              </Card>
            ) : null}
            {showWaste ? (
              <Card>
                <CardHeader
                  icon={<DeleteIcon />}
                  title="سجّل هدراً"
                  description="ما تلف يخرج من المخزون بكلفته، ويظهر في «تلف وفقد»."
                />
                <form
                  aria-label="سجّل هدراً"
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveWaste();
                  }}
                >
                  <Select label="الصنف التالف" value={wasteKey} onChange={(e) => setWasteKey(e.target.value)}>
                    <option value="">اختر الصنف</option>
                    {(stock?.items ?? []).map((r) => (
                      <option key={`${r.branchId}:${r.variantId}`} value={`${r.branchId}:${r.variantId}`}>
                        {manyBranches ? `${r.name} · ${branchName(r.branchId)}` : r.name}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-end gap-3">
                    <TextField
                      label="كمية الهدر"
                      inputMode="decimal"
                      dir="ltr"
                      value={wasteQty}
                      onChange={(e) => setWasteQty(e.target.value)}
                      className="min-w-0 flex-1"
                      inputClassName="num"
                    />
                    <Button type="submit" variant="secondary" loading={saving}>
                      سجّل الهدر
                    </Button>
                  </div>
                </form>
              </Card>
            ) : null}
          </div>
        ) : null}
        <section aria-label="الأصناف في المخزون" className="flex flex-col gap-3">
          <SectionHead
            title="الأصناف"
            description={counting ? 'اكتب في «المعدود» ما عددته على الرف.' : 'الكمية والقيمة بكلفة الشراء.'}
          >
            <SearchField
              label="ابحث عن صنف"
              value={query}
              onValueChange={setQuery}
              className="w-full sm:w-64"
            />
            {manyBranches ? (
              <Select
                label="الفرع"
                hideLabel
                value={branchShown}
                onChange={(e) => setBranchShown(e.target.value)}
                className="w-full sm:w-44"
              >
                <option value="">كل الفروع</option>
                {me.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </SectionHead>
          <DataTable
            caption="المخزون"
            columns={columns}
            rows={shown}
            rowKey={(r) => `${r.branchId}:${r.variantId}`}
            loading={!stock && !error}
            empty={
              items.length > 0 ? (
                <EmptyState
                  icon={StockIcon}
                  title="لا صنف يطابق البحث."
                  description="جرّب اسماً آخر أو فرعاً آخر."
                />
              ) : (
                <EmptyState
                  icon={StockIcon}
                  title="لا مخزون بعد."
                  description="سجّل فاتورة شراء فيدخل المخزون بكلفته."
                />
              )
            }
          />
        </section>
      </div>
    </AppShell>
  );
}

/** One figure of the month's profit: its name, then the amount. */
function Figure({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="text-xl font-bold text-ink">{children}</dd>
    </div>
  );
}
