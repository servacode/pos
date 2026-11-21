import type { BatchAllocation, SalePayload } from '@serva/core/contracts/documents';
import { sameBatch } from '@serva/core/pharmacy';
import type { OutboxEntry } from '@serva/sync';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, CatalogItem } from './catalog';
import type { PosServices } from './services';

/** What this device's own sales took, per variant: the base units and the batches they came from */
export interface SoldLocally {
  qty: Map<string, number>;
  batches: Map<string, BatchAllocation[]>;
}

const none = (): SoldLocally => ({ qty: new Map(), batches: new Map() });

/** What one sale took out of the stock (nothing for any other document) */
function soldOf(entry: OutboxEntry): SoldLocally {
  const out = none();
  if (entry.type !== 'sale') return out;
  const sale = entry.doc.payload as unknown as SalePayload;
  for (const line of sale.lines ?? []) {
    out.qty.set(line.variantId, (out.qty.get(line.variantId) ?? 0) + line.baseQty);
    const taken = line.batches?.length
      ? line.batches
      : line.batchNo
        ? [{ batchNo: line.batchNo, expiry: line.batchExpiry ?? null, qty: line.baseQty }]
        : [];
    if (taken.length > 0)
      out.batches.set(line.variantId, [...(out.batches.get(line.variantId) ?? []), ...taken]);
  }
  return out;
}

/** The catalog with each item's stock and batches less what this device sold and the server has not counted yet (display only) */
export function withLocalSales(catalog: Catalog, sold: SoldLocally): Catalog {
  if (sold.qty.size === 0) return catalog;
  const swapped = new Map<string, CatalogItem>();
  const items = catalog.items.map((item) => {
    const took = sold.qty.get(item.variantId);
    if (!took || typeof item.stockQty !== 'number') return item;
    const taken = sold.batches.get(item.variantId) ?? [];
    const next: CatalogItem = {
      ...item,
      stockQty: item.stockQty - took,
      ...(Array.isArray(item.stockBatches)
        ? {
            stockBatches: item.stockBatches.map((batch) => {
              const out = taken.filter((t) => sameBatch(batch, t)).reduce((n, t) => n + t.qty, 0);
              return out > 0 ? { ...batch, qty: batch.qty - out } : batch;
            }),
          }
        : {}),
    };
    swapped.set(item.variantId, next);
    return next;
  });
  if (swapped.size === 0) return catalog;
  const byVariant = new Map(catalog.byVariant);
  for (const [id, item] of swapped) byVariant.set(id, item);
  const byBarcode = new Map(
    [...catalog.byBarcode].map(([code, hit]) => [
      code,
      swapped.has(hit.item.variantId) ? { ...hit, item: swapped.get(hit.item.variantId)! } : hit,
    ]),
  );
  return { ...catalog, items, byVariant, byBarcode, original: catalog.original ?? catalog };
}

/**
 * The tile's stock after a sale made on this device, online or not (display only: the server's own
 * stock and the sync are untouched). A sale counts from the moment it is saved until the next pulled
 * catalog replaces the stock; one still waiting in the outbox when the catalog changes counts again.
 */
export function useLocalStock(pos: PosServices, catalog: Catalog | null, tick: number): Catalog | null {
  const [sold, setSold] = useState<SoldLocally>(none);
  const kept = useRef<{ catalog: Catalog | null; docs: Map<string, SoldLocally> }>({
    catalog: null,
    docs: new Map(),
  });
  useEffect(() => {
    let alive = true;
    void pos.store.listByStatus('pending').then(
      (list) => {
        if (!alive) return;
        const state = kept.current;
        if (state.catalog !== catalog) {
          state.catalog = catalog;
          state.docs = new Map();
        }
        for (const entry of list) if (!state.docs.has(entry.id)) state.docs.set(entry.id, soldOf(entry));
        const total = none();
        for (const doc of state.docs.values()) {
          for (const [variantId, qty] of doc.qty)
            total.qty.set(variantId, (total.qty.get(variantId) ?? 0) + qty);
          for (const [variantId, list] of doc.batches)
            total.batches.set(variantId, [...(total.batches.get(variantId) ?? []), ...list]);
        }
        setSold(total);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pos.store, catalog, tick]);
  return useMemo(() => (catalog ? withLocalSales(catalog, sold) : null), [catalog, sold]);
}
