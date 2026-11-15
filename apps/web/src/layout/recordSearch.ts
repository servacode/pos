import { useEffect, useState } from 'react';
import type { MeResponse } from '@serva/core';
import { listProducts } from '../admin/catalog/api';
import { listCustomers } from '../admin/customers/api';
import { findSerials, getRecall, listPurchases, listSuppliers } from '../admin/purchases/api';
import { holdsAny, type AccessRule } from '../admin/reports/access';
import { listSales } from '../admin/sales/api';

/** One record the search found: a product, a customer, a supplier, an invoice, a purchase invoice, a serial number or a batch. */
export interface RecordHit {
  key: string;
  group: string;
  label: string;
  detail?: string;
  to: string;
}

const FEW = 4;

async function search(me: MeResponse, q: string): Promise<RecordHit[]> {
  const can = (keys: AccessRule) => holdsAny(me, keys);
  const quiet = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);
  const parts = await Promise.all([
    can(['catalog.manage'])
      ? quiet(
          listProducts({ q, limit: FEW }).then((r) =>
            r.items.slice(0, FEW).map((p): RecordHit => ({
              key: `p:${p.id}`,
              group: 'المنتجات',
              label: p.nameAr,
              detail: p.categoryName ?? undefined,
              to: `/products/${p.id}`,
            })),
          ),
        )
      : [],
    can(['customers.view'])
      ? quiet(
          listCustomers(q).then((r) =>
            r.items.slice(0, FEW).map((c): RecordHit => ({
              key: `c:${c.id}`,
              group: 'الزبائن',
              label: c.name,
              detail: c.phone ?? undefined,
              to: `/customers/${c.id}`,
            })),
          ),
        )
      : [],
    can(['purchases.manage'])
      ? quiet(
          listSuppliers().then((r) =>
            r.items
              .filter((s) => s.name.includes(q) || (s.phone ?? '').includes(q))
              .slice(0, FEW)
              .map((s): RecordHit => ({
                key: `s:${s.id}`,
                group: 'الموردون',
                label: s.name,
                detail: s.phone ?? undefined,
                to: `/suppliers/${s.id}/statement`,
              })),
          ),
        )
      : [],
    can(['report.view'])
      ? quiet(
          listSales(
            {
              from: '2020-01-01',
              to: '2099-12-31',
              branchId: null,
              deviceId: null,
              cashierId: null,
              customerId: null,
              method: null,
              status: null,
              q,
              minTotal: '',
              maxTotal: '',
            },
            null,
            FEW,
          ).then((r) =>
            r.items.slice(0, FEW).map((s): RecordHit => ({
              key: `i:${s.id}`,
              group: 'الفواتير',
              label: s.number,
              detail: s.customer?.name ?? s.businessDate,
              to: `/sales/invoices?q=${encodeURIComponent(s.number)}`,
            })),
          ),
        )
      : [],
    // Purchase invoices (PUR-…): the list has no search of its own, so the number is matched here
    can(['purchases.manage'])
      ? quiet(
          listPurchases().then((r) => {
            const needle = q.toLowerCase();
            return r.items
              .filter(
                (p) =>
                  p.number.toLowerCase().includes(needle) ||
                  (p.reference ?? '').toLowerCase().includes(needle),
              )
              .slice(0, FEW)
              .map((p): RecordHit => ({
                key: `u:${p.id}`,
                group: 'فواتير الشراء',
                label: p.number,
                detail: p.supplierName,
                to: `/purchases?q=${encodeURIComponent(p.number)}`,
              }));
          }),
        )
      : [],
    can(['catalog.manage']) && q.length >= 3
      ? quiet(
          findSerials(q).then((r) =>
            r.items.slice(0, FEW).map((s): RecordHit => ({
              key: `n:${s.serial}`,
              group: 'الأرقام التسلسلية',
              label: s.serial,
              detail: s.name,
              to: `/serials?q=${encodeURIComponent(s.serial)}`,
            })),
          ),
        )
      : [],
    can(['purchases.manage']) && q.length >= 3
      ? quiet(
          getRecall(q).then((r) =>
            r.batches.slice(0, FEW).map((b): RecordHit => ({
              key: `b:${b.batchNo}:${b.variantId ?? ''}`,
              group: 'الدفعات',
              label: `دفعة ${b.batchNo}`,
              detail: b.name,
              to: `/recall?batchNo=${encodeURIComponent(b.batchNo)}`,
            })),
          ),
        )
      : [],
  ]);
  return parts.flat();
}

/**
 * The records that match what was typed in the search box (two letters or more), found by the
 * existing list endpoints and shown under the pages. Nothing is asked for a shorter query.
 */
export function useRecordSearch(me: MeResponse, query: string, enabled: boolean) {
  const q = query.trim();
  const [state, setState] = useState<{ q: string; hits: RecordHit[] }>({ q: '', hits: [] });
  useEffect(() => {
    if (!enabled || q.length < 2) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void search(me, q).then((hits) => current && setState({ q, hits }));
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [me, q, enabled]);
  const ready = state.q === q && q.length >= 2;
  return { hits: ready ? state.hits : [], searching: q.length >= 2 && !ready };
}
