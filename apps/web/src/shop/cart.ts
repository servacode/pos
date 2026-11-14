import { useCallback, useEffect, useState } from 'react';
import type { ShopProduct } from '@serva/core';

/**
 * The shop's cart (26 › رحلة الزبون: «السلة محفوظة على جهازه»): kept in this browser for this
 * shop's link only, so it survives closing the page. Its prices are what the page showed; the
 * server prices the order again when it is sent.
 */

export interface ShopCartLine {
  variantId: string;
  productId: string;
  name: string;
  label: string | null;
  imageUrl: string | null;
  priceMinor: number;
  qty: number;
}

export const MAX_QTY = 50;
const keyOf = (slug: string) => `serva-shop-cart:${slug}`;

function read(slug: string): ShopCartLine[] {
  try {
    const raw = localStorage.getItem(keyOf(slug));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? (list as ShopCartLine[]).filter((l) => l && typeof l.variantId === 'string')
      : [];
  } catch {
    return [];
  }
}

function write(slug: string, lines: ShopCartLine[]) {
  try {
    localStorage.setItem(keyOf(slug), JSON.stringify(lines));
  } catch {
    // A private window without storage: the cart lives until the page closes
  }
}

/** Adds a piece, or more of it when it is already in the cart (at most MAX_QTY). */
export function addLine(lines: readonly ShopCartLine[], line: ShopCartLine): ShopCartLine[] {
  const at = lines.findIndex((l) => l.variantId === line.variantId);
  if (at < 0) return [...lines, { ...line, qty: Math.min(MAX_QTY, line.qty) }];
  return lines.map((l, i) => (i === at ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty) } : l));
}

export const cartTotal = (lines: readonly ShopCartLine[]) =>
  lines.reduce((n, l) => n + l.priceMinor * l.qty, 0);
export const cartCount = (lines: readonly ShopCartLine[]) => lines.reduce((n, l) => n + l.qty, 0);

export function useShopCart(slug: string) {
  const [lines, setLines] = useState<ShopCartLine[]>(() => read(slug));
  useEffect(() => setLines(read(slug)), [slug]);
  const update = useCallback(
    (next: (lines: ShopCartLine[]) => ShopCartLine[]) =>
      setLines((current) => {
        const value = next(current);
        write(slug, value);
        return value;
      }),
    [slug],
  );
  return {
    lines,
    add: (line: ShopCartLine) => update((l) => addLine(l, line)),
    setQty: (variantId: string, qty: number) =>
      update((l) =>
        qty <= 0
          ? l.filter((x) => x.variantId !== variantId)
          : l.map((x) => (x.variantId === variantId ? { ...x, qty: Math.min(MAX_QTY, qty) } : x)),
      ),
    clear: () => update(() => []),
  };
}

type Variant = ShopProduct['variants'][number];

/** The piece the chosen values name, when every option has one. */
export function variantFor(product: ShopProduct, chosen: Record<string, string>): Variant | null {
  if (product.options.some((o) => !chosen[o.name])) return null;
  return (
    product.variants.find((v) => v.attributes.every((a) => chosen[a.name] === a.value)) ??
    (product.options.length === 0 ? (product.variants[0] ?? null) : null)
  );
}

/**
 * Whether a value can be chosen at all: some piece, on the shelf or run out, has it together with the
 * values already chosen. A piece that ran out can be chosen to leave a phone (أبلغني عند التوفر).
 */
export function canChoose(
  product: ShopProduct,
  chosen: Record<string, string>,
  option: string,
  value: string,
): boolean {
  return product.variants.some(
    (v) =>
      v.attributes.some((a) => a.name === option && a.value === value) &&
      v.attributes.every((a) => a.name === option || !chosen[a.name] || chosen[a.name] === a.value),
  );
}

/**
 * Whether a value can still be picked: some piece on the shelf has it together with the values
 * already chosen for the other options.
 */
export function canPick(
  product: ShopProduct,
  chosen: Record<string, string>,
  option: string,
  value: string,
): boolean {
  return product.variants.some(
    (v) =>
      v.available &&
      v.attributes.some((a) => a.name === option && a.value === value) &&
      v.attributes.every((a) => a.name === option || !chosen[a.name] || chosen[a.name] === a.value),
  );
}
