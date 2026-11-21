import { lazy, Suspense } from 'react';
import { Navigate, useParams } from 'react-router';
import { Skeleton } from '@serva/ui';

const pages = {
  'balance-sheet': lazy(() => import('./BalanceSheetPage').then((m) => ({ default: m.BalanceSheetPage }))),
  'cash-flow': lazy(() => import('./CashFlowPage').then((m) => ({ default: m.CashFlowPage }))),
  ledger: lazy(() => import('./AccountLedgerPage').then((m) => ({ default: m.AccountLedgerPage }))),
  tax: lazy(() => import('./TaxReportPage').then((m) => ({ default: m.TaxReportPage }))),
  payables: lazy(() => import('./SupplierAgeingPage').then((m) => ({ default: m.SupplierAgeingPage }))),
} as const;

/**
 * The financial statements of the accounting section, one address each: /accounting/reports/ then
 * balance-sheet, cash-flow, ledger, tax or payables. One route in the admin app; each statement is
 * its own chunk, loaded only when opened.
 */
export default function FinancialReportsPage() {
  const { kind = '' } = useParams();
  if (!Object.hasOwn(pages, kind)) return <Navigate to="/accounting/reports/balance-sheet" replace />;
  const Page = pages[kind as keyof typeof pages];
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Page />
    </Suspense>
  );
}
