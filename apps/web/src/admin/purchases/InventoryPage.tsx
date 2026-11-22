import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type {
  InventoryResponse,
  InventoryRow,
  ProfitReport,
  StocktakeDetail,
  StocktakeListRow,
} from '@serva/core';
import { Alert, BarcodeIcon, Button, DeleteIcon, ListIcon, SegmentedControl, useDigits } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { useIsPhone } from '../../lib/useIsPhone';
import { countStock } from '../../lib/stockCounts';
import { downloadCsv } from '../exportCsv';
import { ReportScreen } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { seesSerialAttention } from '../../pages/SerialAttention';
import { Amt, PageTop, SalesPage } from '../sales/ui';
import {
  createStocktake,
  getInventory,
  getSerialDrift,
  getProfit,
  listStocktakes,
  newDocumentId,
  qtyOf,
  storeToday,
} from './api';
import { InventoryCounting } from './InventoryCounting';
import { InventoryFilters } from './InventoryFilters';
import { InventoryGrid } from './InventoryGrid';
import { InventoryHero } from './InventoryHero';
import { InventoryList } from './InventoryList';
import { InventoryPast } from './InventoryPast';
import { InventoryReview } from './InventoryReview';
import { InventoryWasteDialog } from './InventoryWasteDialog';
import { belowReorder, safeCell, type Sort, type StockFilter } from './inventoryShared';
import { countProblem, reviewCount } from './stocktakeReview';
import { useInventoryScan } from './useInventoryScan';
import { useInventoryWaste } from './useInventoryWaste';
import './inventory.css';

/**
 * «المخزون والأرباح» (10 › الكلفة والربح): what each item's stock is worth at its average cost, the
 * month's gross profit from the books, and a count of the shelves that posts what is missing or
 * over.
 *
 * Round 44: the count is of ONE branch (chosen first, its rows only, its id on the post), the list names every
 * branch it shows (vans too), the headline is the net stock with the negatives said beside it, an item with no
 * cost is shown as a gap and not as a zero, the list pages and sorts, and a write-off counts from the moment the
 * list was read (what sold meanwhile is not brought back).
 */
