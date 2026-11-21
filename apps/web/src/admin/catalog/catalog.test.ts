import { describe, expect, it } from 'vitest';
import { categories, category, ids } from '../../test/catalog';
import { catalogMe } from '../../test/catalog';
import {
  barcodeOf,
  canManageCatalog,
  categoryOptionLabel,
  categoryTree,
  looksLikeBarcode,
  moveWithinSiblings,
  searchTerm,
  selfAndDescendants,
} from './catalog';

describe('the category tree', () => {
  it('lists each parent before its children, by sortOrder then name', () => {
    const tree = categoryTree([
      category({ id: 'c', name: 'منظفات', sortOrder: 1 }),
      category({ id: 'b', name: 'أجبان', parentId: 'a' }),
      category({ id: 'a', name: 'ألبان', sortOrder: 0 }),
      category({ id: 'd', name: 'ألبان مجففة', parentId: 'a' }),
    ]);
    expect(tree.map((n) => [n.category.id, n.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['d', 1],
      ['c', 0],
    ]);
    expect(categoryOptionLabel(tree[1]!)).toBe('— أجبان');
  });

  it('shows an orphan at the top and survives a cycle', () => {
    const tree = categoryTree([
      category({ id: 'x', name: 'يتيم', parentId: 'missing' }),
      category({ id: 'p', name: 'أ', parentId: 'q' }),
      category({ id: 'q', name: 'ب', parentId: 'p' }),
    ]);
    expect(tree.map((n) => n.category.id).sort()).toEqual(['p', 'q', 'x']);
  });

  it('moves a category one place among its siblings and renumbers only what changes', () => {
    const list = [
      category({ id: 'a', name: 'أ', sortOrder: 0 }),
      category({ id: 'b', name: 'ب', sortOrder: 0 }),
      category({ id: 'c', name: 'ج', sortOrder: 0 }),
      category({ id: 'k', name: 'ابن', parentId: 'a' }),
    ];
    // «ج» one place up: أ، ج، ب, written as 10, 20, 30
    expect(moveWithinSiblings(list, 'c', -1)).toEqual([
      { id: 'a', sortOrder: 10 },
      { id: 'c', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
    // the first cannot go further up, the last further down, and a child only moves among its own
    expect(moveWithinSiblings(list, 'a', -1)).toEqual([]);
    expect(moveWithinSiblings(list, 'c', 1)).toEqual([]);
    expect(moveWithinSiblings(list, 'k', 1)).toEqual([]);
    // already numbered by tens: only the two that swapped are written
    const numbered = [
      category({ id: 'a', name: 'أ', sortOrder: 10 }),
      category({ id: 'b', name: 'ب', sortOrder: 20 }),
      category({ id: 'c', name: 'ج', sortOrder: 30 }),
    ];
    expect(moveWithinSiblings(numbered, 'b', 1)).toEqual([
      { id: 'c', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  it('knows a category’s descendants', () => {
    expect([...selfAndDescendants(categories, ids.dairy)].sort()).toEqual([ids.dairy, ids.cheese].sort());
    expect([...selfAndDescendants(categories, ids.cleaning)]).toEqual([ids.cleaning]);
  });
});

describe('search and barcodes', () => {
  it('searches in the one normalized form', () => {
    expect(searchTerm('  شُوكولاتة ')).toBe('شوكولاته');
    expect(searchTerm('أرز')).toBe('ارز');
    expect(searchTerm('٦٢٨١')).toBe('6281');
  });

  it('reads a barcode with Arabic digits and spaces', () => {
    expect(barcodeOf(' ٦٢٨١ ٠٠٧ ')).toBe('6281007');
    expect(looksLikeBarcode('٦٢٨١٠٠٧٠٣٥١٠٥')).toBe(true);
    expect(looksLikeBarcode('حليب')).toBe(false);
    expect(looksLikeBarcode('12')).toBe(false);
  });

  it('lets only catalog.manage change the catalog', () => {
    expect(canManageCatalog(catalogMe())).toBe(true);
    expect(canManageCatalog(catalogMe(['sale.create']))).toBe(false);
  });
});
