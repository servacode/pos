import type { FastifyInstance } from 'fastify';
import { foodCostQuery, recipeInput, uuidSchema } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { foodCostReport, getRecipe, putRecipe } from '../services/recipes';
import { parseBody } from './validation';

/** Recipes and the food-cost report (packages/core › contracts/recipes.ts). */
export async function recipeRoutes(app: FastifyInstance): Promise<void> {
  const productOf = (params: unknown): string => {
    const parsed = uuidSchema.safeParse((params as { productId?: string }).productId);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا الصنف غير موجود.');
    return parsed.data;
  };
  app.get('/v1/recipes/:productId', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return getRecipe(app.db, request.auth, productOf(request.params));
  });
  app.put('/v1/recipes/:productId', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return putRecipe(app.db, request.auth, productOf(request.params), parseBody(recipeInput, request.body));
  });
  app.get('/v1/reports/food-cost', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return foodCostReport(app.db, request.auth, parseBody(foodCostQuery, request.query));
  });
}