export function InventoryPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const canCount = me.user.permissions.includes('inventory.adjust');
  const canProfit = me.user.permissions.includes('reports.financial');
  const timeZone = me.tenant.timezone;
  const [stock, setStock] = useState<InventoryResponse | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  // The branch being counted and the id the count posts under (made once: a retried post counts once)
  const [countBranch, setCountBranch] = useState('');
  const [countId, setCountId] = useState(newDocumentId);
  const [result, setResult] = useState<StocktakeDetail | null>(null);
  // Which serial numbers left, for a tracked product that came up short (round 60): by item, in a count
  const [countSerials, setCountSerials] = useState<Record<string, string[]>>({});
  // The page shows the stock, or the counts already made (a tab of its own, so the list is not a very long page)
  const [part, setPart] = useState<'stock' | 'counts'>('stock');
  const [saving, setSaving] = useState(false);
  // The count is looked over (counted, expected, difference) before it is recorded
  const [reviewing, setReviewing] = useState(false);
  // What the table shows: a search by name, one branch, a filter and an order
  const [query, setQuery] = useState('');
  const [branchShown, setBranchShown] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<Sort>('name');
  // The list, or the models with sizes and colours laid out as grids
  // A clothing store thinks in sizes and colours: its grids come first
  const [view, setView] = useState<'list' | 'grid'>(me.tenant.sectors.includes('clothing') ? 'grid' : 'list');
  // The counts already made («الجرد السابق»): who counted, where, and what the difference cost
  const [past, setPast] = useState<StocktakeListRow[] | null>(null);
  const [pastNext, setPastNext] = useState<string | null>(null);
  const [pastError, setPastError] = useState<string | null>(null);
  // «?count=id,id» (the home page's «ناقص» chips): the count opens on these items only
  const [params] = useSearchParams();
  const [only, setOnly] = useState<ReadonlySet<string> | null>(() => {
    const ids = (params.get('count') ?? '').split(',').filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  });

  const load = useCallback(() => {
    setError(null);
    getInventory()
      .then(setStock)
      .catch((e: unknown) => setError(errorMessage(e)));
    if (canProfit) {
      const today = storeToday(timeZone);
      getProfit(`${today.slice(0, 8)}01`, today)
        .then(setProfit)
        .catch(() => setProfit(null));
    }
  }, [canProfit, timeZone]);
  useEffect(load, [load]);
  const loadPast = useCallback(
    (cursor: string | null) => {
      if (!canCount) return;
      setPastError(null);
      listStocktakes(cursor)
        .then((r) => {
          setPast((was) => (cursor ? [...(was ?? []), ...r.items] : r.items));
          setPastNext(r.nextCursor);
        })
        .catch((e: unknown) => setPastError(errorMessage(e)));
    },
    [canCount],
  );
  useEffect(() => loadPast(null), [loadPast]);

  const base = stock?.baseCurrency ?? me.settings.baseCurrency;
  const items = useMemo(() => stock?.items ?? [], [stock]);
  // Products whose serial numbers do not match their stock wear a mark on their own row
  const drift = useReport(seesSerialAttention(me) ? 'stock:serial-drift' : null, getSerialDrift);
  const driftIds = useMemo(() => new Set((drift.data?.items ?? []).map((d) => d.variantId)), [drift.data]);
  // The branches the list really has (a van, a branch the account no longer lists), named by the server
  const branchList = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; kind: string }>();
    for (const r of items) {
      if (seen.has(r.branchId)) continue;
      const known = me.branches.find((b) => b.id === r.branchId);
      seen.set(r.branchId, {
        id: r.branchId,
        name: r.branchName ?? known?.name ?? '',
        kind: r.branchKind ?? 'store',
      });
    }
    return [...seen.values()];
  }, [items, me.branches]);
  const manyBranches = branchList.length > 1;
  const branchLabel = (r: Pick<InventoryRow, 'branchId' | 'branchName' | 'branchKind'>) => {
    const name = r.branchName ?? me.branches.find((b) => b.id === r.branchId)?.name ?? '';
    return r.branchKind === 'van' ? `${name} (مندوب)` : name;
  };
  // The branch a count is made in: the main one first (the first code), as the other lists order them
  const firstBranch = useMemo(() => {
    const ranked = [...branchList].sort((a, b) => {
      const code = (id: string) => me.branches.find((x) => x.id === id)?.code ?? '~';
      return code(a.id).localeCompare(code(b.id), 'en', { numeric: true });
    });
    return ranked[0]?.id ?? '';
  }, [branchList, me.branches]);

  // The page opened with items to count: the count starts once, as soon as the list is in
  const opensCounting = useRef(Boolean(only));

  function startCounting(branch?: string) {
    setCounts({});
    setCountSerials({});
    setReviewing(false);
    setPart('stock');
    setCountId(newDocumentId());
    setCountBranch(branch ?? (branchShown || firstBranch));
    setCounting(true);
    setView('list');
  }
  useEffect(() => {
    if (opensCounting.current && canCount && stock) {
      opensCounting.current = false;
      startCounting();
    }
    // once, when the page opens with the items to count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock]);

  // The stock numbers: the one definition of the products and home pages, plus the net the shelves really hold
  const clothing = me.tenant.sectors.includes('clothing');
  const { kinds, soldOut, soldOutProducts, negative: belowZero } = countStock(items);
  const netPieces = items.reduce((sum, r) => sum + r.qty, 0);
  const noCost = items.filter((r) => r.qty > 0 && (r.unitCostMinor === null || r.unitCostMinor === 0));
  const noCostKinds = new Set(noCost.map((r) => r.variantId)).size;
  const reorderKinds = new Set(items.filter(belowReorder).map((r) => r.variantId)).size;
  const deadPieces = items.reduce(
    (sum, r) => sum + (r.qty > 0 ? Math.max(0, r.qty - (r.sellableQty ?? r.qty)) : 0),
    0,
  );

  // The rows of the branch being counted: one typed number is one branch's, never copied into another's
  const countItems = useMemo(() => items.filter((r) => r.branchId === countBranch), [items, countBranch]);
  const countedNumber = Object.entries(counts).filter(
    ([id, text]) => qtyOf(text) !== null && countItems.some((r) => r.variantId === id),
  ).length;
  const countProblems = Object.values(counts).some((text) => countProblem(text) !== null);
  const review = reviewing ? reviewCount(countItems, counts) : [];
  const reviewTotal = review.reduce((sum, l) => sum + l.diffValueMinor, 0);
  // A tracked product that came up short must say which numbers left (one per missing piece)
  const needSerials = review.filter(
    (l) => l.diffQty < 0 && countItems.find((r) => r.variantId === l.variantId)?.tracksSerial,
  );
  // Round 62: a surplus of a tracked product needs its numbers too (the stock goes up, so the serial list must)
  const needNew = review.filter(
    (l) => l.diffQty > 0 && countItems.find((r) => r.variantId === l.variantId)?.tracksSerial,
  );
  const serialsMissing =
    needSerials.some((l) => (countSerials[l.variantId] ?? []).length !== Math.ceil(-l.diffQty / 1000)) ||
    needNew.some((l) => (countSerials[l.variantId] ?? []).length !== Math.ceil(l.diffQty / 1000));
  const reviewShort = review.reduce((sum, l) => sum + Math.max(0, -l.diffValueMinor), 0);
  const reviewOver = review.reduce((sum, l) => sum + Math.max(0, l.diffValueMinor), 0);

  const needle = query.trim();
  const shown = useMemo(() => {
    const base0 = counting ? countItems : items;
    const list = base0.filter(
      (r) =>
        (counting || !branchShown || r.branchId === branchShown) &&
        (!needle || r.name.includes(needle)) &&
        (!only || only.has(r.variantId)) &&
        (counting ||
          filter === 'all' ||
          (filter === 'low'
            ? r.qty <= 0
            : filter === 'reorder'
              ? belowReorder(r)
              : r.qty > 0 && (r.unitCostMinor === null || r.unitCostMinor === 0))),
    );
    if (counting || sort === 'name') return list;
    return [...list].sort((a, b) => (sort === 'value' ? b.valueMinor - a.valueMinor : a.qty - b.qty));
  }, [items, countItems, counting, branchShown, needle, only, filter, sort]);

  function exportStock() {
    downloadCsv(
      `المخزون-${storeToday(timeZone)}`,
      ['الصنف', ...(manyBranches ? ['الفرع'] : []), 'الكمية', 'كلفة الوحدة', 'القيمة'],
      shown.map((r) => [
        safeCell(r.name),
        ...(manyBranches ? [safeCell(branchLabel(r))] : []),
        r.qty / 1000,
        r.unitCostMinor === null ? '' : Math.round(r.unitCostMinor) / 100,
        r.valueMinor / 100,
      ]),
    );
  }

  const scanning = useInventoryScan(items, countItems, setCounts);

  async function saveCount() {
    const lines = Object.entries(counts)
      .filter(([variantId]) => countItems.some((r) => r.variantId === variantId))
      .map(([variantId, text]) => ({
        variantId,
        countedQty: qtyOf(text),
        ...((countSerials[variantId]?.length ?? 0) > 0 ? { serials: countSerials[variantId] } : {}),
      }))
      .filter(
        (l): l is { variantId: string; countedQty: number; serials?: string[] } => l.countedQty !== null,
      );
    if (lines.length === 0) return;
    setSaving(true);
    try {
      setResult(
        await createStocktake({
          id: countId,
          ...(countBranch ? { branchId: countBranch } : {}),
          date: storeToday(timeZone),
          note: null,
          lines,
        }),
      );
      setCounting(false);
      setReviewing(false);
      setCounts({});
      setCountSerials({});
      setOnly(null);
      load();
      loadPast(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const waste = useInventoryWaste({
    items,
    stock,
    branchList,
    firstBranch,
    digits,
    timeZone,
    setSaving,
    setError,
    setResult,
    load,
    loadPast,
  });
  const showWaste = canCount && !counting && items.length > 0;

  const showList = (next: StockFilter) => {
    setFilter(next);
    setView('list');
  };

  return (
    <ReportScreen me={me} access={['cost.view']} title="المخزون والأرباح">
      <SalesPage>
        <PageTop
          title="المخزون والأرباح"
          subtitle={
            counting
              ? 'جرد الرفوف: امسح القطع أو اكتب ما عددته، ثم سجّل الجرد.'
              : 'ما على رفوفك بكلفته، وربح هذا الشهر من الدفاتر.'
          }
          actions={
            counting ? null : (
              <>
                {showWaste ? (
                  <Button variant="secondary" icon={<DeleteIcon />} onClick={waste.openWaste}>
                    سجّل هدراً
                  </Button>
                ) : null}
                {canCount ? (
                  <Link to="/inventory/count" className="inline-flex">
                    <Button variant="secondary" icon={<BarcodeIcon />} tabIndex={-1}>
                      جرد بالهاتف
                    </Button>
                  </Link>
                ) : null}
                {canCount ? (
                  <Button icon={<ListIcon />} onClick={() => startCounting()}>
                    جرد الرفوف
                  </Button>
                ) : null}
              </>
            )
          }
        />
        {error ? (
          <Alert tone="error">
            <span className="flex flex-wrap items-center gap-3">
              {error}
              <Button variant="secondary" size="sm" onClick={load}>
                حاول مرة أخرى
              </Button>
            </span>
          </Alert>
        ) : null}
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
                <Amt minor={Math.abs(result.diffValueMinor)} currency={base} className="font-bold" />
              </>
            ) : null}
          </Alert>
        ) : null}
        {!counting && canCount && (past?.length ?? 0) > 0 ? (
          <SegmentedControl
            label="قسم الصفحة"
            value={part}
            onValueChange={setPart}
            options={[
              { value: 'stock', label: 'المخزون' },
              { value: 'counts', label: 'الجرد السابق' },
            ]}
          />
        ) : null}
        {counting ? (
          <InventoryCounting
            manyBranches={manyBranches}
            branchList={branchList}
            countBranch={countBranch}
            onCountBranch={setCountBranch}
            countedNumber={countedNumber}
            countedOfBranch={countItems.filter((r) => qtyOf(counts[r.variantId] ?? '') !== null).length}
            countTotal={countItems.length}
            counts={counts}
            scan={scanning.scan}
            onScan={scanning.setScan}
            scanned={scanning.scanned}
            scanError={scanning.scanError}
            onAddScan={() => void scanning.addScan()}
            reviewing={reviewing}
            setReviewing={setReviewing}
            saving={saving}
            serialsMissing={serialsMissing}
            countProblems={countProblems}
            onSave={() => void saveCount()}
            onCancel={() => {
              setCounting(false);
              setReviewing(false);
              setCounts({});
            }}
          />
        ) : null}
        {reviewing ? (
          <InventoryReview
            review={review}
            reviewShort={reviewShort}
            reviewOver={reviewOver}
            reviewTotal={reviewTotal}
            needSerials={needSerials}
            needNew={needNew}
            base={base}
            digits={digits}
            countBranch={countBranch}
            countSerials={countSerials}
            setCountSerials={setCountSerials}
          />
        ) : null}
        {!counting && part === 'stock' ? (
          <InventoryHero
            me={me}
            stock={stock}
            profit={profit}
            base={base}
            digits={digits}
            clothing={clothing}
            kinds={kinds}
            netPieces={netPieces}
            soldOut={soldOut}
            soldOutProducts={soldOutProducts}
            belowZero={belowZero}
            reorderKinds={reorderKinds}
            noCostKinds={noCostKinds}
            deadPieces={deadPieces}
            onShowList={showList}
          />
        ) : null}
        {part === 'stock' || counting ? (
          <section aria-label="الأصناف في المخزون" className="flex flex-col gap-3">
            <InventoryFilters
              counting={counting}
              query={query}
              onQuery={setQuery}
              hasOptions={items.some((r) => r.attributes && r.attributes.length > 0)}
              view={view}
              onView={setView}
              clothing={clothing}
              manyBranches={manyBranches}
              branchShown={branchShown}
              onBranch={setBranchShown}
              branchList={branchList}
              filter={filter}
              onFilter={setFilter}
              reorderKinds={reorderKinds}
              sort={sort}
              onSort={setSort}
              exportDisabled={shown.length === 0}
              onExport={exportStock}
            />
            {only ? (
              <p className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                <span>تعرض الصفحة الأصناف الناقصة فقط.</span>
                <Button variant="ghost" onClick={() => setOnly(null)}>
                  اعرض كل الأصناف
                </Button>
              </p>
            ) : null}
            {view === 'grid' && stock && !counting ? (
              <InventoryGrid
                rows={shown}
                numberFormat={digits}
                {...(canCount
                  ? {
                      onCount: (ids: string[]) => {
                        setOnly(new Set(ids));
                        startCounting();
                      },
                    }
                  : {})}
              />
            ) : (
              <InventoryList
                shown={shown}
                items={items}
                stock={stock}
                error={error}
                counting={counting}
                pagerKey={`${filter}|${needle}|${branchShown}|${sort}|${counting}|${countBranch}`}
                phone={phone}
                manyBranches={manyBranches}
                branchLabel={branchLabel}
                base={base}
                digits={digits}
                counts={counts}
                setCounts={setCounts}
                driftIds={driftIds}
              />
            )}
          </section>
        ) : null}
        {!counting && canCount && part === 'counts' && (past?.length ?? 0) > 0 ? (
          <InventoryPast
            past={past ?? []}
            pastNext={pastNext}
            pastError={pastError}
            phone={phone}
            base={base}
            loadPast={loadPast}
          />
        ) : null}
      </SalesPage>
      {showWaste ? (
        <InventoryWasteDialog
          w={waste}
          stock={stock}
          saving={saving}
          digits={digits}
          manyBranches={manyBranches}
          branchLabel={branchLabel}
        />
      ) : null}
    </ReportScreen>
  );
}
