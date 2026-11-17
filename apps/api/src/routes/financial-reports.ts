import type { FastifyInstance } from 'fastify';
import {
  accountLedgerQuery,
  balanceSheetQuery,
  cashFlowQuery,
  supplierAgeingQuery,
  taxReportQuery,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import {
  accountLedger,
  balanceSheet,
  cashFlow,
  supplierAgeing,
  taxReport,
} from '../services/financial-reports';
import { parseBody } from './validation';

/**
 * The financial statements (packages/core › contracts/financial-reports.ts): the balance sheet, the
 * cash flow, an account's ledger, the tax report and the suppliers' ageing. Read-only; each service
 * checks its permission and the branches the caller holds it in.
 */
export async function financialReportRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: requireAuth };

  app.get('/v1/reports/balance-sheet', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return balanceSheet(app.db, request.auth, parseBody(balanceSheetQuery, request.query));
  });

  app.get('/v1/reports/cash-flow', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return cashFlow(app.db, request.auth, parseBody(cashFlowQuery, request.query));
  });

  app.get('/v1/reports/account-ledger', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return accountLedger(app.db, request.auth, parseBody(accountLedgerQuery, request.query));
  });

  app.get('/v1/reports/tax', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return taxReport(app.db, request.auth, parseBody(taxReportQuery, request.query));
  });

  app.get('/v1/reports/supplier-ageing', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return supplierAgeing(app.db, request.auth, parseBody(supplierAgeingQuery, request.query));
  });
}
