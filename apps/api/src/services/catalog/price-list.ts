import { sql } from 'drizzle-orm';
import {
  barcodeCell,
  normalizeArabic,
  type CurrencyCode,
  type PriceListApplied,
  type PriceListItem,
  type PriceListPreview,
  type priceListApplyInput,
  type priceListPreviewInput,
} from '@serva/core';
import { auditLogs, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import { audit } from '../audit';
import { requireCatalogManager, type CatalogContext } from './common';

/**
 * «تحديث الأسعار من ملف» (03 › الصيدلية: نشرة أسعار الوزارة; contract in core › contracts/price-list.ts).
 * The preview matches the rows of the file to pieces and changes nothing; the apply sets the chosen
 * prices in one transaction the way a manual price edit does, so the tills pull them, and logs each.
 */

interface Piece {
  productId: string;
  variantId: string;
  name: string;
  currency: string;
  price: number;
}

type PieceRow = {
  product_id: string;
  variant_id: string;
  name: string;
  currency: string;
  price: string;
  name_ar: string;
  name_en: string | null;
  generic_name: string | null;
};

const live = sql`
  select p.id as product_id, v.id as variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
         pr.currency, pr.price_minor::text as price, p.name_ar, p.name_en, p.generic_name
  from products p
  join variants v on v.product_id = p.id and v.archived_at is null
  join prices pr on pr.id = v.id
  where p.archived_at is null`;

const pieceOf = (r: PieceRow): Piece => ({
  productId: r.product_id,
  variantId: r.variant_id,
  name: r.name,
  currency: r.currency,
  price: Number(r.price),
});

async function baseCurrency(tx: Transaction): Promise<string> {
  const [settings] = await tx.execute<{ base: string }>(
    sql`select base_currency as base from tenant_settings`,
  );
  return settings?.base ?? 'SYP';
}

const inList = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

const stripZeros = (code: string) => code.replace(/^0+/, '');

/** The pieces whose piece barcode is one of `codes` (a code Excel dropped leading zeros from too). */
async function byBarcode(tx: Transaction, codes: readonly string[]): Promise<Map<string, Piece>> {
  const found = new Map<string, Piece>();
  if (codes.length === 0) return found;
  const stripped = [...new Set(codes.map(stripZeros).filter((c) => c !== ''))];
  const hits = await tx.execute<PieceRow & { code: string }>(sql`
    select l.*, b.code from (${live}) l
    join barcodes b on b.variant_id = l.variant_id and b.pack_qty = 1000
    where b.code in (${inList(codes)})${stripped.length > 0 ? sql` or ltrim(b.code, '0') in (${inList(stripped)})` : sql``}`);
  const exact = new Set(codes);
  for (const hit of hits) {
    // A code typed in full wins over the same code without its zeros
    if (exact.has(hit.code)) found.set(hit.code, pieceOf(hit));
  }
  for (const hit of hits) {
    const key = stripZeros(hit.code);
    for (const code of codes) {
      if (!found.has(code) && stripZeros(code) === key) found.set(code, pieceOf(hit));
    }
  }
  return found;
}

type Index = Map<string, Map<string, Piece>>;

function addTo(index: Index, text: string | null, piece: Piece): void {
  const key = text ? normalizeArabic(text) : '';
  if (key === '') return;
  const bucket = index.get(key) ?? new Map<string, Piece>();
  bucket.set(piece.variantId, piece);
  index.set(key, bucket);
}

/** The live pieces by the name of their product (Arabic or trade name) and by its scientific name. */
async function nameIndexes(tx: Transaction): Promise<{ names: Index; generics: Index }> {
  const names: Index = new Map();
  const generics: Index = new Map();
  const rows = await tx.execute<PieceRow>(sql`${live} limit 200000`);
  for (const r of rows) {
    const piece = pieceOf(r);
    addTo(names, r.name_ar, piece);
    addTo(names, r.name_en, piece);
    addTo(generics, r.generic_name, piece);
  }
  return { names, generics };
}

type Lookup = { piece: Piece } | { ambiguous: true } | null;

function lookup(texts: readonly string[], indexes: readonly Index[]): Lookup {
  let ambiguous = false;
  for (const index of indexes) {
    for (const text of texts) {
      const bucket = index.get(normalizeArabic(text));
      if (!bucket) continue;
      if (bucket.size === 1) return { piece: [...bucket.values()][0]! };
      ambiguous = true;
    }
  }
  return ambiguous ? { ambiguous: true } : null;
}

export function previewPriceList(
  db: Database,
  input: z.output<typeof priceListPreviewInput>,
  ctx: CatalogContext,
): Promise<PriceListPreview> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogManager(tx, ctx.auth.userId);
    const base = await baseCurrency(tx);
    const codes = [...new Set(input.rows.map((r) => barcodeCell(r.barcode)).filter((c): c is string => !!c))];
    const byCode = await byBarcode(tx, codes);
    const needsName = input.rows.some((r) => {
      const code = barcodeCell(r.barcode);
      return !(code && byCode.has(code)) && (r.name || r.generic);
    });
    const indexes = needsName
      ? await nameIndexes(tx)
      : { names: new Map() as Index, generics: new Map() as Index };

    const seen = new Set<string>();
    const items = input.rows.map((r): PriceListItem => {
      const code = barcodeCell(r.barcode);
      const source = code ?? r.name ?? r.generic ?? '';
      const none = {
        row: r.row,
        source,
        matchedBy: null,
        productId: null,
        variantId: null,
        name: null,
        currency: null,
        oldMinor: null,
        newMinor: r.priceMinor,
      } as const;
      let piece = code ? byCode.get(code) : undefined;
      let matchedBy: 'barcode' | 'name' = 'barcode';
      if (!piece) {
        matchedBy = 'name';
        const texts = [r.name, r.generic].filter((t): t is string => !!t);
        const found = texts.length > 0 ? lookup(texts, [indexes.names, indexes.generics]) : null;
        if (found && 'ambiguous' in found) return { ...none, status: 'ambiguous' };
        piece = found?.piece;
      }
      if (!piece) return { ...none, status: 'unmatched' };
      const matched = {
        ...none,
        matchedBy,
        productId: piece.productId,
        variantId: piece.variantId,
        name: piece.name,
        currency: piece.currency as CurrencyCode,
        oldMinor: piece.price,
      };
      if (seen.has(piece.variantId)) return { ...matched, status: 'duplicate' };
      seen.add(piece.variantId);
      if (piece.currency !== base) return { ...matched, status: 'other_currency' };
      return { ...matched, status: piece.price === r.priceMinor ? 'same' : 'change' };
    });
    return { items };
  });
}

