import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  MAX_THUMB_BYTES,
  type ImageType,
  type ProductImage,
  type ProductImagesResponse,
  type productImageInput,
  type productImageOrder,
  type productImagePatch,
} from '@serva/core';
import { productImages, products, uploads, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import { audit } from '../audit';
import {
  fieldError,
  notFound,
  requireCatalogManager,
  requireCatalogReader,
  staleVersion,
  type CatalogContext,
} from './common';

/**
 * Product pictures (03 › الألبسة: صور القطع; contracts/catalog.ts). Kept in the database with their
 * thumbnail, so the backup and the restore carry them; served without sign-in by the store's id and
 * the picture's id, for the dashboard and the shop's public pages alike.
 */

const PRODUCT = 'هذا المنتج غير موجود.';
const IMAGE = 'هذه الصورة غير موجودة.';

/** The format the first bytes say, or null (no regex: the bytes are binary). */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const at = (i: number, ...expected: number[]) => expected.every((b, k) => bytes[i + k] === b);
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    return 'image/webp';
  return null;
}

export const imageUrl = (tenantId: string, uploadId: string, thumb = false) =>
  `/v1/images/${tenantId}/${uploadId}${thumb ? '?size=thumb' : ''}`;

async function requireProduct(tx: Transaction, tenantId: string, productId: string) {
  const [row] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  if (!row) throw notFound(PRODUCT);
}

/** The tills pull a piece's picture with the piece: touching its pieces sends them again. */
async function touchPieces(tx: Transaction, tenantId: string, productId: string) {
  await tx.execute(
    sql`update variants set updated_at = now() where tenant_id = ${tenantId} and product_id = ${productId}`,
  );
}

async function listOf(tx: Transaction, tenantId: string, productId: string): Promise<ProductImage[]> {
  const rows = await tx
    .select({
      id: productImages.id,
      uploadId: productImages.uploadId,
      optionValue: productImages.optionValue,
      sortOrder: productImages.sortOrder,
      version: productImages.version,
      width: uploads.width,
      height: uploads.height,
    })
    .from(productImages)
    .innerJoin(
      uploads,
      and(eq(uploads.tenantId, productImages.tenantId), eq(uploads.id, productImages.uploadId)),
    )
    .where(and(eq(productImages.tenantId, tenantId), eq(productImages.productId, productId)))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt), asc(productImages.id));
  return rows.map((r) => ({
    ...r,
    url: imageUrl(tenantId, r.uploadId),
    thumbUrl: imageUrl(tenantId, r.uploadId, true),
  }));
}

export function listProductImages(
  db: Database,
  productId: string,
  ctx: CatalogContext,
): Promise<ProductImagesResponse> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    await requireProduct(tx, ctx.auth.tenantId, productId);
    return { items: await listOf(tx, ctx.auth.tenantId, productId) };
  });
}

export function addProductImage(
  db: Database,
  productId: string,
  input: z.output<typeof productImageInput>,
  ctx: CatalogContext,
): Promise<ProductImage> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    await requireProduct(tx, tenantId, productId);
    const data = Buffer.from(input.data, 'base64');
    const thumb = Buffer.from(input.thumb, 'base64');
    if (data.length > MAX_IMAGE_BYTES) throw fieldError('data', 'الصورة أكبر من المسموح');
    if (thumb.length > MAX_THUMB_BYTES) throw fieldError('thumb', 'الصورة المصغّرة أكبر من المسموح');
    if (sniffImage(data) !== input.contentType || sniffImage(thumb) !== input.contentType) {
      throw fieldError('data', 'هذا الملف ليس صورة. اختر صورة JPG أو PNG أو WebP.');
    }
    const existing = await listOf(tx, tenantId, productId);
    if (existing.length >= MAX_PRODUCT_IMAGES) {
      throw fieldError('data', `للمنتج ${MAX_PRODUCT_IMAGES} صورة، وهذا الحد. احذف صورة لتضيف غيرها.`);
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    // The same picture sent twice is kept once
    const [same] = await tx
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.tenantId, tenantId), eq(uploads.sha256, sha256)))
      .limit(1);
    let uploadId = same?.id;
    if (!uploadId) {
      const [made] = await tx
        .insert(uploads)
        .values({
          tenantId,
          kind: 'product_image',
          contentType: input.contentType,
          sha256,
          width: input.width,
          height: input.height,
          data,
          thumb,
          createdBy: userId,
        })
        .returning({ id: uploads.id });
      uploadId = made!.id;
    }
    const already = existing.find((i) => i.uploadId === uploadId);
    if (already) return already;
    const [row] = await tx
      .insert(productImages)
      .values({
        tenantId,
        productId,
        uploadId,
        optionValue: input.optionValue,
        sortOrder: existing.reduce((max, i) => Math.max(max, i.sortOrder + 1), 0),
      })
      .returning({ id: productImages.id });
    await audit(
      tx,
      {
        tenantId,
        userId,
        action: 'product.image_added',
        entity: 'product',
        entityId: productId,
        data: { imageId: row!.id, bytes: data.length },
      },
      ctx.meta,
    );
    await touchPieces(tx, tenantId, productId);
    return (await listOf(tx, tenantId, productId)).find((i) => i.id === row!.id)!;
  });
}

