import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  contractPriceInput,
  contractPriceListQuery,
  contractPriceUpdateInput,
  isoDateSchema,
  maintenanceInput,
  maintenanceListQuery,
  maintenanceVisitInput,
  priceListSheetQuery,
  rentableUnitQuery,
  rentalInput,
  rentalListQuery,
  rentalReturnInput,
  tillContractPriceQuery,
  uuidSchema,
  versionInput,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import {
  contractPricesForTill,
  createContractPrice,
  deleteContractPrice,
  listContractPrices,
  priceListSheet,
  updateContractPrice,
} from '../services/contract-prices';
import { debtAgeing } from '../services/debt-ageing';
import {
  createContract,
  listContracts,
  listUnbilledContracts,
  logVisit,
  markBilled,
  renewContract,
} from '../services/maintenance';
import {
  createRental,
  listRentalsForAdmin,
  listRentalsForDevice,
  rentableUnits,
  returnRental,
} from '../services/rentals';
import { parseBody } from './validation';

/**
 * Rentals, maintenance contracts, contract prices and debt ageing (03 › الأدوات الطبية, 10 › الذمم):
 * packages/core › contracts/rentals.ts, maintenance.ts, contract-prices.ts, ageing.ts.
 */
export async function contractRoutes(app: FastifyInstance): Promise<void> {
  const idOf = (params: unknown, message: string) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', message);
    return parsed.data;
  };

  // ─── Rentals ─────────────────────────────────────────────────────────────
  app.get('/v1/device/rentals', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return listRentalsForDevice(app.db, request.device, parseBody(rentalListQuery, request.query).status);
  });
  app.get('/v1/device/rentals/units', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return rentableUnits(app.db, request.device, parseBody(rentableUnitQuery, request.query).q);
  });
  app.post('/v1/device/rentals', { onRequest: requireDevice({ write: true }) }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const made = await createRental(app.db, request.device, parseBody(rentalInput, request.body));
    return reply.status(201).send(made);
  });
  app.post(
    '/v1/device/rentals/:id/return',
    { onRequest: requireDevice({ write: true }) },
    async (request) => {
      if (!request.device) throw unauthorized();
      return returnRental(
        app.db,
        request.device,
        idOf(request.params, 'هذا التأجير غير موجود.'),
        parseBody(rentalReturnInput, request.body).version,
      );
    },
  );
  app.get('/v1/rentals', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listRentalsForAdmin(app.db, request.auth, parseBody(rentalListQuery, request.query).status);
  });

  // ─── Maintenance contracts ───────────────────────────────────────────────
  const noContract = 'هذا العقد غير موجود.';
  app.get('/v1/maintenance', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listContracts(app.db, request.auth, parseBody(maintenanceListQuery, request.query).view);
  });
  app.post('/v1/maintenance', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createContract(app.db, request.auth, parseBody(maintenanceInput, request.body));
    return reply.status(201).send(made);
  });
  app.post('/v1/maintenance/:id/visits', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return logVisit(
      app.db,
      request.auth,
      idOf(request.params, noContract),
      parseBody(maintenanceVisitInput, request.body),
    );
  });
  app.post('/v1/maintenance/:id/renew', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await renewContract(
      app.db,
      request.auth,
      idOf(request.params, noContract),
      parseBody(versionInput, request.body).version,
    );
    return reply.status(201).send(made);
  });
  app.get('/v1/device/maintenance', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return listUnbilledContracts(app.db, request.device);
  });
  app.post(
    '/v1/device/maintenance/:id/billed',
    { onRequest: requireDevice({ write: true }) },
    async (request) => {
      if (!request.device) throw unauthorized();
      return markBilled(
        app.db,
        request.device,
        idOf(request.params, noContract),
        parseBody(versionInput, request.body).version,
      );
    },
  );

  // ─── Contract prices ─────────────────────────────────────────────────────
  const noPrice = 'هذا السعر غير موجود.';
  app.get('/v1/contract-prices', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listContractPrices(app.db, request.auth, parseBody(contractPriceListQuery, request.query));
  });
  app.get('/v1/contract-prices/price-list', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return priceListSheet(app.db, request.auth, parseBody(priceListSheetQuery, request.query));
  });
  app.post('/v1/contract-prices', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createContractPrice(app.db, request.auth, parseBody(contractPriceInput, request.body));
    return reply.status(201).send(made);
  });
  app.put('/v1/contract-prices/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateContractPrice(
      app.db,
      request.auth,
      idOf(request.params, noPrice),
      parseBody(contractPriceUpdateInput, request.body),
    );
  });
  app.delete('/v1/contract-prices/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    await deleteContractPrice(app.db, request.auth, idOf(request.params, noPrice));
    return reply.status(204).send();
  });
  app.get('/v1/device/contract-prices', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return contractPricesForTill(
      app.db,
      request.device,
      parseBody(tillContractPriceQuery, request.query).customerId,
    );
  });

  // ─── Debt ageing ─────────────────────────────────────────────────────────
  app.get('/v1/reports/debt-ageing', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return debtAgeing(
      app.db,
      request.auth,
      parseBody(z.object({ asOf: isoDateSchema.optional() }), request.query).asOf,
    );
  });
}