export function applyPriceList(
  db: Database,
  input: z.output<typeof priceListApplyInput>,
  ctx: CatalogContext,
): Promise<PriceListApplied> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    const base = await baseCurrency(tx);
    // The last price asked for a piece wins
    const wanted = new Map(input.changes.map((c) => [c.variantId, c.newMinor]));
    const ids = [...wanted.keys()];
    const rows = await tx.execute<PieceRow>(sql`
      select l.* from (${live}) l
      join prices pr on pr.id = l.variant_id
      where l.variant_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      order by l.variant_id
      for update of pr`);
    const items = rows.flatMap((r) => {
      const piece = pieceOf(r);
      const newMinor = wanted.get(piece.variantId)!;
      if (piece.currency !== base || piece.price === newMinor) return [];
      return [{ ...piece, currency: piece.currency as CurrencyCode, oldMinor: piece.price, newMinor }];
    });
    if (items.length > 0) {
      const values = sql.join(
        items.map((i) => sql`(${i.variantId}::uuid, ${i.newMinor}::bigint)`),
        sql`, `,
      );
      // The floor stays under the price, and a struck price the new one reaches ends its markdown
      await tx.execute(sql`
        update prices p set price_minor = v.n,
               min_price_minor = case when p.min_price_minor is null then null else least(p.min_price_minor, v.n) end,
               was_price_minor = case when p.was_price_minor <= v.n then null else p.was_price_minor end,
               price_changed_at = ${ctx.now.toISOString()}::timestamptz, updated_at = now()
        from (values ${values}) as v(id, n)
        where p.id = v.id`);
      // The product's version moves with its prices, as with any price edit
      const products = [...new Set(items.map((i) => i.productId))];
      await tx.execute(sql`
        update products set updated_at = now()
        where id in (${sql.join(
          products.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
      for (let at = 0; at < items.length; at += 1000) {
        await tx.insert(auditLogs).values(
          items.slice(at, at + 1000).map((i) => ({
            tenantId,
            userId,
            actorType: 'user',
            action: 'price.changed',
            entity: 'variant',
            entityId: i.variantId,
            changes: { priceMinor: [i.oldMinor, i.newMinor] },
            data: { source: 'price_list', productId: i.productId, fileName: input.fileName },
            ip: ctx.meta.ip,
            userAgent: ctx.meta.userAgent,
          })),
        );
      }
      await audit(
        tx,
        {
          tenantId,
          userId,
          action: 'prices.list_applied',
          entity: 'price_list',
          data: { fileName: input.fileName, pieces: items.length, skipped: ids.length - items.length },
        },
        ctx.meta,
      );
    }
    return {
      changed: items.length,
      skipped: ids.length - items.length,
      items: items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        name: i.name,
        currency: i.currency,
        oldMinor: i.oldMinor,
        newMinor: i.newMinor,
      })),
    };
  });
}
