import { presetGroups, SIZE_KINDS } from '../products/presets';

/** A value of an option with the group it belongs to («بالحروف», «بالأرقام», «أطفال»…), when known */
export interface OrderedValue {
  value: string;
  group: string | null;
}

const natural = new Intl.Collator('ar', { numeric: true });

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
  const inLists = unique
    .filter((v) => known.has(v))
    .sort((a, b) => known.get(a)!.at - known.get(b)!.at)
    .map((value) => ({ value, group: known.get(value)!.group }));
  const rest = unique
    .filter((v) => !known.has(v))
    .sort((a, b) => natural.compare(a, b))
    .map((value) => ({ value, group: null }));
  return [...inLists, ...rest];
}
