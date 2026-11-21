import { useEffect, useState } from 'react';
import type { MeResponse } from '@serva/core';
import { listProducts } from '../admin/catalog/api';
import { findSerials, getRecall } from '../admin/purchases/api';
import { listCheques } from '../admin/cheques/api';
import { holdsAny, type AccessRule } from '../admin/reports/access';
import { apiFetch } from '../lib/api';
import { matchesArabic } from '../lib/arabicSearch';
import { dayText } from '../lib/dates';
import { listSales } from '../admin/sales/api';
import { listQuotations } from '../admin/quotations/api';

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
 * The search box opened: nothing is downloaded any more. Suppliers, purchase invoices, returns,
 * online orders, rentals, claims and customers are found by the server (`/v1/me/search`); only the
 * cheques (which have no search of their own) are read, and only once a word is typed.
 */
export function warmRecordSearch(_me: MeResponse): void {
  // Kept so the palette's call stays; the lists are not warmed any more (round 48)
}

/** One promise per kind of record, each ready as soon as its own request answers. */
function search(me: MeResponse, q: string): Promise<RecordHit[]>[] {
  const can = (keys: AccessRule) => holdsAny(me, keys);
  const quiet = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);
  const sources: (RecordHit[] | Promise<RecordHit[]>)[] = [
    // One request for the records the server can find by name or number (see services/record-search.ts)
    can(['purchases.manage']) || can(['customers.view']) || can(['catalog.manage'])
      ? quiet(
          apiFetch<{ items: RecordHit[] }>(`/v1/me/search?q=${encodeURIComponent(q)}`, { auth: true }).then(
            (r) => r.items,
          ),
        )
      : [],
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
  // The last hits stay on screen while the next letter is being answered (no flicker), when the
  // new query is a longer or shorter form of the one they answered
  const related = state.q.length >= 2 && q.length >= 2 && (q.startsWith(state.q) || state.q.startsWith(q));
  return {
    hits: ready || related ? state.hits : [],
    searching: q.length >= 2 && (!ready || state.pending > 0),
  };
}
