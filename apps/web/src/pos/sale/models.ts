import { toLatinDigits } from '@serva/core/text';
import type { CatalogItem } from '../catalog';

/**
 * The till's grid (هوية 2): a model sold in several sizes or colours shows as one tile, and its
 * pieces are picked beside the cart. A product with one piece, or whose pieces have no size or
 * colour, stays a tile per piece.
 */
export type GridEntry =
  | { kind: 'item'; item: CatalogItem }
  | { kind: 'model'; productId: string; name: string; pieces: CatalogItem[]; lead: CatalogItem };

/** Every product's sellable pieces with a size, colour…, by product; products with one piece left out. */
export function modelPieces(items: readonly CatalogItem[]): Map<string, CatalogItem[]> {
  const byProduct = new Map<string, CatalogItem[]>();
  for (const item of items) {
    if (!item.attributes?.length) continue;
    const list = byProduct.get(item.productId);
    if (list) list.push(item);
    else byProduct.set(item.productId, [item]);
  }
  for (const [id, list] of byProduct) if (list.length < 2) byProduct.delete(id);
  return byProduct;
}

/** The search results as tiles: each model once, where its first matching piece stood. */
export function gridEntries(
  results: readonly CatalogItem[],
  pieces: ReadonlyMap<string, CatalogItem[]>,
): GridEntry[] {
  const seen = new Set<string>();
  const entries: GridEntry[] = [];
  for (const item of results) {
    const model = pieces.get(item.productId);
    if (!model) {
      entries.push({ kind: 'item', item });
      continue;
    }
    if (seen.has(item.productId)) continue;
    seen.add(item.productId);
    entries.push({
      kind: 'model',
      productId: item.productId,
      name: item.productName ?? item.name,
      pieces: model,
      lead: model.find((piece) => piece.imageUrl) ?? model[0]!,
    });
  }
  return entries;
}

const LETTER_SIZES = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];

/**
 * Where a size sits in its natural order, or null when the value is not a size we know (a colour):
 * letters (XS S M L XL XXL 3XL…), numbers (shoe sizes, waist sizes, millilitres), ages in months
 * before years. «فري سايز» comes last.
 */
export function sizeRank(value: string): number | null {
  const text = value.trim().toUpperCase();
  const letter = LETTER_SIZES.indexOf(text === 'XXXL' ? '3XL' : text === 'XXXXL' ? '4XL' : text);
  if (letter >= 0) return letter;
  if (value.trim() === 'فري سايز') return 10_000;
  if (value.trim() === 'حديث الولادة') return -1;
  if (value.trim() === 'سنتان') return 24;
  const number = /^(\d+(?:\.\d+)?)/.exec(toLatinDigits(value.trim()));
  if (!number) return null;
  const n = Number(number[1]);
  // «6-9 أشهر» and «18 شهراً» are months, «3 سنوات» and «12 سنة» are years (counted in months to sit with them)
  if (/(أشهر|شهر)/.test(value)) return n;
  if (/(سنوات|سنة)/.test(value)) return n * 12;
  return 100 + n;
}

/**
 * An option's values in their natural order when every one is a known size; otherwise as the model
 * lists them (colours stay in the order the product defines).
 */
export function orderValues(values: readonly string[]): string[] {
  const ranked = values.map((value) => [value, sizeRank(value)] as const);
  if (ranked.some(([, rank]) => rank === null)) return [...values];
  return ranked
    .map(([value, rank], index) => ({ value, rank: rank!, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.value);
}

/** The option names in the order the model uses them («المقاس» then «اللون»), with their values. */
export function optionsOf(pieces: readonly CatalogItem[]): { name: string; values: string[] }[] {
  const options: { name: string; values: string[] }[] = [];
  for (const piece of pieces) {
    for (const { name, value } of piece.attributes ?? []) {
      let option = options.find((o) => o.name === name);
      if (!option) {
        option = { name, values: [] };
        options.push(option);
      }
      if (!option.values.includes(value)) option.values.push(value);
    }
  }
  for (const option of options) option.values = orderValues(option.values);
  return options;
}

/**
 * What the branch has of the pieces that match the chosen values with `name` set to `value`: the
 * sum of their stock, in thousandths, or null when none of them has a known level. `inCart` is what
 * the open cart already holds of each piece.
 */
export function stockFor(
  pieces: readonly CatalogItem[],
  chosen: Readonly<Record<string, string>>,
  name: string,
  value: string,
  inCart: ReadonlyMap<string, number> = new Map(),
): number | null {
  let total: number | null = null;
  for (const piece of pieces) {
    const attrs = piece.attributes ?? [];
    const fits = attrs.every((a) =>
      a.name === name ? a.value === value : !chosen[a.name] || chosen[a.name] === a.value,
    );
    if (!fits || !attrs.some((a) => a.name === name && a.value === value)) continue;
    if (piece.stockQty === null || piece.stockQty === undefined) continue;
    total = (total ?? 0) + piece.stockQty - (inCart.get(piece.variantId) ?? 0);
  }
  return total;
}

/** The piece with exactly these values, once every option has one. */
export function pieceFor(
  pieces: readonly CatalogItem[],
  chosen: Readonly<Record<string, string>>,
  optionCount: number,
): CatalogItem | null {
  if (Object.keys(chosen).length < optionCount) return null;
  return (
    pieces.find((piece) => (piece.attributes ?? []).every(({ name, value }) => chosen[name] === value)) ??
    null
  );
}

/** Whether a value can still be chosen with the other options as they are. */
export function canChoose(
  pieces: readonly CatalogItem[],
  chosen: Readonly<Record<string, string>>,
  name: string,
  value: string,
): boolean {
  return pieces.some((piece) =>
    (piece.attributes ?? []).every((attribute) =>
      attribute.name === name
        ? attribute.value === value
        : !chosen[attribute.name] || chosen[attribute.name] === attribute.value,
    ),
  );
}

/** «خياران», «3 خيارات», «12 خياراً»: how many pieces a model has, for its tile. */
export function piecesText(count: number): string {
  if (count === 2) return 'خياران';
  if (count <= 10) return `${count} خيارات`;
  return `${count} خياراً`;
}

/** The lowest price among a model's pieces, for its tile («من 45,000»). */
export function lowestPrice(pieces: readonly CatalogItem[]): CatalogItem['price'] {
  return pieces.reduce((low, piece) => (piece.price.priceMinor < low.price.priceMinor ? piece : low)).price;
}

/**
 * A model's pieces in their natural order: by the first option's values as `optionsOf` orders them
 * (sizes S M L XL…), then the next option's (colours as the product lists them).
 */
export function orderPieces(pieces: readonly CatalogItem[]): CatalogItem[] {
  const options = optionsOf(pieces);
  const at = (piece: CatalogItem, option: { name: string; values: string[] }) =>
    option.values.indexOf((piece.attributes ?? []).find((a) => a.name === option.name)?.value ?? '');
  return pieces
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => {
      for (const option of options) {
        const diff = at(a.piece, option) - at(b.piece, option);
        if (diff !== 0) return diff;
      }
      return a.index - b.index;
    })
    .map((x) => x.piece);
}
