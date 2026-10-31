import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  dayReportQuery,
  journalQuery,
  shiftListQuery,
  syncEvidenceQuery,
  trialBalanceQuery,
  type AccountListResponse,
  type DayReport,
  type JournalPage,
  type ShiftListResponse,
  type ShiftReport,
  type SyncEvidence,
  type TrialBalance,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import type { AccessClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import {
  dayReport,
  journal,
  listAccounts,
  listShifts,
  shiftReport,
  syncEvidence,
  trialBalance,
} from '../services/reports';
import { parseBody } from './validation';

const authOf = (request: FastifyRequest): AccessClaims => {
  if (!request.auth) throw unauthorized();
  return request.auth;
};

const uuid = z.uuid();

/**
 * The accounting and report routes of phase 1, exactly as packages/core › contracts/accounting.ts
 * lists them. Read-only; every one needs a signed-in user with the route's permission.
 */
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const signedIn = { preHandler: requireAuth };

  app.get('/v1/accounts', signedIn, async (request): Promise<AccountListResponse> =>
    listAccounts(db, authOf(request)),
  );

  app.get('/v1/reports/day', signedIn, async (request): Promise<DayReport> =>
    dayReport(db, authOf(request), parseBody(dayReportQuery, request.query)),
  );

  app.get('/v1/shifts', signedIn, async (request): Promise<ShiftListResponse> =>
    listShifts(db, authOf(request), parseBody(shiftListQuery, request.query)),
  );

  app.get('/v1/shifts/:id', signedIn, async (request): Promise<ShiftReport> => {
    const id = uuid.safeParse((request.params as { id?: string }).id);
    if (!id.success) throw new AppError(404, 'not_found', 'هذه الوردية غير موجودة.');
    return shiftReport(db, authOf(request), id.data);
  });

  app.get('/v1/journal', signedIn, async (request): Promise<JournalPage> =>
    journal(db, authOf(request), parseBody(journalQuery, request.query)),
  );

  app.get('/v1/reports/trial-balance', signedIn, async (request): Promise<TrialBalance> =>
    trialBalance(db, authOf(request), parseBody(trialBalanceQuery, request.query)),
  );

  app.get('/v1/sync/evidence', signedIn, async (request): Promise<SyncEvidence> =>
    syncEvidence(db, authOf(request), parseBody(syncEvidenceQuery, request.query)),
  );
}
