import type { CountSheet, CountSheetItem, StocktakeInput } from '@serva/core';
import { isoDay } from '../../lib/dates';

/**
 * The phone's stocktake (round 38, #29): a count made on the shelves with no connection needed. The sheet (what
 * the books say, with every barcode) is downloaded once; each scan adds to a local draft; the draft is posted as
 * ONE stocktake with its own id when the phone is online, so a post that is repeated counts once.
 */

export interface CountDraft {
  /** The id the count will carry to the server (made once, with the draft) */
  id: string;
  branchId: string;
  categoryId: string | null;
  /** When the sheet was downloaded: what «the books say» is as of then */
  sheetAt: string;
  /** The business day the count was made on (the store's time zone, from the sheet's time), kept so a late send keeps it */
  date?: string;
  /** The counted pieces per item, thousandths; an item never counted has no entry */
  counts: Record<string, number>;
  /** The order the items were first counted in: the list on screen follows it, so a row never moves while typing */
  order?: string[];
  /** The owner pressed «أرسل»: it goes by itself when the connection returns */
  queued: boolean;
  /** Items not counted are taken as zero (a full count of the part counted) */
  restZero: boolean;
}

export interface ScanHit {
  item: CountSheetItem;
  /** Thousandths one scan adds: the pack's pieces, or one piece */
  add: number;
}

/** A code as typed or scanned: Latin digits, no spaces */
export function cleanCode(raw: string): string {
  return raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, '');
}

/** The item a barcode belongs to in this sheet, with the pieces one scan stands for; null when it is not in it */
export function findInSheet(sheet: Pick<CountSheet, 'items'>, raw: string): ScanHit | null {
  const code = cleanCode(raw);
  if (!code) return null;
  for (const item of sheet.items) {
    const barcode = item.barcodes.find((b) => b.code === code);
    if (barcode) return { item, add: barcode.packQty };
  }
  return null;
}

export function newDraft(sheet: CountSheet, id: string, timeZone = 'Asia/Damascus'): CountDraft {
  return {
    id,
    branchId: sheet.branchId,
    categoryId: sheet.categoryId,
    sheetAt: sheet.at,
    date: isoDay(Date.parse(sheet.at), timeZone),
    counts: {},
    queued: false,
    restZero: false,
  };
}

/** One more scan of an item: its pack's pieces are added to what was counted */
export function addCount(draft: CountDraft, variantId: string, add: number): CountDraft {
  return {
    ...draft,
    queued: false,
    order: withInOrder(draft, variantId),
    counts: { ...draft.counts, [variantId]: (draft.counts[variantId] ?? 0) + add },
  };
}

/** The counted figure typed by hand (thousandths); null clears the item's count */
export function setCount(draft: CountDraft, variantId: string, qty: number | null): CountDraft {
  const { [variantId]: _gone, ...rest } = draft.counts;
  return {
    ...draft,
    queued: false,
    order: qty === null ? (draft.order ?? []).filter((v) => v !== variantId) : withInOrder(draft, variantId),
    counts: qty === null ? rest : { ...rest, [variantId]: qty },
  };
}

/** The scan order with this item in it (added at the end the first time, never moved after) */
function withInOrder(draft: CountDraft, variantId: string): string[] {
  const order = orderOf(draft);
  return order.includes(variantId) ? order : [...order, variantId];
}

/** The counted items in the order they were first counted (a draft saved before the order existed keeps its keys' order) */
function orderOf(draft: CountDraft): string[] {
  const known = (draft.order ?? []).filter((v) => draft.counts[v] !== undefined);
  const rest = Object.keys(draft.counts).filter((v) => !known.includes(v));
  return [...known, ...rest];
}

/** The rows to edit on screen: the counted items in scan order, fixed while typing */
export function editRowsOf(draft: CountDraft, sheet: Pick<CountSheet, 'items'>): CountLine[] {
  const byId = new Map(sheet.items.map((i) => [i.variantId, i]));
  return orderOf(draft).flatMap((id) => {
    const item = byId.get(id);
    const counted = draft.counts[id];
    return item && counted !== undefined ? [{ item, counted, diff: counted - item.qty }] : [];
  });
}

/** A figure typed as «12.5»: whole pieces for a piece item, up to three decimals for a weighed one; null otherwise */
export function countOf(text: string, allowsFraction: boolean): number | null {
  const clean = cleanCode(text).replace('٫', '.');
  const [whole = '', fraction, extra] = clean.split('.');
  const digitsOnly = (part: string) => [...part].every((ch) => ch >= '0' && ch <= '9');
  if (extra !== undefined || whole.length < 1 || whole.length > 7 || !digitsOnly(whole)) return null;
  if (fraction !== undefined) {
    if (!allowsFraction || fraction.length < 1 || fraction.length > 3 || !digitsOnly(fraction)) return null;
  }
  return Math.round(Number(clean) * 1000);
}

export interface CountLine {
  item: CountSheetItem;
  counted: number;
  /** counted − what the books said */
  diff: number;
}

/** What goes to the server: the counted items, plus (when asked) the rest of the sheet as zero */
export function linesOf(draft: CountDraft, sheet: Pick<CountSheet, 'items'>): CountLine[] {
  return sheet.items
    .flatMap((item) => {
      const counted = draft.counts[item.variantId];
      if (counted === undefined && !draft.restZero) return [];
      const n = counted ?? 0;
      return [{ item, counted: n, diff: n - item.qty }];
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

/** The stocktake the draft makes: the same body the inventory page posts, with the draft's own id */
export function stocktakeOf(
  draft: CountDraft,
  sheet: Pick<CountSheet, 'items'>,
  date: string,
): StocktakeInput {
  return {
    id: draft.id,
    branchId: draft.branchId,
    // The day the count was made, not the day the phone got a connection; the sheet's time lets the server
    // leave out of the count what was sold since
    date: draft.date ?? date,
    countedAt: draft.sheetAt,
    note: draft.categoryId ? 'جرد بالهاتف لجزء من المخزون' : 'جرد بالهاتف',
    lines: linesOf(draft, sheet).map((l) => ({ variantId: l.item.variantId, countedQty: l.counted })),
  };
}

/** How many items of the sheet were counted */
export const countedItems = (draft: CountDraft): number => Object.keys(draft.counts).length;

// ─── What the phone keeps (so a closed tab or a dead battery loses nothing) ───────────────────────────

const KEY = 'serva.count.draft';
const SHEET_KEY = 'serva.count.sheet';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export interface SavedCount {
  draft: CountDraft;
  sheet: CountSheet;
}

export function loadSaved(store: Store | null = defaultStore()): SavedCount | null {
  try {
    const draft = JSON.parse(store?.getItem(KEY) ?? 'null') as CountDraft | null;
    const sheet = JSON.parse(store?.getItem(SHEET_KEY) ?? 'null') as CountSheet | null;
    return draft && sheet && draft.id && Array.isArray(sheet.items) ? { draft, sheet } : null;
  } catch {
    return null;
  }
}

/** Keeps the draft (small) and the sheet; false when the phone has no room for the sheet */
export function save(draft: CountDraft, sheet: CountSheet, store: Store | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(draft));
    store.setItem(SHEET_KEY, JSON.stringify(sheet));
    return true;
  } catch {
    return false;
  }
}

export function saveDraftOnly(draft: CountDraft, store: Store | null = defaultStore()): boolean {
  try {
    store?.setItem(KEY, JSON.stringify(draft));
    return store !== null;
  } catch {
    return false;
  }
}

export function clearSaved(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(KEY);
    store?.removeItem(SHEET_KEY);
  } catch {
    // nothing kept: nothing to clear
  }
}
