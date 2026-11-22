import { presetGroups, SIZE_KINDS } from '../admin/products/presets';

/** A value of an option with the group it belongs to («بالحروف», «بالأرقام», «أطفال»…), when known */
export interface OrderedValue {
  value: string;
  group: string | null;
}

const natural = new Intl.Collator('ar', { numeric: true });

/** «2 سنة» typed by hand is the list's «سنتان»; «5 سنة» its «5 سنوات» (the lists write ages 2 to 10 that way) */
function listed(value: string): string {
  const m = /^(\d+)\s*سنة$/.exec(value.trim());
  if (!m) return value;
  const n = Number(m[1]);
  return n === 2 ? 'سنتان' : n >= 3 && n <= 10 ? `${String(n)} سنوات` : value;
}

/**
 * The values of one option in the order a shop reads them: the built-in lists in their own order
 * (XS S M L XL, then 28 30 32…, then children's ages), each group together, and what the lists do
 * not know after them, in natural order (2 before 10).
 */
export function orderValues(optionName: string, values: readonly string[]): OrderedValue[] {
  // A size column mixes letters, numbers and ages: look in every size list for «المقاس»
  const groups =
    optionName === 'المقاس' ? SIZE_KINDS.flatMap((kind) => [...kind.groups]) : [...presetGroups(optionName)];
  const known = new Map<string, { at: number; group: string }>();
  let at = 0;
  for (const g of groups)
    for (const v of g.values) {
      if (!known.has(v)) known.set(v, { at: at++, group: g.label });
    }
  const unique = [...new Set(values)];
  // Shoe and trouser numbers (37 38 39 40 …) read by their number, whether the list knows them or not
  if (unique.length > 1 && unique.every((v) => /^\d+(\.\d+)?$/.test(v.trim()))) {
    return unique
      .sort((a, b) => Number(a) - Number(b))
      .map((value) => ({ value, group: known.get(value)?.group ?? null }));
  }
  const inLists = unique
    .filter((v) => known.has(listed(v)))
    .sort((a, b) => known.get(listed(a))!.at - known.get(listed(b))!.at)
    .map((value) => ({ value, group: known.get(listed(value))!.group }));
  const rest = unique
    .filter((v) => !known.has(listed(v)))
    .sort((a, b) => natural.compare(a, b))
    .map((value) => ({ value, group: null }));
  return [...inLists, ...rest];
}

/**
 * Pieces of the same model in the order a shop reads them (S before XL, 4 before 10 سنوات): the
 * rows keep their model order, and inside one model their options are compared by `orderValues`.
 */
export function sortByOptions<
  T extends { productId?: string; attributes?: { name: string; value: string }[] },
>(rows: readonly T[]): T[] {
  const ranks = new Map<string, Map<string, number>>();
  const rankOf = (productId: string, name: string): Map<string, number> => {
    const key = `${productId}\u0000${name}`;
    let r = ranks.get(key);
    if (!r) {
      const values = rows
        .filter((x) => (x.productId ?? '') === productId)
        .flatMap((x) => x.attributes?.filter((a) => a.name === name).map((a) => a.value) ?? []);
      r = new Map(orderValues(name, values).map((o, i) => [o.value, i]));
      ranks.set(key, r);
    }
    return r;
  };
  const position = new Map(rows.map((row, i) => [row, i]));
  // Each model's rows stay together, models in the order they first appear (the comparison below is
  // then one consistent order: rows of different models are never compared by their options)
  const modelAt = new Map<string, number>();
  for (const row of rows) {
    const model = row.productId ?? '';
    if (!modelAt.has(model)) modelAt.set(model, modelAt.size);
  }
  return [...rows].sort((a, b) => {
    const modelA = a.productId ?? '';
    const modelB = b.productId ?? '';
    if (modelA !== modelB) return modelAt.get(modelA)! - modelAt.get(modelB)!;
    const length = Math.min(a.attributes?.length ?? 0, b.attributes?.length ?? 0);
    for (let i = 0; i < length; i += 1) {
      const attr = a.attributes![i]!;
      const other = b.attributes![i]!;
      if (other.name !== attr.name) break;
      const ra = rankOf(modelA, attr.name);
      const diff = (ra.get(attr.value) ?? 0) - (ra.get(other.value) ?? 0);
      if (diff !== 0) return diff;
    }
    return position.get(a)! - position.get(b)!;
  });
}
