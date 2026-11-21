import { latinDigits, normalizeArabic, type Category, type MeResponse } from '@serva/core';

// Small rules the catalog screens share: who may change it, the category tree's order, and how a
// typed or scanned search is read.

/** 17 › المنتجات: writing the catalog needs catalog.manage (owner and managers by default). */
export function canManageCatalog(me: MeResponse): boolean {
  return me.user.permissions.includes('catalog.manage');
}

export interface CategoryNode {
  category: Category;
  depth: number;
}

export const byOrderThenName = (a: Category, b: Category) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ar');

/**
 * The tree flattened in display order (09 › categories: sortOrder, then name): each parent followed
 * by its children. A category whose parent is missing (archived and filtered out, or a broken
 * reference) is shown at the top level, so nothing disappears.
 */
export function categoryTree(categories: readonly Category[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, Category[]>();
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(category);
    children.set(parent, list);
  }
  const out: CategoryNode[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const category of (children.get(parent) ?? []).sort(byOrderThenName)) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      out.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  // A cycle (a corrupt tree) never reaches the root: still list its members.
  for (const category of [...categories].sort(byOrderThenName)) {
    if (!seen.has(category.id)) {
      seen.add(category.id);
      out.push({ category, depth: 0 });
    }
  }
  return out;
}

/**
 * The ids of a category's siblings (the same parent) in display order, with the new sortOrder each
 * must have once `id` moves one place up or down: the order is renumbered by tens so a later move
 * has room, and only the ones that really change are returned. Empty when it cannot move.
 */
export function moveWithinSiblings(
  categories: readonly Category[],
  id: string,
  direction: -1 | 1,
): { id: string; sortOrder: number }[] {
  const ids = new Set(categories.map((c) => c.id));
  const me = categories.find((c) => c.id === id);
  if (!me) return [];
  const parentOf = (c: Category) => (c.parentId && ids.has(c.parentId) ? c.parentId : null);
  const group = categories.filter((c) => parentOf(c) === parentOf(me)).sort(byOrderThenName);
  const at = group.findIndex((c) => c.id === id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= group.length) return [];
  const moved = [...group];
  [moved[at], moved[to]] = [moved[to]!, moved[at]!];
  return moved.flatMap((c, index) =>
    c.sortOrder === (index + 1) * 10 ? [] : [{ id: c.id, sortOrder: (index + 1) * 10 }],
  );
}

/** The category and everything under it: none of them can become its parent. */
export function selfAndDescendants(categories: readonly Category[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId && out.has(category.parentId) && !out.has(category.id)) {
        out.add(category.id);
        grew = true;
      }
    }
  }
  return out;
}

/** An option label that shows the depth: «ألبان وأجبان › أجبان» reads as «— أجبان» under its parent. */
export function categoryOptionLabel({ category, depth }: CategoryNode): string {
  return `${'— '.repeat(depth)}${category.name}`;
}

/**
 * The `q` of the products list (15 › البحث في الأصناف): the one normalized form of
 * @serva/core/text, so «شوكولاتة» finds «شوكولاته». A barcode keeps its digits (Latin).
 */
export function searchTerm(input: string): string {
  return normalizeArabic(input);
}

/** What a scanner or a person typed, as a barcode: Arabic digits made Latin, spaces dropped. */
export function barcodeOf(input: string): string {
  return latinDigits(input).replace(/\s+/g, '');
}

/** A search that is only digits (EAN-13, the store's own 29…) is looked up as a barcode first. */
export function looksLikeBarcode(input: string): boolean {
  return /^\d{3,48}$/.test(barcodeOf(input));
}
