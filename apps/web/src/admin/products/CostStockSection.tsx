import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurrencyCode, ProductCostsResponse, ProductDetail } from '@serva/core';
import { Alert, Button, MoneyField, NumberField, Select, StockIcon, Switch } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { isoDay } from '../../lib/dates';
import { Amt, StatusPill } from '../sales/ui';
import { getProductCosts, postProductOpening } from '../catalog/api';
import { marginPercent } from './margin';
import { SectionCard } from './parts';

/** Thousandths from what was typed («2.5» → 2500); null when it is not a quantity above zero */
export function qtyThousandths(text: string): number | null {
  const n = Number(text);
  if (!text || !Number.isFinite(n) || n <= 0) return null;
  const milli = Math.round(n * 1000);
  return milli >= 1 && milli <= 1_000_000_000 ? milli : null;
}

export { marginPercent };

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
  const posting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [zeroOk, setZeroOk] = useState(false);

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
    // A second click before the first answer arrives must not send a second posting
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setError(null);
    try {
      await postProductOpening(product.id, {
        date: isoDay(Date.now(), me.tenant.timezone),
        branchId,
        lines,
        ...(noCost ? { zeroCostOk: true } : {}),
      });
      setDone(true);
      setQty({});
      setZeroOk(false);
      loadCosts();
      onPosted();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.fields
          ? (Object.values(caught.fields)[0] ?? errorMessage(caught))
          : errorMessage(caught),
      );
    } finally {
      posting.current = false;
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
        <div className="overflow-x-auto">
          <table aria-label="تكلفة القطع وهامشها" className="w-full min-w-96 text-sm">
            <thead>
              <tr className="text-xs font-semibold text-ink-subtle">
                <th scope="col" className="py-2 pe-3 text-start">
                  القطعة
                </th>
                <th scope="col" className="px-3 py-2 text-end">
                  السعر
                </th>
                <th scope="col" className="px-3 py-2 text-end">
                  التكلفة
                </th>
                <th scope="col" className="ps-3 py-2 text-end">
                  الهامش
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {live.map((v) => {
                const row = costs?.items.find((c) => c.variantId === v.id);
                const cost = row?.unitCostMinor ?? null;
                const margin =
                  cost !== null && v.price.currency === base ? marginPercent(v.price.priceMinor, cost) : null;
                return (
                  <tr key={v.id}>
                    <th scope="row" className="py-2.5 pe-3 text-start font-semibold text-ink">
                      {v.label ?? product.nameAr}
                    </th>
                    <td className="px-3 py-2.5 text-end">
                      <Amt minor={v.price.priceMinor} currency={v.price.currency} />
                    </td>
                    <td className="px-3 py-2.5 text-end">
                      {cost === null ? (
                        <span className="text-ink-subtle">لا تكلفة بعد</span>
                      ) : (
                        <Amt minor={cost} currency={base} className="font-semibold text-ink" />
                      )}
                    </td>
                    <td className="ps-3 py-2.5 text-end">
                      {margin !== null ? (
                        <StatusPill kind={margin < 0 ? 'danger' : margin < 10 ? 'warn' : 'ok'}>
                          {margin < 0 ? 'السعر أقل من التكلفة ' : 'هامش '}
                          <bdi className="num">{margin}</bdi>٪
                        </StatusPill>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
            <>
              <Alert tone="warning">
                بعض القطع بلا تكلفة: ستدخل المخزون بقيمة صفر ويظهر هامش ربحها 100٪ حتى أول فاتورة شراء.
              </Alert>
              <Switch label="أؤكد: سجّل هذه القطع بلا تكلفة" checked={zeroOk} onCheckedChange={setZeroOk} />
            </>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          {done ? <Alert tone="success">سُجّلت الكمية الافتتاحية.</Alert> : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={lines.length === 0 || (noCost && !zeroOk)}
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