export function updateProductImage(
  db: Database,
  productId: string,
  imageId: string,
  input: z.output<typeof productImagePatch>,
  ctx: CatalogContext,
): Promise<ProductImage> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    const [row] = await tx
      .update(productImages)
      .set({ optionValue: input.optionValue, updatedAt: sql`now()` })
      .where(
        and(
          eq(productImages.tenantId, tenantId),
          eq(productImages.productId, productId),
          eq(productImages.id, imageId),
          eq(productImages.version, input.version),
        ),
      )
      .returning({ id: productImages.id });
    if (!row) {
      const items = await listOf(tx, tenantId, productId);
      throw items.some((i) => i.id === imageId) ? staleVersion() : notFound(IMAGE);
    }
    await touchPieces(tx, tenantId, productId);
    return (await listOf(tx, tenantId, productId)).find((i) => i.id === imageId)!;
  });
}

export function deleteProductImage(
  db: Database,
  productId: string,
  imageId: string,
  ctx: CatalogContext,
): Promise<void> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    const gone = await tx
      .delete(productImages)
      .where(
        and(
          eq(productImages.tenantId, tenantId),
          eq(productImages.productId, productId),
          eq(productImages.id, imageId),
        ),
      )
      .returning({ id: productImages.id });
    if (gone.length === 0) throw notFound(IMAGE);
    await touchPieces(tx, tenantId, productId);
    await audit(
      tx,
      {
        tenantId,
        userId,
        action: 'product.image_removed',
        entity: 'product',
        entityId: productId,
        data: { imageId },
      },
      ctx.meta,
    );
  });
}

/** The pictures in the order given; the first is the product's main picture. */
export function orderProductImages(
  db: Database,
  productId: string,
  input: z.output<typeof productImageOrder>,
  ctx: CatalogContext,
): Promise<ProductImagesResponse> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    await requireProduct(tx, tenantId, productId);
    const items = await listOf(tx, tenantId, productId);
    const known = new Set(items.map((i) => i.id));
    if (
      input.ids.length !== items.length ||
      input.ids.some((id) => !known.has(id)) ||
      new Set(input.ids).size !== input.ids.length
    ) {
      throw fieldError('ids', 'رتّب كل صور المنتج، كل صورة مرة واحدة.');
    }
    for (const [index, id] of input.ids.entries()) {
      await tx
        .update(productImages)
        .set({ sortOrder: index, updatedAt: sql`now()` })
        .where(and(eq(productImages.tenantId, tenantId), eq(productImages.id, id)));
    }
    await touchPieces(tx, tenantId, productId);
    return { items: await listOf(tx, tenantId, productId) };
  });
}

/** A picture's bytes, by the store's id and its own; null when there is none. */
export function readImage(
  db: Database,
  tenantId: string,
  uploadId: string,
  thumb: boolean,
): Promise<{ contentType: string; body: Buffer } | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ contentType: uploads.contentType, data: thumb ? uploads.thumb : uploads.data })
      .from(uploads)
      .where(and(eq(uploads.tenantId, tenantId), eq(uploads.id, uploadId)));
    return row ? { contentType: row.contentType, body: row.data } : null;
  });
}
