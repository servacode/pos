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
  return options;
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
