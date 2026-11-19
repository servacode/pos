import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Skeleton } from '@serva/ui';

const ChartOfAccountsPage = lazy(() =>
  import('./ChartOfAccountsPage').then((m) => ({ default: m.ChartOfAccountsPage })),
);
const JournalPage = lazy(() => import('./JournalPage').then((m) => ({ default: m.JournalPage })));
const TrialBalancePage = lazy(() =>
  import('./TrialBalancePage').then((m) => ({ default: m.TrialBalancePage })),
);
const ProfitLossPage = lazy(() =>
  import('../ledger/ProfitLossPage').then((m) => ({ default: m.ProfitLossPage })),
);
const FinancialReportsPage = lazy(() => import('../financial/FinancialReportsPage'));
const PeriodClosePage = lazy(() => import('./PeriodClosePage').then((m) => ({ default: m.PeriodClosePage })));

/**
 * The accounting section's addresses (12 › المحاسبة), under /accounting: the chart, the journal, the
 * trial balance, the profit and loss, and the financial statements (/accounting/reports/…). One
 * route in the admin app; each page is its own chunk, loaded only when opened. An address that is
 * not one of these opens the chart, as the bare /accounting does.
 */
export default function AccountingRoutes() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Routes>
        <Route path="accounts" element={<ChartOfAccountsPage />} />
        <Route path="journal" element={<JournalPage />} />
        <Route path="trial-balance" element={<TrialBalancePage />} />
        <Route path="profit-loss" element={<ProfitLossPage />} />
        <Route path="reports/:kind" element={<FinancialReportsPage />} />
        <Route path="period-close" element={<PeriodClosePage />} />
        <Route path="*" element={<Navigate to="/accounting/accounts" replace />} />
      </Routes>
    </Suspense>
  );
}
