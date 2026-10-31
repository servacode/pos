import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import {
  barcodeCodeSchema,
  createCategoryInput,
  createProductInput,
  createTaxRateInput,
  createUnitInput,
  productListQuery,
  updateCategoryInput,
  updateProductInput,
  updateTaxRateInput,
  updateUnitInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { fieldError, notFound, type CatalogContext } from '../services/catalog/common';
import {
  createProduct,
  getProduct,
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

  app.get('/v1/barcodes/:code', signedIn, async (request) => {
    const code = barcodeCodeSchema.safeParse((request.params as { code?: string }).code);
    if (!code.success) throw fieldError('code', code.error.issues[0]?.message ?? 'الباركود غير صالح');
    return lookupBarcode(db, code.data, ctxOf(request));
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
  app.patch('/v1/tax-rates/:id', signedIn, async (request) => {
    const id = idOf(request, 'هذه الضريبة غير موجودة.');
    return updateTaxRate(db, id, parseCatalog(updateTaxRateInput, request.body), ctxOf(request));
  });
}
