import { apiFetch } from '../../lib/api';
import type {
  AccountListResponse,
  DayReport,
  JournalPage,
  ShiftListResponse,
  ShiftReport,
  SyncEvidence,
  TrialBalance,
} from './contracts';

// The reports and accounting requests (17 › التقارير، المحاسبة). The server checks every permission
// and the branch scope; the screens only read.

type Query = Record<string, string | null | undefined>;

/** A path with its query in a fixed order, leaving out empty values («كل الفروع» sends no branchId). */
export function withQuery(path: string, query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function getDayReport(query: { branchId: string | null; date: string }) {
  return apiFetch<DayReport>(withQuery('/v1/reports/day', query), { auth: true });
}

export function listShifts(query: { branchId: string | null; date: string }) {
  return apiFetch<ShiftListResponse>(withQuery('/v1/shifts', query), { auth: true });
}

export function getShift(id: string) {
  return apiFetch<ShiftReport>(`/v1/shifts/${encodeURIComponent(id)}`, { auth: true });
}

export function listAccounts() {
  return apiFetch<AccountListResponse>('/v1/accounts', { auth: true });
}

export function getJournal(query: {
  from: string;
  to: string;
  branchId: string | null;
  cursor?: string | null;
}) {
  return apiFetch<JournalPage>(withQuery('/v1/journal', query), { auth: true });
}

export function getTrialBalance(query: { from: string; to: string; branchId: string | null }) {
  return apiFetch<TrialBalance>(withQuery('/v1/reports/trial-balance', query), { auth: true });
}

export function getEvidence(query: { deviceId: string; date: string }) {
  return apiFetch<SyncEvidence>(withQuery('/v1/sync/evidence', query), { auth: true });
}
