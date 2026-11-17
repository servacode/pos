import type { AccountLedger, BalanceSheet, CashFlow, SupplierAgeingReport, TaxReport } from '@serva/core';
import { apiFetch } from '../../lib/api';
import { withQuery } from '../reports/api';

/** The financial statements' requests (contracts/financial-reports.ts); all read-only, accounting.view unless noted. */

export const getBalanceSheet = (query: { asOf: string; compareTo: string | null; branchId: string | null }) =>
  apiFetch<BalanceSheet>(withQuery('/v1/reports/balance-sheet', query), { auth: true });

export const getCashFlow = (query: { from: string; to: string; branchId: string | null }) =>
  apiFetch<CashFlow>(withQuery('/v1/reports/cash-flow', query), { auth: true });

export const getAccountLedger = (query: {
  code: string;
  from: string;
  to: string;
  branchId: string | null;
}) => apiFetch<AccountLedger>(withQuery('/v1/reports/account-ledger', query), { auth: true });

export const getTaxReport = (query: { from: string; to: string; branchId: string | null }) =>
  apiFetch<TaxReport>(withQuery('/v1/reports/tax', query), { auth: true });

/** purchases.manage */
export const getSupplierAgeing = (asOf: string) =>
  apiFetch<SupplierAgeingReport>(withQuery('/v1/reports/supplier-ageing', { asOf }), { auth: true });
