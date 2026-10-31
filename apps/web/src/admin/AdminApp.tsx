import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { FullScreenLoader } from '@serva/ui';
import { AuthProvider } from '../auth/AuthProvider';
import { GuestOnly, RequireAuth } from '../auth/guards';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';

// The devices page carries the QR generator: loaded when opened, not with every admin page.
const DevicesPage = lazy(() => import('./devices/DevicesPage').then((m) => ({ default: m.DevicesPage })));
// The catalog screens, each its own chunk: the list, the card, the categories, and «رمز الدخول للكاشير».
const ProductsPage = lazy(() => import('./products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ProductRoute = lazy(() => import('./products/ProductPage').then((m) => ({ default: m.ProductRoute })));
const CategoriesPage = lazy(() =>
  import('./categories/CategoriesPage').then((m) => ({ default: m.CategoriesPage })),
);
const PinPage = lazy(() => import('./staff/PinPage').then((m) => ({ default: m.PinPage })));
// The reports: «مبيعات اليوم», the shifts and their close report, «شاشة الدليل», and the books.
const DayReportPage = lazy(() =>
  import('./reports/DayReportPage').then((m) => ({ default: m.DayReportPage })),
);
const ShiftsPage = lazy(() => import('./reports/ShiftsPage').then((m) => ({ default: m.ShiftsPage })));
const ShiftReportPage = lazy(() =>
  import('./reports/ShiftReportPage').then((m) => ({ default: m.ShiftReportPage })),
);
const EvidencePage = lazy(() => import('./reports/EvidencePage').then((m) => ({ default: m.EvidencePage })));
const ChartOfAccountsPage = lazy(() =>
  import('./accounting/ChartOfAccountsPage').then((m) => ({ default: m.ChartOfAccountsPage })),
);
const JournalPage = lazy(() => import('./accounting/JournalPage').then((m) => ({ default: m.JournalPage })));
const TrialBalancePage = lazy(() =>
  import('./accounting/TrialBalancePage').then((m) => ({ default: m.TrialBalancePage })),
);

const page = (element: ReactNode) => <Suspense fallback={<FullScreenLoader />}>{element}</Suspense>;

/**
 * Store admin: online, signed in with phone and password. Booting it restores the session from
 * the server (refresh cookie), so it is kept apart from the cashier at /pos, which must open
 * without the network.
 */
export function AdminApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/devices" element={page(<DevicesPage />)} />
          <Route path="/products" element={page(<ProductsPage />)} />
          <Route path="/products/:id" element={page(<ProductRoute />)} />
          <Route path="/categories" element={page(<CategoriesPage />)} />
          <Route path="/me/pin" element={page(<PinPage />)} />
          <Route path="/sales/today" element={page(<DayReportPage />)} />
          <Route path="/shifts" element={page(<ShiftsPage />)} />
          <Route path="/shifts/:id" element={page(<ShiftReportPage />)} />
          <Route path="/evidence" element={page(<EvidencePage />)} />
          <Route path="/accounting" element={<Navigate to="/accounting/accounts" replace />} />
          <Route path="/accounting/accounts" element={page(<ChartOfAccountsPage />)} />
          <Route path="/accounting/journal" element={page(<JournalPage />)} />
          <Route path="/accounting/trial-balance" element={page(<TrialBalancePage />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
