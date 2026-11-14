import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import {
  barcodeCodeSchema,
  bulkPriceInput,
  createCategoryInput,
  createProductInput,
  createTaxRateInput,
  defaultTaxRateInput,
  createUnitInput,
  priceListApplyInput,
  priceListPreviewInput,
  productImageInput,
  productImageOrder,
  productImagePatch,
  productListQuery,
  updateCategoryInput,
  updateProductInput,
  updateTaxRateInput,
  updateUnitInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { bulkPrices } from '../services/catalog/bulk-prices';
import { applyPriceList, previewPriceList } from '../services/catalog/price-list';
import {
  addProductImage,
  deleteProductImage,
  listProductImages,
  orderProductImages,
  readImage,
  updateProductImage,
} from '../services/catalog/images';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { fieldError, notFound, type CatalogContext } from '../services/catalog/common';
import {
  createProduct,
  getProduct,
  listOptionValues,
  listProducts,
  lookupBarcode,
  setProductArchived,
  updateProduct,
} from '../services/catalog/products';
import {
  createCategory,
  createTaxRate,
  createUnit,
  listCategories,
  listTaxRates,
  listUnits,
  updateCategory,
  setDefaultTaxRate,
  updateTaxRate,
  updateUnit,
} from '../services/catalog/reference';

/**
 * Catalog validation errors name the exact field: the top-level key (as every route) and, for a
 * nested one, its dotted path too («variants.0.barcodes.1.code»), so the product card can mark it.
 */
function parseCatalog<T extends ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String);
    fields[path[0] ?? '_'] ??= issue.message;
    if (path.length > 1) fields[path.join('.')] ??= issue.message;
  }
  throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);
}

const uuid = z.uuid();

/** An id that is not a UUID cannot exist: 404 like any other unknown record. */
const idOf = (request: FastifyRequest, message: string): string => {
  const parsed = uuid.safeParse((request.params as { id?: string }).id);
  if (!parsed.success) throw notFound(message);
  return parsed.data;
};

