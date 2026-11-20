import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  wasteReasonsOf,
  type InventoryResponse,
  type InventoryRow,
  type ProfitReport,
  type StocktakeDetail,
  type StocktakeListRow,
} from '@serva/core';
import {
  Alert,
  AlertCircleIcon,
  BarcodeIcon,
  Button,
  CheckCircleIcon,
  Dialog,
  DeleteIcon,
  displayNumber,
  formatQuantity,
  ListIcon,
  SearchField,
  SegmentedControl,
  Select,
  StockIcon,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { sortByOptions } from '../../lib/optionOrder';
import { useIsPhone } from '../../lib/useIsPhone';
import { countStock, negativeNote } from '../../lib/stockCounts';
import { lookupBarcode } from '../catalog/api';
import { downloadCsv } from '../exportCsv';
import { Paged } from '../pager';
import { ReportScreen } from '../reports/parts';
import {
  Amt,
  DownloadGlyph,
  PageTop,
  Panel,
  SalesPage,
  StatusPill,
  SxTable,
  type SxColumn,
} from '../sales/ui';
import { soldOutLabel, soldOutSentence, StockDefinitions } from '../stockWords';
import {
  createStocktake,
  getInventory,
  getProfit,
  listStocktakes,
  newDocumentId,
  qtyOf,
  storeToday,
} from './api';
import { InventoryGrid } from './InventoryGrid';
import { countProblem, differenceWord, reviewCount } from './stocktakeReview';
import './inventory.css';

/** A name that starts with = + - @ would be read by Excel as a formula: a quote in front keeps it text */
const safeCell = (text: string) => (/^[=+\-@]/.test(text) ? `'${text}` : text);

type StockFilter = 'all' | 'low' | 'nocost';
type Sort = 'name' | 'value' | 'qty';

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
  const [saving, setSaving] = useState(false);
  // The count is looked over (counted, expected, difference) before it is recorded
  const [reviewing, setReviewing] = useState(false);
  // «سجّل هدراً» (03 › الخضار والمخابز: تسجيل الهدر): what spoiled, out of stock at its cost
  const [wasteKey, setWasteKey] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  // Why it was thrown away (round 38): the store's reasons, kept on the count's line for the waste report
  const [wasteWhy, setWasteWhy] = useState('');
  // The picker narrows by typing (a store has hundreds of pieces); the write-off is confirmed first
  const [wasteQuery, setWasteQuery] = useState('');
  const [wasteAsk, setWasteAsk] = useState(false);
  const [wasteId, setWasteId] = useState(newDocumentId);
  // What went wrong with the waste: told inside its window, not behind it
  const [wasteError, setWasteError] = useState<string | null>(null);
  // Counting by scanning (03 › الألبسة: الجرد بالمسح): each scan adds one piece (or its pack)
  const [scan, setScan] = useState('');
  const [scanned, setScanned] = useState<{ variantId: string; name: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
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
  // «سجّل هدراً» opens from a button, in a window of its own
  const [wasteOpen, setWasteOpen] = useState(false);
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
    setReviewing(false);
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
          (filter === 'low' ? r.qty <= 0 : r.qty > 0 && (r.unitCostMinor === null || r.unitCostMinor === 0))),
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

  async function addScan() {
    const code = scan.trim();
    setScan('');
    if (!code) return;
    setScanError(null);
    try {
      const hit = await lookupBarcode(code);
      const row = countItems.find((r) => r.variantId === hit.variantId);
      if (!row) {
        const elsewhere = items.some((r) => r.variantId === hit.variantId);
        setScanned(null);
        setScanError(
          elsewhere
            ? `«${code}» ليس في مخزون هذا الفرع. اختر فرعه من الجرد أولاً.`
            : `لا صنف بالباركود ${code}.`,
        );
        return;
      }
      setCounts((c) => ({
        ...c,
        [hit.variantId]: String(((qtyOf(c[hit.variantId] ?? '') ?? 0) + hit.barcode.packQty) / 1000),
      }));
      setScanned({ variantId: hit.variantId, name: row.name });
      // The counted row comes into view and flashes once
      requestAnimationFrame(() => {
        const el = document.getElementById(`ix-row-${hit.variantId}`);
        el?.scrollIntoView?.({ block: 'center' });
        el?.classList.remove('ix-flash');
        void el?.offsetWidth;
        el?.classList.add('ix-flash');
      });
    } catch {
      setScanned(null);
      setScanError(`لا صنف بالباركود ${code}.`);
    }
  }

  async function saveCount() {
    const lines = Object.entries(counts)
      .filter(([variantId]) => countItems.some((r) => r.variantId === variantId))
      .map(([variantId, text]) => ({ variantId, countedQty: qtyOf(text) }))
      .filter((l): l is { variantId: string; countedQty: number } => l.countedQty !== null);
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
      setOnly(null);
      load();
      loadPast(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const wasteRow = items.find((r) => `${r.branchId}:${r.variantId}` === wasteKey);
  // Pieces of one item keep a fixed branch order: the main branch (the first code) first, the rest by name
  const branchRank = new Map(
    [...branchList]
      .sort(
        (a, b) =>
          Number(b.id === firstBranch) - Number(a.id === firstBranch) || a.name.localeCompare(b.name, 'ar'),
      )
      .map((b, i) => [b.id, i]),
  );
  const byBranch = [...items].sort(
    (a, b) => (branchRank.get(a.branchId) ?? 0) - (branchRank.get(b.branchId) ?? 0),
  );
  const wasteOptions = sortByOptions(byBranch).filter((r) => {
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
    setWasteAsk(!problem);
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
          id: wasteId,
          branchId: row.branchId,
          date: storeToday(timeZone),
          // The write-off is worked out from the list the owner is looking at: what moved after it is counted
          ...(stock?.asOf ? { countedAt: stock.asOf } : {}),
          note: 'هدر',
          lines: [
            {
              variantId: row.variantId,
              countedQty: Math.max(0, row.qty - qty),
              wasteReason: wasteWhy || wasteReasonsOf(stock?.wasteReasons)[0]!,
            },
          ],
        }),
      );
      setWasteKey('');
      setWasteQty('');
      setWasteQuery('');
      setWasteId(newDocumentId());
      setWasteOpen(false);
      load();
      loadPast(null);
    } catch (e) {
      setWasteError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const showWaste = canCount && !counting && items.length > 0;
  const costOfSales = profit?.costOfSalesMinor ?? 0;
  const margin =
    profit && profit.netSalesMinor > 0 && costOfSales > 0
      ? (profit.grossProfitMinor / profit.netSalesMinor) * 100
      : null;

  const stateOf = (r: InventoryRow) =>
    r.qty < 0 ? (
      <StatusPill kind="danger">سالب</StatusPill>
    ) : r.qty === 0 ? (
      <StatusPill kind="danger">نفد</StatusPill>
    ) : null;
  const qtyCell = (r: InventoryRow) => (
    <span className="inline-flex items-center gap-2">
      {stateOf(r)}
      <span className="flex flex-col items-end">
        <bdi dir="ltr" className="sx-n">
          {formatQuantity(r.qty, digits)}
        </bdi>
        {r.sellableQty !== undefined && r.qty > 0 && r.sellableQty < r.qty ? (
          <span className="sx-subline">
            متوفر <bdi className="sx-n">{formatQuantity(r.sellableQty, digits)}</bdi>
          </span>
        ) : null}
      </span>
    </span>
  );
  const unitCell = (r: InventoryRow) =>
    r.unitCostMinor === null || r.unitCostMinor === 0 ? (
      <span className="sx-sub" title="الكلفة غير مسجلة">
        —
      </span>
    ) : (
      <Amt minor={Math.round(r.unitCostMinor)} currency={base} className="sx-mute" />
    );
  const countInput = (r: InventoryRow) => (
    <TextField
      label={`المعدود من ${r.name}`}
      hideLabel
      inputMode="decimal"
      dir="ltr"
      placeholder="—"
      value={counts[r.variantId] ?? ''}
      onChange={(e) => setCounts((c) => ({ ...c, [r.variantId]: e.target.value }))}
      error={countProblem(counts[r.variantId] ?? '') ?? undefined}
      className="ix-counted"
      inputClassName="num"
    />
  );

  const columns: SxColumn<InventoryRow>[] = [
    ...(counting
      ? [
          {
            key: 'counted',
            header: 'المعدود',
            cell: (r: InventoryRow) => <span id={`ix-row-${r.variantId}`}>{countInput(r)}</span>,
          } satisfies SxColumn<InventoryRow>,
        ]
      : []),
    {
      key: 'name',
      header: 'الصنف',
      lead: true,
      cell: (r) => (
        <>
          {r.name}
          {manyBranches ? <span className="sx-subline">{branchLabel(r)}</span> : null}
        </>
      ),
    },
    { key: 'qty', header: 'الكمية', numeric: true, cell: qtyCell },
    { key: 'unit', header: 'كلفة الوحدة', numeric: true, cell: unitCell },
    {
      key: 'value',
      header: 'القيمة',
      numeric: true,
      strong: true,
      cell: (r) => <Amt minor={r.valueMinor} currency={base} />,
    },
  ];

  const reviewColumns: SxColumn<ReturnType<typeof reviewCount>[number]>[] = [
    { key: 'name', header: 'الصنف', lead: true, cell: (l) => l.name },
    {
      key: 'counted',
      header: 'المعدود',
      numeric: true,
      cell: (l) => <bdi className="sx-n">{formatQuantity(l.countedQty, digits)}</bdi>,
    },
    {
      key: 'expected',
      header: 'المتوقع',
      numeric: true,
      cell: (l) => <bdi className="sx-n">{formatQuantity(l.expectedQty, digits)}</bdi>,
    },
    {
      key: 'diff',
      header: 'الفرق',
      numeric: true,
      cell: (l) => (
        <span className="inline-flex items-center gap-2">
          <StatusPill kind={l.diffQty < 0 ? 'danger' : l.diffQty > 0 ? 'warn' : 'ok'}>
            {differenceWord(l.diffQty)}
          </StatusPill>
          <bdi dir="ltr" className="sx-n">
            {formatQuantity(Math.abs(l.diffQty), digits)}
          </bdi>
        </span>
      ),
    },
    {
      key: 'value',
      header: 'قيمة الفرق',
      numeric: true,
      strong: true,
      cell: (l) => <Amt minor={Math.abs(l.diffValueMinor)} currency={base} />,
    },
  ];

  const pastColumns: SxColumn<StocktakeListRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      lead: true,
      cell: (r) => (
        <bdi dir="ltr" className="sx-n">
          {r.number}
        </bdi>
      ),
    },
    { key: 'date', header: 'التاريخ', cell: (r) => <span className="sx-mute sx-n">{r.date}</span> },
    {
      key: 'kind',
      header: 'النوع',
      cell: (r) => (
        <StatusPill kind={r.kind === 'count' ? 'ok' : 'warn'}>
          {r.kind === 'waste' ? 'هدر' : r.kind === 'shortage' ? 'نقص تحويل' : 'جرد'}
        </StatusPill>
      ),
    },
    { key: 'branch', header: 'الفرع', hideBelowLg: true, cell: (r) => r.branchName },
    { key: 'by', header: 'بواسطة', hideBelowLg: true, cell: (r) => r.by || '—' },
    {
      key: 'items',
      header: 'الأصناف',
      numeric: true,
      cell: (r) => <span className="sx-n">{r.items.toLocaleString('en-US')}</span>,
    },
    {
      key: 'diff',
      header: 'الفرق بالقيمة',
      numeric: true,
      strong: true,
      cell: (r) =>
        r.diffValueMinor === 0 ? (
          <span className="sx-sub">مطابق</span>
        ) : (
          <Amt minor={r.diffValueMinor} currency={base} neg={r.diffValueMinor < 0} />
        ),
    },
  ];

  const countedOf = (list: readonly InventoryRow[]) =>
    list.filter((r) => qtyOf(counts[r.variantId] ?? '') !== null).length;

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
        {counting ? (
          <>
            <Panel title="العدّ بالمسح">
              <p className="sx-wait" style={{ marginBottom: 12 }}>
                امسح كل قطعة على الرف بقارئ الباركود فتُعدّ وحدها، أو اكتب ما عددته لكل صنف في الجدول. ما
                تتركه فارغاً لا يُغيَّر.
              </p>
              <form
                aria-label="العدّ بالمسح"
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addScan();
                }}
              >
                {manyBranches ? (
                  <Select
                    label="الفرع الذي تعدّه"
                    value={countBranch}
                    disabled={countedNumber > 0}
                    onChange={(e) => setCountBranch(e.target.value)}
                    className="w-full sm:w-56"
                    hint={countedNumber > 0 ? 'ألغِ الجرد لتغيير الفرع.' : undefined}
                  >
                    {branchList.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.kind === 'van' ? `${b.name} (مندوب)` : b.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
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
                  <p role="status" className="sx-st ok" style={{ fontSize: 14 }}>
                    <CheckCircleIcon />
                    {scanned.name}: <bdi className="num">{counts[scanned.variantId] ?? ''}</bdi>
                  </p>
                ) : null}
                {scanError ? (
                  <p className="sx-st fill danger" style={{ fontSize: 14 }}>
                    <AlertCircleIcon />
                    {scanError}
                  </p>
                ) : null}
              </form>
            </Panel>
            <div className="ix-countbar" role="group" aria-label="تقدّم الجرد">
              <span className="p">
                عُدّ <bdi className="sx-n">{countedOf(countItems)}</bdi> من{' '}
                <bdi className="sx-n">{countItems.length}</bdi> صنفاً
                {manyBranches ? ` في ${branchList.find((b) => b.id === countBranch)?.name ?? ''}` : ''}
              </span>
              {countedNumber === 0 ? (
                <span className="h">اعدّ صنفاً واحداً على الأقل ليُفتح «راجع الجرد».</span>
              ) : null}
              <span className="ix-acts">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCounting(false);
                    setReviewing(false);
                    setCounts({});
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
                    disabled={countedNumber === 0 || countProblems}
                    onClick={() => setReviewing(true)}
                  >
                    راجع الجرد
                  </Button>
                )}
              </span>
            </div>
          </>
        ) : null}
        {reviewing ? (
          <Panel title="راجع الجرد قبل التسجيل" flush>
            <p className="sx-wait" style={{ padding: '0 16px 12px' }}>
              ما عددته مقابل ما يتوقعه النظام. الزيادة تدخل المخزون والنقص يخرج منه بكلفته.
            </p>
            <p className="sx-note tight" style={{ margin: '0 16px 12px', paddingTop: 0, borderTop: 0 }}>
              {reviewTotal === 0 && reviewShort === 0 ? (
                'لا فرق في القيمة.'
              ) : (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    نقص <Amt minor={reviewShort} currency={base} className="font-bold" />
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    زيادة <Amt minor={reviewOver} currency={base} className="font-bold" />
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    الصافي <Amt minor={Math.abs(reviewTotal)} currency={base} className="font-bold" />
                    {reviewTotal < 0 ? ' نقصاً' : reviewTotal > 0 ? ' زيادة' : ''}
                  </span>
                </span>
              )}
            </p>
            <SxTable
              bare
              caption="فروق الجرد"
              columns={reviewColumns}
              rows={review}
              rowKey={(l) => l.variantId}
              empty={
                <div className="ix-empty">
                  <StockIcon size={32} />
                  <h3>لم تعدّ أي صنف.</h3>
                </div>
              }
            />
          </Panel>
        ) : null}
        {!counting ? (
          <>
            <section aria-label="أرقام المخزون" className="sx-card sx-strip ix-hero">
              <div>
                <span className="sx-eyebrow">قيمة المخزون بالكلفة</span>
                <span className="v big">
                  {stock ? <Amt minor={stock.totalValueMinor} currency={base} /> : '…'}
                </span>
                <span className="note">
                  {stock ? (
                    <>
                      {clothing ? 'المقاسات والألوان' : 'عدد الأصناف'}: <span className="sx-n">{kinds}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <div>
                <span className="sx-eyebrow">القطع في المخزون</span>
                <span className="v sx-n">{stock ? formatQuantity(netPieces, digits) : '…'}</span>
                <span className="note">
                  {belowZero > 0 ? 'الصافي بعد طرح ما نزل تحت الصفر' : 'ما على الرفوف في كل الفروع'}
                </span>
              </div>
              <div>
                <span className="sx-eyebrow">{soldOutLabel(clothing)}</span>
                <span className={`v sx-n${stock && soldOut > 0 ? ' warn' : ''}`}>
                  {stock ? soldOut : '…'}
                </span>
                <span className="note">
                  {stock ? (
                    soldOut ? (
                      <>
                        {soldOutSentence(soldOut, soldOutProducts, clothing)}
                        {belowZero > 0 ? <span className="block">{negativeNote(belowZero)}</span> : null}{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setFilter('low');
                            setView('list');
                          }}
                        >
                          اعرضها
                        </button>
                      </>
                    ) : (
                      'في كل صنف قطع على الرف'
                    )
                  ) : null}
                </span>
              </div>
            </section>
            {noCostKinds > 0 ? (
              <p className="ix-warn" role="note">
                <AlertCircleIcon size={20} />
                <span>
                  {noCostKinds.toLocaleString('en-US')} من الأصناف لا كلفة مسجّلة لها، فقيمة المخزون والهامش
                  أقل من الحقيقة.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setFilter('nocost');
                      setView('list');
                    }}
                  >
                    اعرض الأصناف بلا كلفة
                  </button>
                </span>
              </p>
            ) : null}
            {deadPieces > 0 ? (
              <p className="sx-note tight" style={{ margin: 0, padding: 0, border: 0 }}>
                منها <bdi className="sx-n">{formatQuantity(deadPieces, digits)}</bdi> قطعة منتهية أو موقوفة لا
                تُباع.{' '}
                <Link to="/expiry" className="sx-linkbtn">
                  اعرضها في الصلاحية
                </Link>
              </p>
            ) : null}
            <StockDefinitions />
            {profit ? (
              <Panel title="ربح هذا الشهر">
                <p className="sx-wait" style={{ marginBottom: 12 }}>
                  من الدفاتر، من أول الشهر حتى اليوم، بعد المرتجع وبدون الضريبة.
                </p>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Figure term="صافي المبيعات هذا الشهر">
                    <Amt minor={profit.netSalesMinor} currency={base} />
                  </Figure>
                  <Figure term="كلفة المبيعات">
                    <Amt minor={profit.costOfSalesMinor} currency={base} />
                  </Figure>
                  <Figure term="مجمل الربح">
                    <Amt minor={profit.grossProfitMinor} currency={base} />
                  </Figure>
                </dl>
                {margin !== null ? (
                  <p className="sx-note tight">
                    هامش <bdi className="sx-n font-semibold">{displayNumber(margin.toFixed(1), digits)}%</bdi>{' '}
                    من صافي المبيعات
                  </p>
                ) : profit.netSalesMinor > 0 && costOfSales === 0 ? (
                  <p className="ix-warn" role="note" style={{ marginTop: 12 }}>
                    <AlertCircleIcon size={20} />
                    الكلفة غير مسجلة لهذه المبيعات: الهامش غير دقيق، فلا نعرضه.
                  </p>
                ) : null}
                {profit.stockLossMinor ? (
                  <p className="sx-note tight">
                    {profit.stockLossMinor > 0 ? 'تلف وفقد' : 'زيادة جرد'}:{' '}
                    <Amt minor={Math.abs(profit.stockLossMinor)} currency={base} />
                  </p>
                ) : null}
              </Panel>
            ) : null}
          </>
        ) : null}
        <section aria-label="الأصناف في المخزون" className="flex flex-col gap-3">
          <div className="sx-card sx-filterbar print:hidden">
            <div className="sx-search">
              <SearchField label="ابحث عن صنف" value={query} onValueChange={setQuery} />
            </div>
            {/* The grid only means something when a product has options; «المقاس واللون» is a clothing store's words */}
            {!counting && items.some((r) => r.attributes && r.attributes.length > 0) ? (
              <SegmentedControl
                label="طريقة العرض"
                value={view}
                onValueChange={setView}
                options={[
                  { value: 'list', label: 'قائمة' },
                  { value: 'grid', label: clothing ? 'شبكة المقاس واللون' : 'شبكة الخيارات' },
                ]}
              />
            ) : null}
            {!counting && manyBranches ? (
              <Select
                label="الفرع"
                hideLabel
                value={branchShown}
                onChange={(e) => setBranchShown(e.target.value)}
                className="w-full sm:w-48"
              >
                <option value="">كل الفروع</option>
                {branchList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.kind === 'van' ? `${b.name} (مندوب)` : b.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {!counting && view === 'list' ? (
              <div role="radiogroup" aria-label="التصفية" className="sx-chips scroll">
                {(
                  [
                    ['all', 'الكل'],
                    ['low', 'نفد أو سالب'],
                    ['nocost', 'بلا كلفة'],
                  ] as const
                ).map(([key, text]) => (
                  <label key={key} className="sx-chip">
                    <input
                      type="radio"
                      name="stock-filter"
                      checked={filter === key}
                      onChange={() => setFilter(key)}
                    />
                    {text}
                  </label>
                ))}
              </div>
            ) : null}
            {!counting && view === 'list' ? (
              <Select
                label="الترتيب"
                hideLabel
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="w-full sm:w-44"
              >
                <option value="name">الترتيب: بالاسم</option>
                <option value="value">الأعلى قيمة أولاً</option>
                <option value="qty">الأقل كمية أولاً</option>
              </Select>
            ) : null}
            {!counting ? (
              <Button
                variant="ghost"
                icon={<DownloadGlyph size={20} />}
                disabled={shown.length === 0}
                onClick={exportStock}
              >
                صدّر إلى إكسل
              </Button>
            ) : null}
          </div>
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
            <Paged
              key={`${filter}|${needle}|${branchShown}|${sort}|${counting}|${countBranch}`}
              rows={shown}
              size={counting ? 100000 : 50}
              noun="الأصناف"
              render={(page) => (
                <>
                  {phone && page.length > 0 ? (
                    <ul className="sx-cards" aria-label="المخزون على الهاتف">
                      {page.map((r) => (
                        <li
                          key={`${r.branchId}:${r.variantId}`}
                          className="ix-icard"
                          id={`ix-card-${r.variantId}`}
                        >
                          <span className="n">
                            {r.name}
                            {manyBranches ? <span className="sx-subline">{branchLabel(r)}</span> : null}
                          </span>
                          <span className="v">
                            <Amt minor={r.valueMinor} currency={base} />
                          </span>
                          <span className="q">{qtyCell(r)}</span>
                          <span className="u">{unitCell(r)}</span>
                          {counting ? <span className="c">{countInput(r)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <SxTable
                      caption="المخزون"
                      columns={columns}
                      rows={page}
                      rowKey={(r) => `${r.branchId}:${r.variantId}`}
                      loading={!stock && !error}
                      empty={
                        items.length > 0 ? (
                          <div className="ix-empty">
                            <StockIcon size={32} />
                            <h3>لا صنف يطابق البحث.</h3>
                            <p>جرّب اسماً آخر أو فرعاً آخر.</p>
                          </div>
                        ) : (
                          <div className="ix-empty">
                            <StockIcon size={32} />
                            <h3>لا مخزون بعد.</h3>
                            <p>سجّل فاتورة شراء فيدخل المخزون بكلفته.</p>
                            <Link to="/purchases" className="sx-fbtn">
                              سجّل فاتورة شراء
                            </Link>
                          </div>
                        )
                      }
                    />
                  )}
                </>
              )}
            />
          )}
        </section>
        {!counting && canCount && (past?.length ?? 0) > 0 ? (
          <Panel title="الجرد السابق" flush>
            <SxTable
              bare
              caption="الجرد السابق"
              columns={pastColumns}
              rows={past ?? []}
              rowKey={(r) => r.id}
              error={pastError ?? undefined}
              onRetry={() => loadPast(null)}
            />
            {pastNext ? (
              <div className="flex justify-center" style={{ padding: 12 }}>
                <Button variant="secondary" onClick={() => loadPast(pastNext)}>
                  اعرض الأقدم
                </Button>
              </div>
            ) : null}
          </Panel>
        ) : null}
      </SalesPage>
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
                  {manyBranches ? `${r.name} · ${branchLabel(r)}` : r.name}
                </option>
              ))}
            </Select>
            <TextField
              label="كمية الهدر"
              inputMode="decimal"
              dir="ltr"
              value={wasteQty}
              hint={
                wasteRow && wasteRow.qty > 0
                  ? `الموجود من «${wasteRow.name}»: ${formatQuantity(wasteRow.qty, digits)}`
                  : undefined
              }
              onChange={(e) => {
                setWasteQty(e.target.value);
                setWasteAsk(false);
                setWasteError(null);
              }}
              inputClassName="num"
            />
            <Select
              label="السبب"
              value={wasteWhy || wasteReasonsOf(stock?.wasteReasons)[0]!}
              onChange={(e) => setWasteWhy(e.target.value)}
            >
              {wasteReasonsOf(stock?.wasteReasons).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            {wasteError ? <Alert tone="error">{wasteError}</Alert> : null}
            {wasteAsk && wasteRow ? (
              <Alert tone="warning">
                <div className="flex flex-col gap-3">
                  <span>
                    سيخرج <bdi className="num font-semibold">{wasteQty}</bdi> من «{wasteRow.name}» من المخزون
                    بكلفته. هذا لا يُسترجع من هنا.
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="danger" loading={saving} onClick={() => void saveWaste()}>
                      أكّد الهدر
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setWasteAsk(false)}>
                      رجوع
                    </Button>
                  </div>
                </div>
              </Alert>
            ) : null}
            <div className="ix-foot">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setWasteOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" variant="danger" loading={saving}>
                سجّل الهدر
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </ReportScreen>
  );
}

/** One figure of the month's profit: its name, then the amount. */
function Figure({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="sx-eyebrow">{term}</dt>
      <dd className="text-xl font-bold text-ink" style={{ margin: 0 }}>
        {children}
      </dd>
    </div>
  );
}
