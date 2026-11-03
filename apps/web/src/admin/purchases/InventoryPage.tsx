import { useCallback, useEffect, useState } from 'react';
import type { InventoryResponse, InventoryRow, ProfitReport, StocktakeDetail } from '@serva/core';
import {
  Alert,
  Button,
  DataTable,
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
    { key: 'name', header: 'الصنف', cell: (r) => <span className="font-semibold">{r.name}</span> },
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
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-2xl font-bold text-ink">المخزون والأرباح</h1>
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
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {counting ? (
          <Alert tone="info">اكتب ما عددته فعلاً لكل صنف عددته. ما تتركه فارغاً لا يُغيَّر.</Alert>
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
            value={<Money minor={stock?.totalValueMinor ?? 0} currency={base} />}
          />
          {profit ? (
            <>
              <StatTile
                label="صافي المبيعات هذا الشهر"
                value={<Money minor={profit.netSalesMinor} currency={base} />}
              />
              <StatTile
                label="كلفة المبيعات"
                value={<Money minor={profit.costOfSalesMinor} currency={base} />}
              />
              <StatTile
                label="مجمل الربح"
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
            className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4"
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
        <DataTable
          caption="المخزون"
          columns={columns}
          rows={stock?.items ?? []}
          rowKey={(r) => `${r.branchId}:${r.variantId}`}
          loading={!stock && !error}
          empty="لا مخزون بعد. سجّل فاتورة شراء فيدخل المخزون بكلفته."
        />
      </div>
    </AppShell>
  );
}
