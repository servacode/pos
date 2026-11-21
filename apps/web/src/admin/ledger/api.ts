import type {
  ExpenseInput,
  ExpenseListResponse,
  ExpenseRow,
  ManualEntryInput,
  ManualEntryRow,
  PartyStatement,
  ProfitLoss,
} from '@serva/core';
import { apiFetch } from '../../lib/api';
import { withQuery } from '../reports/api';

/** The statements, expenses, manual entries and profit and loss requests (contracts/ledger-docs.ts). */

/** `GET /v1/customers/{id}/statement` (customers.view) and `/v1/suppliers/{id}/statement` (purchases.manage) */
export const getStatement = (
  type: 'customer' | 'supplier',
  id: string,
  query: { from: string; to: string },
) =>
  apiFetch<PartyStatement>(
    withQuery(`/v1/${type === 'customer' ? 'customers' : 'suppliers'}/${id}/statement`, query),
    {
      auth: true,
    },
  );

/** `GET /v1/expenses` (expenses.manage) */
export const listExpenses = (query: {
  from: string;
  to: string;
  branchId: string | null;
  accountCode: string | null;
  cursor?: string | null;
}) => apiFetch<ExpenseListResponse>(withQuery('/v1/expenses', { ...query, limit: '200' }), { auth: true });

/** `POST /v1/expenses` (expenses.manage) */
export const createExpense = (input: ExpenseInput) =>
  apiFetch<ExpenseRow>('/v1/expenses', { method: 'POST', body: input, auth: true });

/** `POST /v1/expenses/{id}/void` (expenses.manage) */
export const voidExpense = (id: string, reason: string) =>
  apiFetch<ExpenseRow>(`/v1/expenses/${id}/void`, { method: 'POST', body: { reason }, auth: true });

/** `POST /v1/journal/manual` (accounting.post) */
export const createManualEntry = (input: ManualEntryInput) =>
  apiFetch<ManualEntryRow>('/v1/journal/manual', { method: 'POST', body: input, auth: true });

/** `POST /v1/journal/{id}/reverse` (accounting.post) */
export const reverseEntry = (id: string, reason: string) =>
  apiFetch<ManualEntryRow>(`/v1/journal/${id}/reverse`, { method: 'POST', body: { reason }, auth: true });

/** `GET /v1/reports/profit-loss` (accounting.view) */
export const getProfitLoss = (query: { from: string; to: string; branchId: string | null }) =>
  apiFetch<ProfitLoss>(withQuery('/v1/reports/profit-loss', query), { auth: true });
