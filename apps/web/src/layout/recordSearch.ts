import { useEffect, useState } from 'react';
import type { MeResponse, OnlineOrder, SupplierReturnRow } from '@serva/core';
import { listProducts } from '../admin/catalog/api';
import { listCustomers } from '../admin/customers/api';
import { findSerials, getRecall, listPurchases, listSuppliers } from '../admin/purchases/api';
import { listCheques } from '../admin/cheques/api';
import { listRentals } from '../admin/contracts/api';
import { holdsAny, type AccessRule } from '../admin/reports/access';
import { apiFetch } from '../lib/api';
import { matchesArabic } from '../lib/arabicSearch';
import { dayText } from '../lib/dates';
import { listSales } from '../admin/sales/api';
import { listQuotations } from '../admin/quotations/api';
import { listClaims } from '../admin/warranty/api';

/** One record the search found: a product, a customer, a supplier, an invoice, a purchase invoice, a serial number or a batch. */
export interface RecordHit {
  key: string;
  group: string;
  label: string;
  detail?: string;
  /** The label is a number or a code (INV-…, a serial): drawn left to right inside the Arabic line */
  labelLtr?: boolean;
  /** The detail is a phone number: drawn left to right, so its + and digits do not jump */
  detailLtr?: boolean;
  to: string;
}

const CODE_GROUPS = new Set([
  'الفواتير',
  'فواتير الشراء',
  'طلبات المتجر الإلكتروني',
  'التأجير',
  'مطالبات الضمان',
  'مرتجعات الموردين',
  'عروض الأسعار',
  'الأرقام التسلسلية',
]);
const PHONE_GROUPS = new Set(['الزبائن', 'الموردون']);

const decorate = (hit: RecordHit): RecordHit => ({
  ...hit,
  ...(CODE_GROUPS.has(hit.group) ? { labelLtr: true } : {}),
  ...(PHONE_GROUPS.has(hit.group) && hit.detail ? { detailLtr: true } : {}),
});

/** «بنك · 000123 · 2026-12-01» with the date in words («1 كانون الأول 2026») */
const withArabicDates = (text: string): string => text.replace(/\d{4}-\d{2}-\d{2}/g, (day) => dayText(day));

const FEW = 4;

// The lists that have no search of their own are fetched whole and matched here. They do not depend
// on what was typed, so each is asked once and kept for a short while (per signed-in user): the
// next letter, and the next time the box opens, reuse it instead of fetching every list again.
const LIST_FRESH_MS = 60_000;
const lists = new WeakMap<MeResponse, Map<string, { at: number; answer: Promise<unknown> }>>();

function kept<T>(me: MeResponse, key: string, load: () => Promise<T>): Promise<T> {
  let byKey = lists.get(me);
  if (!byKey) lists.set(me, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && Date.now() - hit.at < LIST_FRESH_MS) return hit.answer as Promise<T>;
  const answer = load();
  byKey.set(key, { at: Date.now(), answer });
  // A failed ask is not kept: the next letter tries again
  answer.catch(() => byKey.delete(key));
  return answer;
}

/**
 * The search box asked for its first letter: warm the whole lists now, so the answer to the first
 * query does not wait for them. Called when the box opens or takes focus.
 */
export function warmRecordSearch(me: MeResponse): void {
  const can = (keys: AccessRule) => holdsAny(me, keys);
  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
  if (can(['purchases.manage'])) {
    quiet(kept(me, 'suppliers', () => listSuppliers()));
    quiet(kept(me, 'purchases', () => listPurchases()));
    quiet(kept(me, 'supplier-returns', supplierReturns));
  }
  if (can(['customers.view'])) {
    quiet(kept(me, 'online-orders', onlineOrders));
    quiet(kept(me, 'rentals', () => listRentals('all')));
    quiet(kept(me, 'cheques', () => listCheques(undefined)));
  }
  if (can(['catalog.manage'])) quiet(kept(me, 'claims', () => listClaims('all')));
}

const onlineOrders = () => apiFetch<{ items: OnlineOrder[] }>('/v1/online-orders', { auth: true });
const supplierReturns = () =>
  apiFetch<{ items: SupplierReturnRow[] }>('/v1/supplier-returns', { auth: true });

