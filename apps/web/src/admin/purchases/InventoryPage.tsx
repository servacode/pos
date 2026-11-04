import { useCallback, useEffect, useState } from 'react';
import type { InventoryResponse, InventoryRow, ProfitReport, StocktakeDetail } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CashIcon,
  DataTable,
  InventoryIcon,
  PageHeader,
  TrendUpIcon,
  WalletIcon,
  WarningIcon,
  formatQuantity,
  Money,
  Select,
  StatTile,
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { lookupBarcode } from '../catalog/api';
import { createStocktake, getInventory, getProfit, qtyOf, today } from './api';

const monthStart = () => `${today().slice(0, 8)}01`;

/**
 * «المخزون والأرباح» (10 › الكلفة والربح): what each item's stock is worth at its average cost, the
 * month's gross profit from the books, and a count of the shelves that posts what is missing or
 * over.
 */
export function InventoryPage() {
  const me = useMe();
  const digits = useDigits();
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
  const columns: DataColumn<InventoryRow>[] = [
    {
      key: 'name',
      header: 'الصنف',
      cell: (r) => (
        <span className="inline-flex items-center gap-2 font-semibold">
          {r.name}
          {r.qty <= 0 ? <Badge tone="warning">{r.qty < 0 ? 'بالسالب' : 'نفد'}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'الكمية',
      numeric: true,
      // A shelf sold below nothing reads «−1», not «1-»
      cell: (r) => (
        <bdi dir="ltr" className="num">
          {formatQuantity(r.qty, digits)}
        </bdi>
      ),
    },
    {
      key: 'unit',
      header: 'كلفة الوحدة',
      numeric: true,
      cell: (r) =>
        r.unitCostMinor === null ? '—' : <Money minor={Math.round(r.unitCostMinor)} currency={base} />,
    },
    {
      key: 'value',
      header: 'القيمة',
      numeric: true,
      cell: (r) => <Money minor={r.valueMinor} currency={base} />,
    },
    ...(counting
      ? [
          {
            key: 'counted',
            header: 'المعدود',
            cell: (r: InventoryRow) => (
              <TextField
                label={`المعدود من ${r.name}`}
                inputMode="decimal"
                dir="ltr"
                value={counts[r.variantId] ?? ''}
                onChange={(e) => setCounts((c) => ({ ...c, [r.variantId]: e.target.value }))}
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

  return (
    <AppShell>
      <title>المخزون والأرباح · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          className="mb-0"
          icon={InventoryIcon}
          title="المخزون والأرباح"
          description="قيمة بضاعتك بالكلفة، وربح هذا الشهر"
          actions={
            <>
              {canCount && !counting ? (
                <Button variant="secondary" onClick={() => setCounting(true)}>
                  جرد الرفوف
                </Button>
              ) : null}
              {counting ? (
                <>
                  <Button onClick={() => void saveCount()} loading={saving}>
                    سجّل الجرد
                  </Button>
                  <Button variant="ghost" onClick={() => setCounting(false)}>
                    إلغاء
                  </Button>
                </>
              ) : null}
            </>
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {counting ? (
          <>
            <Alert tone="info">
              امسح كل قطعة على الرف بقارئ الباركود فتُعدّ وحدها، أو اكتب ما عددته لكل صنف. ما تتركه فارغاً لا
              يُغيَّر.
            </Alert>
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
                className="w-64"
              />
              {scanned ? (
                <p role="status" className="pb-3 font-semibold text-ink">
                  {scanned.name}: <bdi className="num">{counts[scanned.variantId] ?? ''}</bdi>
                </p>
              ) : null}
              {scanError ? <p className="pb-3 font-semibold text-danger-ink">{scanError}</p> : null}
            </form>
          </>
        ) : null}
        {result ? (
          <Alert tone={result.diffValueMinor < 0 ? 'info' : 'success'}>
            سُجّل الجرد {result.number}. الفرق:{' '}
            <Money minor={result.diffValueMinor} currency={base} className="font-bold" />
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="قيمة المخزون بالكلفة"
            icon={InventoryIcon}
            value={<Money minor={stock?.totalValueMinor ?? 0} currency={base} />}
          />
          {profit ? (
            <>
              <StatTile
                label="صافي المبيعات هذا الشهر"
                icon={CashIcon}
                tone="info"
                value={<Money minor={profit.netSalesMinor} currency={base} />}
              />
              <StatTile
                label="كلفة المبيعات"
                icon={WalletIcon}
                tone="neutral"
                value={<Money minor={profit.costOfSalesMinor} currency={base} />}
              />
              <StatTile
                label="مجمل الربح"
                icon={profit.stockLossMinor ? WarningIcon : TrendUpIcon}
                tone={profit.stockLossMinor ? 'warning' : 'brand'}
                value={<Money minor={profit.grossProfitMinor} currency={base} />}
                footnote={
                  profit.stockLossMinor ? (
                    <>
                      تلف وفقد: <Money minor={profit.stockLossMinor} currency={base} />
                    </>
                  ) : undefined
                }
              />
            </>
          ) : null}
        </div>
        {canCount && !counting && (stock?.items.length ?? 0) > 0 ? (
          <form
            aria-label="سجّل هدراً"
            className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-e1 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveWaste();
            }}
          >
            <Select
              label="الصنف التالف"
              value={wasteKey}
              onChange={(e) => setWasteKey(e.target.value)}
              className="min-w-56 flex-1"
            >
              <option value="">اختر الصنف</option>
              {(stock?.items ?? []).map((r) => (
                <option key={`${r.branchId}:${r.variantId}`} value={`${r.branchId}:${r.variantId}`}>
                  {r.name}
                </option>
              ))}
            </Select>
            <TextField
              label="كمية الهدر"
              inputMode="decimal"
              dir="ltr"
              value={wasteQty}
              onChange={(e) => setWasteQty(e.target.value)}
              className="w-36"
            />
            <Button type="submit" variant="secondary" loading={saving}>
              سجّل الهدر
            </Button>
          </form>
        ) : null}
        <Card>
          <CardHeader icon={InventoryIcon} title="المخزون" description="الكمية وقيمتها بكلفة الوحدة" />
          <DataTable
            caption="المخزون"
            columns={columns}
            rows={stock?.items ?? []}
            rowKey={(r) => `${r.branchId}:${r.variantId}`}
            loading={!stock && !error}
            empty="لا مخزون بعد. سجّل فاتورة شراء فيدخل المخزون بكلفته."
          />
        </Card>
      </div>
    </AppShell>
  );
}
