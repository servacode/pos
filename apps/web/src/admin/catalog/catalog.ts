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

const byOrderThenName = (a: Category, b: Category) =>
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
