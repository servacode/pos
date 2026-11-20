import { useCallback, useEffect, useState } from 'react';
import type { CurrencyCode, ProductCostsResponse, ProductDetail } from '@serva/core';
import { Alert, Button, MoneyField, NumberField, Select, StockIcon } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { isoDay } from '../../lib/dates';
import { Amt, StatusPill } from '../sales/ui';
import { getProductCosts, postProductOpening } from '../catalog/api';
import { SectionCard } from './parts';

/** Thousandths from what was typed («2.5» → 2500); null when it is not a quantity above zero */
export function qtyThousandths(text: string): number | null {
  const n = Number(text);
  if (!text || !Number.isFinite(n) || n <= 0) return null;
  const milli = Math.round(n * 1000);
  return milli >= 1 && milli <= 1_000_000_000 ? milli : null;
}

/** The share of the price that is profit, whole percent: (price - cost) / price. Null when there is no price. */
export function marginPercent(priceMinor: number, costMinor: number): number | null {
  if (priceMinor <= 0) return null;
  return Math.round(((priceMinor - costMinor) / priceMinor) * 100);
}

/**
 * «التكلفة والكمية الافتتاحية» on the card of a saved stocked product: what a unit costs (for who holds
 * cost.view) with the margin on the shelf price, and the first quantity of a piece that never moved.
 */
export function CostStockSection({ product, onPosted }: { product: ProductDetail; onPosted: () => void }) {
  const me = useMe();
  const base: CurrencyCode = me.settings.baseCurrency;
  const seesCost = me.user.permissions.includes('cost.view');
  const canAdjust = me.user.permissions.includes('inventory.adjust');
  const [costs, setCosts] = useState<ProductCostsResponse | null>(null);
  const [branchId, setBranchId] = useState(me.branches[0]?.id ?? '');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unitCost, setUnitCost] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const loadCosts = useCallback(() => {
    if (!seesCost) return;
    getProductCosts(product.id)
      .then(setCosts)
      .catch(() => setCosts(null));
  }, [product.id, seesCost]);
  useEffect(loadCosts, [loadCosts]);

  const live = product.variants.filter((v) => !v.archivedAt);
  // A piece with no stock row in the chosen branch never moved there: it can take an opening quantity
  const fresh = live.filter((v) => !v.stock.some((s) => s.branchId === branchId && s.qty !== 0));
  const lines = fresh.flatMap((v) => {
    const q = qtyThousandths(qty[v.id] ?? '');
    return q === null ? [] : [{ variantId: v.id, qty: q, unitCostMinor: unitCost[v.id] ?? 0 }];
  });
  const noCost = lines.some((l) => l.unitCostMinor === 0);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      await postProductOpening(product.id, {
        date: isoDay(Date.now(), me.tenant.timezone),
        branchId,
        lines,
      });
      setDone(true);
      setQty({});
      loadCosts();
      onPosted();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.fields
          ? (Object.values(caught.fields)[0] ?? errorMessage(caught))
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="التكلفة والكمية الافتتاحية"
      icon={<StockIcon />}
      description={
        seesCost
          ? 'ما كلّفتك الوحدة وهامش الربح على سعر الرف. التكلفة تتحدّث مع كل فاتورة شراء.'
          : 'الكمية التي بدأت بها هذه القطعة في الفرع، مع ما كلّفتك الوحدة.'
      }
    >
      {seesCost ? (
        <ul className="flex flex-col divide-y divide-line">
          {live.map((v) => {
            const row = costs?.items.find((c) => c.variantId === v.id);
            const cost = row?.unitCostMinor ?? null;
            const margin =
              cost !== null && v.price.currency === base ? marginPercent(v.price.priceMinor, cost) : null;
            return (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="font-semibold text-ink">{v.label ?? product.nameAr}</span>
                <span className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                  <span>
                    التكلفة{' '}
                    {cost === null ? (
                      <span className="text-ink-subtle">لا تكلفة بعد</span>
                    ) : (
                      <Amt minor={cost} currency={base} className="font-semibold text-ink" />
                    )}
                  </span>
                  {margin !== null ? (
                    <StatusPill kind={margin < 0 ? 'danger' : margin < 10 ? 'warn' : 'ok'}>
                      هامش <bdi className="num">{margin}</bdi>٪
                    </StatusPill>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {canAdjust && product.type === 'stock' && fresh.length > 0 ? (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <p className="text-sm text-ink-muted">
            أدخل الكمية التي لديك الآن لكل قطعة لم تتحرك في الفرع، مع تكلفة الوحدة. تُسجَّل كرصيد افتتاحي في
            المخزون والدفاتر.
          </p>
          {me.branches.length > 1 ? (
            <Select label="الفرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {me.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : null}
          {fresh.map((v) => (
            <div
              key={v.id}
              className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_12rem] sm:items-start"
            >
              <span className="pt-2 font-semibold text-ink sm:pt-7">{v.label ?? product.nameAr}</span>
              <NumberField
                label="الكمية"
                decimals={3}
                value={qty[v.id] ?? ''}
                onValueChange={(value) => {
                  setDone(false);
                  setQty((q) => ({ ...q, [v.id]: value }));
                }}
              />
              <MoneyField
                label="تكلفة الوحدة"
                currency={base}
                valueMinor={unitCost[v.id] ?? null}
                onValueChange={(value) => setUnitCost((c) => ({ ...c, [v.id]: value }))}
              />
            </div>
          ))}
          {noCost ? (
            <Alert tone="warning">
              بعض القطع بلا تكلفة: ستدخل المخزون بقيمة صفر ويظهر هامش ربحها 100٪ حتى أول فاتورة شراء.
            </Alert>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          {done ? <Alert tone="success">سُجّلت الكمية الافتتاحية.</Alert> : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={lines.length === 0}
              loading={busy}
              onClick={() => void post()}
            >
              سجّل الكمية الافتتاحية
            </Button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
