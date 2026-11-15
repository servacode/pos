import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { InventoryResponse, InventoryRow, ProfitReport, StocktakeDetail } from '@serva/core';
import {
  AlertCircleIcon,
  Alert,
  Badge,
  BarcodeIcon,
  Button,
  Card,
  Dialog,
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
  SegmentedControl,
  Select,
  KpiStrip,
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
import { sortByOptions } from '../../lib/optionOrder';
import { lookupBarcode } from '../catalog/api';
import { createStocktake, getInventory, getProfit, qtyOf, today } from './api';
import { SectionHead } from './parts';
import { InventoryGrid } from './InventoryGrid';
import { downloadCsv } from '../exportCsv';
import { countProblem, differenceWord, reviewCount } from './stocktakeReview';

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
  // The count is looked over (counted, expected, difference) before it is recorded
  const [reviewing, setReviewing] = useState(false);
  // «سجّل هدراً» (03 › الخضار والمخابز: تسجيل الهدر): what spoiled, out of stock at its cost
  const [wasteKey, setWasteKey] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  // The picker narrows by typing (a store has hundreds of pieces); the write-off is confirmed first
  const [wasteQuery, setWasteQuery] = useState('');
  const [wasteAsk, setWasteAsk] = useState(false);
  // What went wrong with the waste: told inside its window, not behind it
  const [wasteError, setWasteError] = useState<string | null>(null);
  // Counting by scanning (03 › الألبسة: الجرد بالمسح): each scan adds one piece (or its pack)
  const [scan, setScan] = useState('');
  const [scanned, setScanned] = useState<{ variantId: string; name: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  // What the table shows: a search by name and, with branches, one branch
  const [query, setQuery] = useState('');
  const [branchShown, setBranchShown] = useState('');
  // The list, or the models with sizes and colours laid out as grids
  // A clothing store thinks in sizes and colours: its grids come first
  const [view, setView] = useState<'list' | 'grid'>(me.tenant.sectors.includes('clothing') ? 'grid' : 'list');
  // «سجّل هدراً» opens from a button, in a window of its own
  const [wasteOpen, setWasteOpen] = useState(false);
  // «?count=id,id» (the home page's «ناقص» chips): the count opens on these items only
  const [params] = useSearchParams();
  const [only, setOnly] = useState<ReadonlySet<string> | null>(() => {
    const ids = (params.get('count') ?? '').split(',').filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  });
  useEffect(() => {
    if (only && canCount) {
      setCounting(true);
      setView('list');
    }
    // once, when the page opens with the items to count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // The same count as the products page (one definition): per combination over all branches, a
  // combination below zero is not a piece, it is counted apart as «ناقص»; «نفد» is zero or less
  const perKind = new Map<string, number>();
  for (const r of items) perKind.set(r.variantId, (perKind.get(r.variantId) ?? 0) + r.qty);
  const totals = [...perKind.values()];
  const onShelf = totals.reduce((sum, q) => sum + Math.max(0, q), 0);
  const belowZero = totals.filter((q) => q < 0).length;
  const kinds = totals.length;
  const soldOut = totals.filter((q) => q <= 0).length;
  const counted = Object.values(counts).filter((text) => qtyOf(text) !== null).length;
  const countProblems = Object.values(counts).some((text) => countProblem(text) !== null);
  const review = reviewing ? reviewCount(items, counts) : [];
  const reviewTotal = review.reduce((sum, l) => sum + l.diffValueMinor, 0);
  const needle = query.trim();
  const shown = items.filter(
    (r) =>
      (!branchShown || r.branchId === branchShown) &&
      (!needle || r.name.includes(needle)) &&
      (!only || only.has(r.variantId)),
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
          {r.qty < 0 ? (
            <Badge tone="danger">سالب</Badge>
          ) : r.qty === 0 ? (
            <Badge tone="danger">نفد</Badge>
          ) : null}
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
                error={countProblem(counts[r.variantId] ?? '') ?? undefined}
                className="relative w-28"
                inputClassName="num"
              />
            ),
          },
        ]
      : []),
  ];

  const reviewColumns: DataColumn<ReturnType<typeof reviewCount>[number]>[] = [
    { key: 'name', header: 'الصنف', cell: (l) => <span className="font-semibold text-ink">{l.name}</span> },
    {
      key: 'counted',
      header: 'المعدود',
      numeric: true,
      cell: (l) => <bdi className="num">{formatQuantity(l.countedQty, digits)}</bdi>,
    },
    {
      key: 'expected',
      header: 'المتوقع',
      numeric: true,
      cell: (l) => <bdi className="num">{formatQuantity(l.expectedQty, digits)}</bdi>,
    },
    {
      key: 'diff',
      header: 'الفرق',
      numeric: true,
      cell: (l) => (
        <span className="inline-flex items-center gap-2">
          <Badge tone={l.diffQty < 0 ? 'danger' : l.diffQty > 0 ? 'success' : 'neutral'}>
            {differenceWord(l.diffQty)}
          </Badge>
          <bdi dir="ltr" className="num">
            {formatQuantity(Math.abs(l.diffQty), digits)}
          </bdi>
        </span>
      ),
    },
    {
      key: 'value',
      header: 'قيمة الفرق',
      numeric: true,
      cell: (l) => <Money minor={Math.abs(l.diffValueMinor)} currency={base} className="font-semibold" />,
    },
  ];

  function exportStock() {
    downloadCsv(
      `المخزون-${today()}`,
      ['الصنف', ...(manyBranches ? ['الفرع'] : []), 'الكمية', 'كلفة الوحدة', 'القيمة'],
      shown.map((r) => [
        r.name,
        ...(manyBranches ? [branchName(r.branchId)] : []),
        r.qty / 1000,
        r.unitCostMinor === null ? '' : Math.round(r.unitCostMinor) / 100,
        r.valueMinor / 100,
      ]),
    );
  }

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
      setReviewing(false);
      setCounts({});
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const wasteRow = stock?.items.find((r) => `${r.branchId}:${r.variantId}` === wasteKey);
  const wasteOptions = sortByOptions(stock?.items ?? []).filter((r) => {
    const typed = wasteQuery.trim().toLowerCase();
    return !typed || `${r.branchId}:${r.variantId}` === wasteKey || r.name.toLowerCase().includes(typed);
  });

  /** What is wrong with the typed waste, or null: nothing leaves that is not on the shelf */
  function wasteProblem(): string | null {
    const qty = qtyOf(wasteQty);
    if (!wasteRow || !qty || qty <= 0) return 'اختر الصنف واكتب كمية الهدر.';
    if (wasteRow.qty <= 0) return 'لا مخزون لهذا الصنف ليخرج منه هدر.';
    // A piece item is counted in whole pieces; only a weighed one takes a fraction
    if (wasteRow.allowsFraction === false && qty % 1000 !== 0) {
      return 'هذا الصنف يُعدّ بالقطعة: اكتب عدداً صحيحاً.';
    }
    if (qty > wasteRow.qty) {
      return `الموجود من هذا الصنف ${formatQuantity(wasteRow.qty, digits)} فقط. اكتب كمية أقل.`;
    }
    return null;
  }

  function askWaste() {
    const problem = wasteProblem();
    setWasteError(problem);
    if (problem) {
      setWasteAsk(false);
      return;
    }
    setWasteAsk(true);
  }

  async function saveWaste() {
    const row = wasteRow;
    const qty = qtyOf(wasteQty);
    setWasteAsk(false);
    const problem = wasteProblem();
    if (problem || !row || !qty) {
      setWasteError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    setWasteError(null);
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
      setWasteQuery('');
      setWasteOpen(false);
      load();
    } catch (e) {
      setWasteError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const showWaste = canCount && !counting && (stock?.items.length ?? 0) > 0;
  const margin =
    profit && profit.netSalesMinor > 0 ? (profit.grossProfitMinor / profit.netSalesMinor) * 100 : null;

  return (
    <AppShell>
      <title>المخزون والأرباح · SERFA</title>
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
              {showWaste ? (
                <Button
                  variant="secondary"
                  icon={<DeleteIcon />}
                  onClick={() => {
                    setWasteError(null);
                    setWasteOpen(true);
                  }}
                >
                  سجّل هدراً
                </Button>
              ) : null}
              {canCount && !counting ? (
                <Button icon={<ListIcon />} onClick={() => setCounting(true)}>
                  جرد الرفوف
                </Button>
              ) : null}
              {counting ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCounting(false);
                      setReviewing(false);
                    }}
                  >
                    إلغاء
                  </Button>
                  {reviewing ? (
                    <>
                      <Button variant="secondary" onClick={() => setReviewing(false)}>
                        ارجع للتعديل
                      </Button>
                      <Button icon={<ListIcon />} onClick={() => void saveCount()} loading={saving}>
                        سجّل الجرد
                      </Button>
                    </>
                  ) : (
                    <Button
                      icon={<ListIcon />}
                      disabled={counted === 0 || countProblems}
                      onClick={() => setReviewing(true)}
                    >
                      راجع الجرد
                    </Button>
                  )}
                </>
              ) : null}
            </>
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {result ? (
          <Alert tone={result.diffValueMinor < 0 ? 'info' : 'success'}>
            سُجّل الجرد {result.number}.{' '}
            {result.diffValueMinor < 0
              ? 'نقص بقيمة'
              : result.diffValueMinor > 0
                ? 'زيادة بقيمة'
                : 'الجرد مطابق'}
            {result.diffValueMinor !== 0 ? (
              <>
                {' '}
                <Money minor={Math.abs(result.diffValueMinor)} currency={base} className="font-bold" />
              </>
            ) : null}
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
        {reviewing ? (
          <Card>
            <CardHeader
              icon={<ListIcon />}
              title="راجع الجرد قبل التسجيل"
              description="ما عددته مقابل ما يتوقعه النظام. الزيادة تدخل المخزون والنقص يخرج منه بكلفته."
            />
            <DataTable
              caption="فروق الجرد"
              columns={reviewColumns}
              rows={review}
              rowKey={(l) => l.variantId}
              empty={<EmptyState icon={StockIcon} title="لم تعدّ أي صنف." />}
            />
            <p className="mt-4 text-sm text-ink-muted">
              {reviewTotal < 0 ? 'مجموع النقص: ' : reviewTotal > 0 ? 'مجموع الزيادة: ' : 'لا فرق في القيمة. '}
              {reviewTotal !== 0 ? (
                <Money minor={Math.abs(reviewTotal)} currency={base} className="font-bold" />
              ) : null}
            </p>
          </Card>
        ) : null}
        <KpiStrip columns={3}>
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
            label="القطع في المخزون"
            value={stock ? formatQuantity(onShelf, digits) : <Skeleton className="h-9 w-20" />}
            footnote={
              stock ? (
                <>
                  عدد الأصناف: <span className="num">{kinds}</span>
                  {belowZero > 0 ? (
                    <>
                      {' '}
                      · منها ناقص: <span className="num">{belowZero}</span>
                    </>
                  ) : null}
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
        </KpiStrip>
        {profit ? (
          <div className="grid grid-cols-1 gap-6">
            {profit ? (
              <Card>
                <CardHeader
                  icon={<ReportsIcon />}
                  title="ربح هذا الشهر"
                  description="من الدفاتر، من أول الشهر حتى اليوم، بعد المرتجع وبدون الضريبة."
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
                          {' · '}
                          {profit.stockLossMinor > 0 ? 'تلف وفقد' : 'زيادة جرد'}:{' '}
                          <Money minor={Math.abs(profit.stockLossMinor)} currency={base} />
                        </>
                      ) : null}
                    </p>
                  </div>
                ) : profit.stockLossMinor ? (
                  <p className="mt-4 text-sm text-ink-muted">
                    {profit.stockLossMinor > 0 ? 'تلف وفقد' : 'زيادة جرد'}:{' '}
                    <Money minor={Math.abs(profit.stockLossMinor)} currency={base} />
                  </p>
                ) : null}
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
            {/* The grid only means something when a product has options; «المقاس واللون» is a clothing store's words */}
            {items.some((r) => r.attributes && r.attributes.length > 0) ? (
              <SegmentedControl
                label="طريقة العرض"
                value={view}
                onValueChange={setView}
                options={[
                  { value: 'list', label: 'قائمة' },
                  {
                    value: 'grid',
                    label: me.tenant.sectors.includes('clothing') ? 'شبكة المقاس واللون' : 'شبكة الخيارات',
                  },
                ]}
              />
            ) : null}
            <Button variant="secondary" disabled={shown.length === 0} onClick={exportStock}>
              صدّر إلى إكسل
            </Button>
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
          {only ? (
            <p className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <span>تعرض الصفحة الأصناف الناقصة فقط.</span>
              <Button variant="ghost" onClick={() => setOnly(null)}>
                اعرض كل الأصناف
              </Button>
            </p>
          ) : null}
          {view === 'grid' && stock ? (
            <InventoryGrid
              rows={shown}
              numberFormat={digits}
              {...(canCount
                ? {
                    onCount: (ids: string[]) => {
                      setOnly(new Set(ids));
                      setCounting(true);
                      setView('list');
                    },
                  }
                : {})}
            />
          ) : (
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
          )}
        </section>
      </div>
      {showWaste ? (
        <Dialog
          open={wasteOpen}
          onOpenChange={(open) => !open && !saving && setWasteOpen(false)}
          size="md"
          title="سجّل هدراً"
          description="ما تلف يخرج من المخزون بكلفته، ويظهر في «تلف وفقد»."
        >
          <form
            aria-label="سجّل هدراً"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              askWaste();
            }}
          >
            <SearchField
              label="ابحث عن الصنف التالف"
              value={wasteQuery}
              onValueChange={(v) => {
                setWasteQuery(v);
                setWasteAsk(false);
                setWasteError(null);
              }}
            />
            <Select
              label="الصنف التالف"
              value={wasteKey}
              onChange={(e) => {
                setWasteKey(e.target.value);
                setWasteAsk(false);
                setWasteError(null);
              }}
            >
              <option value="">اختر الصنف</option>
              {wasteOptions.map((r) => (
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
                onChange={(e) => {
                  setWasteQty(e.target.value);
                  setWasteAsk(false);
                  setWasteError(null);
                }}
                className="min-w-0 flex-1"
                inputClassName="num"
              />
              <Button type="submit" variant="secondary" loading={saving}>
                سجّل الهدر
              </Button>
            </div>
            {wasteRow && wasteRow.qty > 0 ? (
              <p className="text-sm text-ink-muted">
                الموجود من «{wasteRow.name}»:{' '}
                <bdi className="num font-semibold">{formatQuantity(wasteRow.qty, digits)}</bdi>
              </p>
            ) : null}
            {wasteError ? <Alert tone="error">{wasteError}</Alert> : null}
            {wasteAsk && wasteRow ? (
              <Alert tone="warning">
                <div className="flex flex-col gap-3">
                  <span>
                    سيخرج <bdi className="num font-semibold">{wasteQty}</bdi> من «{wasteRow.name}» من المخزون
                    بكلفته. هذا لا يُسترجع من هنا.
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={saving} onClick={() => void saveWaste()}>
                      أكّد الهدر
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setWasteAsk(false)}>
                      رجوع
                    </Button>
                  </div>
                </div>
              </Alert>
            ) : null}
          </form>
        </Dialog>
      ) : null}
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