/** The catalog routes of 17 › المنتجات, exactly as packages/core › contracts/catalog.ts lists them. */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const { db, clock } = app;
  const ctxOf = (request: FastifyRequest): CatalogContext => {
    if (!request.auth) throw unauthorized();
    return {
      auth: request.auth,
      now: clock.now(),
      meta: { ip: clientIp(request), userAgent: request.headers['user-agent']?.slice(0, 300) ?? null },
    };
  };
  const signedIn = { preHandler: requireAuth };
  const PRODUCT = 'هذا المنتج غير موجود.';

  // ─── Products ──────────────────────────────────────────────────────────────
  app.get('/v1/products', signedIn, async (request) =>
    listProducts(db, parseCatalog(productListQuery, request.query), ctxOf(request)),
  );
  app.post('/v1/products', signedIn, async (request, reply) => {
    const input = parseCatalog(createProductInput, request.body);
    return reply.status(201).send(await createProduct(db, input, ctxOf(request)));
  });
  app.get('/v1/products/options', signedIn, async (request) => listOptionValues(db, ctxOf(request)));
  app.get('/v1/products/:id', signedIn, async (request) =>
    getProduct(db, idOf(request, PRODUCT), ctxOf(request)),
  );
  app.patch('/v1/products/:id', signedIn, async (request) => {
    const id = idOf(request, PRODUCT);
    return updateProduct(db, id, parseCatalog(updateProductInput, request.body), ctxOf(request));
  });
  app.post('/v1/products/:id/archive', signedIn, async (request) =>
    setProductArchived(db, idOf(request, PRODUCT), true, ctxOf(request)),
  );
  app.post('/v1/products/:id/restore', signedIn, async (request) =>
    setProductArchived(db, idOf(request, PRODUCT), false, ctxOf(request)),
  );

  // ─── Product pictures ──────────────────────────────────────────────────────
  const IMAGE = 'هذه الصورة غير موجودة.';
  const imageIdOf = (request: FastifyRequest) => {
    const parsed = uuid.safeParse((request.params as { imageId?: string }).imageId);
    if (!parsed.success) throw notFound(IMAGE);
    return parsed.data;
  };
  app.get('/v1/products/:id/images', signedIn, async (request) =>
    listProductImages(db, idOf(request, PRODUCT), ctxOf(request)),
  );
  app.post('/v1/products/:id/images', { ...signedIn, bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const input = parseCatalog(productImageInput, request.body);
    return reply.status(201).send(await addProductImage(db, idOf(request, PRODUCT), input, ctxOf(request)));
  });
  app.post('/v1/products/:id/images/order', signedIn, async (request) =>
    orderProductImages(
      db,
      idOf(request, PRODUCT),
      parseCatalog(productImageOrder, request.body),
      ctxOf(request),
    ),
  );
  app.patch('/v1/products/:id/images/:imageId', signedIn, async (request) =>
    updateProductImage(
      db,
      idOf(request, PRODUCT),
      imageIdOf(request),
      parseCatalog(productImagePatch, request.body),
      ctxOf(request),
    ),
  );
  app.delete('/v1/products/:id/images/:imageId', signedIn, async (request, reply) => {
    await deleteProductImage(db, idOf(request, PRODUCT), imageIdOf(request), ctxOf(request));
    return reply.status(204).send();
  });
  // Public: the dashboard's <img> carries no token, and the shop's own pages show them to anyone
  app.get('/v1/images/:tenantId/:imageId', async (request, reply) => {
    const tenant = uuid.safeParse((request.params as { tenantId?: string }).tenantId);
    if (!tenant.success) throw notFound(IMAGE);
    const thumb = (request.query as { size?: string }).size === 'thumb';
    const image = await readImage(db, tenant.data, imageIdOf(request), thumb);
    if (!image) throw notFound(IMAGE);
    return reply
      .header('content-type', image.contentType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(image.body);
  });

  app.post('/v1/prices/bulk', signedIn, async (request) =>
    bulkPrices(db, parseCatalog(bulkPriceInput, request.body), ctxOf(request)),
  );

  // «تحديث الأسعار من ملف»: 5,000 rows of a price list are a megabyte or two
  const priceList = { preHandler: requireAuth, bodyLimit: 4 * 1024 * 1024 };
  app.post('/v1/prices/list/preview', priceList, async (request) =>
    previewPriceList(db, parseCatalog(priceListPreviewInput, request.body), ctxOf(request)),
  );
  app.post('/v1/prices/list/apply', priceList, async (request) =>
    applyPriceList(db, parseCatalog(priceListApplyInput, request.body), ctxOf(request)),
  );

  app.get('/v1/barcodes/:code', signedIn, async (request) => {
    const code = barcodeCodeSchema.safeParse((request.params as { code?: string }).code);
    if (!code.success) throw fieldError('code', code.error.issues[0]?.message ?? 'الباركود غير صالح');
    // ?free=1: a code nobody has answers 200 {exists:false} instead of 404 (the product form asks for every new code)
    const soft = (request.query as { free?: string } | undefined)?.free === '1';
    return lookupBarcode(db, code.data, ctxOf(request), soft);
  });

  // ─── Categories, units, tax rates ──────────────────────────────────────────
  app.get('/v1/categories', signedIn, async (request) => listCategories(db, ctxOf(request)));
  app.post('/v1/categories', signedIn, async (request, reply) => {
    const input = parseCatalog(createCategoryInput, request.body);
    return reply.status(201).send(await createCategory(db, input, ctxOf(request)));
  });
  app.patch('/v1/categories/:id', signedIn, async (request) => {
    const id = idOf(request, 'هذا التصنيف غير موجود.');
    return updateCategory(db, id, parseCatalog(updateCategoryInput, request.body), ctxOf(request));
  });

  app.get('/v1/units', signedIn, async (request) => listUnits(db, ctxOf(request)));
  app.post('/v1/units', signedIn, async (request, reply) => {
    const input = parseCatalog(createUnitInput, request.body);
    return reply.status(201).send(await createUnit(db, input, ctxOf(request)));
  });
  app.patch('/v1/units/:id', signedIn, async (request) => {
    const id = idOf(request, 'هذه الوحدة غير موجودة.');
    return updateUnit(db, id, parseCatalog(updateUnitInput, request.body), ctxOf(request));
  });

  app.get('/v1/tax-rates', signedIn, async (request) => listTaxRates(db, ctxOf(request)));
  app.post('/v1/tax-rates', signedIn, async (request, reply) => {
    const input = parseCatalog(createTaxRateInput, request.body);
    return reply.status(201).send(await createTaxRate(db, input, ctxOf(request)));
  });
  app.put('/v1/tax-rates/default', signedIn, async (request) =>
    setDefaultTaxRate(db, parseCatalog(defaultTaxRateInput, request.body), ctxOf(request)),
  );
  app.patch('/v1/tax-rates/:id', signedIn, async (request) => {
    const id = idOf(request, 'هذه الضريبة غير موجودة.');
    return updateTaxRate(db, id, parseCatalog(updateTaxRateInput, request.body), ctxOf(request));
  });
}
