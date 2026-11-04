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
const LabelsPage = lazy(() => import('./labels/LabelsPage').then((m) => ({ default: m.LabelsPage })));
const SerialsPage = lazy(() => import('./purchases/SerialsPage').then((m) => ({ default: m.SerialsPage })));
const MerchandisePage = lazy(() =>
  import('./reports/MerchandisePage').then((m) => ({ default: m.MerchandisePage })),
);
const SupplierReturnsPage = lazy(() =>
  import('./purchases/SupplierReturnsPage').then((m) => ({ default: m.SupplierReturnsPage })),
);
const TransfersPage = lazy(() =>
  import('./purchases/TransfersPage').then((m) => ({ default: m.TransfersPage })),
);
const BulkPricesPage = lazy(() =>
  import('./products/BulkPricesPage').then((m) => ({ default: m.BulkPricesPage })),
);
const OnlineStorePage = lazy(() =>
  import('./shop/OnlineStorePage').then((m) => ({ default: m.OnlineStorePage })),
);
const ExpiryPage = lazy(() => import('./purchases/ExpiryPage').then((m) => ({ default: m.ExpiryPage })));
const ChequesPage = lazy(() => import('./cheques/ChequesPage').then((m) => ({ default: m.ChequesPage })));
const PromotionsPage = lazy(() =>
  import('./promotions/PromotionsPage').then((m) => ({ default: m.PromotionsPage })),
);
const CategoriesPage = lazy(() =>
  import('./categories/CategoriesPage').then((m) => ({ default: m.CategoriesPage })),
);
// The start wizard and «إعدادات المتجر» (04)
const WelcomePage = lazy(() => import('./store/WelcomePage').then((m) => ({ default: m.WelcomePage })));
const SettingsPage = lazy(() => import('./store/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const BroadcastsPage = lazy(() =>
  import('./customers/BroadcastsPage').then((m) => ({ default: m.BroadcastsPage })),
);
const CustomersPage = lazy(() =>
  import('./customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
);
const CustomerPage = lazy(() =>
  import('./customers/CustomerPage').then((m) => ({ default: m.CustomerPage })),
);
const PurchasesPage = lazy(() =>
  import('./purchases/PurchasesPage').then((m) => ({ default: m.PurchasesPage })),
);
const InventoryPage = lazy(() =>
  import('./purchases/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const SubscriptionPage = lazy(() =>
  import('./subscription/SubscriptionPage').then((m) => ({ default: m.SubscriptionPage })),
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
          <Route path="/promotions" element={page(<PromotionsPage />)} />
          <Route path="/cheques" element={page(<ChequesPage />)} />
          <Route path="/customers" element={page(<CustomersPage />)} />
          <Route path="/messages" element={page(<BroadcastsPage />)} />
          <Route path="/purchases" element={page(<PurchasesPage />)} />
          <Route path="/inventory" element={page(<InventoryPage />)} />
          <Route path="/expiry" element={page(<ExpiryPage />)} />
          <Route path="/online-store" element={page(<OnlineStorePage />)} />
          <Route path="/prices" element={page(<BulkPricesPage />)} />
          <Route path="/transfers" element={page(<TransfersPage />)} />
          <Route path="/supplier-returns" element={page(<SupplierReturnsPage />)} />
          <Route path="/reports/merchandise" element={page(<MerchandisePage />)} />
          <Route path="/serials" element={page(<SerialsPage />)} />
          <Route path="/labels" element={page(<LabelsPage />)} />
          <Route path="/customers/:id" element={page(<CustomerPage />)} />
          <Route path="/me/pin" element={page(<PinPage />)} />
          <Route path="/welcome" element={page(<WelcomePage />)} />
          <Route path="/settings" element={page(<SettingsPage />)} />
          <Route path="/subscription" element={page(<SubscriptionPage />)} />
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