/** One promise per kind of record, each ready as soon as its own request answers. */
function search(me: MeResponse, q: string): Promise<RecordHit[]>[] {
  const can = (keys: AccessRule) => holdsAny(me, keys);
  const quiet = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);
  const sources: (RecordHit[] | Promise<RecordHit[]>)[] = [
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
          kept(me, 'suppliers', () => listSuppliers()).then((r) =>
            r.items
              .filter((s) => matchesArabic(s.name, q, s.phone ?? undefined))
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
              detail: s.customer?.name ?? dayText(s.businessDate),
              to: `/sales/invoices?q=${encodeURIComponent(s.number)}`,
            })),
          ),
        )
      : [],
    // Purchase invoices (PUR-…): the list has no search of its own, so the number is matched here
    can(['purchases.manage'])
      ? quiet(
          kept(me, 'purchases', () => listPurchases()).then((r) => {
            return r.items
              .filter((p) => matchesArabic(p.number, q, p.reference ?? undefined))
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
    // Online orders (ONL-…): the list has no search of its own, so the number, name or phone is matched here
    can(['customers.view'])
      ? quiet(
          kept(me, 'online-orders', onlineOrders).then((r) =>
            r.items
              .filter((o) => matchesArabic(o.number, q, o.customerName, o.phone))
              .slice(0, FEW)
              .map((o): RecordHit => ({
                key: `o:${o.id}`,
                group: 'طلبات المتجر الإلكتروني',
                label: o.number,
                detail: o.customerName,
                to: '/online-store',
              })),
          ),
        )
      : [],
    // Rentals (RNT-…) and cheque numbers, matched the same way
    can(['customers.view'])
      ? quiet(
          kept(me, 'rentals', () => listRentals('all')).then((r) =>
            r.items
              .filter((x) => matchesArabic(x.number, q, x.customerName, x.item))
              .slice(0, FEW)
              .map((x): RecordHit => ({
                key: `r:${x.id}`,
                group: 'التأجير',
                label: x.number,
                detail: `${x.item} · ${x.customerName}`,
                to: '/rentals',
              })),
          ),
        )
      : [],
    can(['customers.view'])
      ? quiet(
          kept(me, 'cheques', () => listCheques(undefined)).then((r) =>
            r.items
              .filter((c) =>
                matchesArabic(c.documentNumber, q, c.reference ?? undefined, c.customerName ?? undefined),
              )
              .slice(0, FEW)
              .map((c): RecordHit => ({
                key: `q:${c.sourceType}:${c.sourceId}:${c.paymentNo}`,
                group: 'الشيكات',
                label: withArabicDates(c.reference ?? c.documentNumber),
                detail: c.customerName ?? undefined,
                to: '/cheques',
              })),
          ),
        )
      : [],
    // Warranty claims (WC-…), supplier returns (PRT-…) and quotations (QUO-…): matched by number,
    // and by the name or serial next to it
    can(['catalog.manage'])
      ? quiet(
          kept(me, 'claims', () => listClaims('all')).then((r) =>
            r.items
              .filter((c) => matchesArabic(c.number, q, c.serial, c.customerName ?? undefined))
              .slice(0, FEW)
              .map((c): RecordHit => ({
                key: `w:${c.id}`,
                group: 'مطالبات الضمان',
                label: c.number,
                detail: `${c.item}${c.customerName ? ` · ${c.customerName}` : ''}`,
                to: '/warranty',
              })),
          ),
        )
      : [],
    can(['purchases.manage'])
      ? quiet(
          kept(me, 'supplier-returns', supplierReturns).then((r) =>
            r.items
              .filter((x) => matchesArabic(x.number, q, x.supplierName))
              .slice(0, FEW)
              .map((x): RecordHit => ({
                key: `t:${x.id}`,
                group: 'مرتجعات الموردين',
                label: x.number,
                detail: x.supplierName,
                to: '/supplier-returns',
              })),
          ),
        )
      : [],
    can(['sale.create'])
      ? quiet(
          listQuotations('all', q).then((r) =>
            r.items.slice(0, FEW).map((x): RecordHit => ({
              key: `z:${x.id}`,
              group: 'عروض الأسعار',
              label: x.number,
              detail: x.customerName ?? undefined,
              to: `/quotations/${x.id}`,
            })),
          ),
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
  ];
  return sources.map((source) => Promise.resolve(source).then((hits) => hits.map(decorate)));
}

/**
 * The records that match what was typed in the search box (two letters or more), found by the
 * existing list endpoints and shown under the pages. Nothing is asked for a shorter query.
 */
export function useRecordSearch(me: MeResponse, query: string, enabled: boolean) {
  const q = query.trim();
  const [state, setState] = useState<{ q: string; hits: RecordHit[]; pending: number }>({
    q: '',
    hits: [],
    pending: 0,
  });
  useEffect(() => {
    if (!enabled || q.length < 2) return;
    let current = true;
    const timer = window.setTimeout(() => {
      // Each kind of record appears as soon as it is found; the slow ones add their rows later
      const parts = search(me, q);
      const found: RecordHit[][] = [];
      let pending = parts.length;
      parts.forEach((part, index) => {
        void part.then((hits) => {
          if (!current) return;
          found[index] = hits;
          pending -= 1;
          setState({ q, hits: found.flat(), pending });
        });
      });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [me, q, enabled]);
  const ready = state.q === q && q.length >= 2;
  return { hits: ready ? state.hits : [], searching: q.length >= 2 && (!ready || state.pending > 0) };
}
