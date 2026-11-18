import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider';
import { GuestOnly, RequireAuth } from '../auth/guards';
import { useAuth } from '../auth/useAuth';
import { ShellSkeleton } from '../layout/ShellSkeleton';
import { PageLoading } from '../layout/PageLoading';
import { NotFoundPage } from '../pages/NotFoundPage';
import { HomePage } from '../pages/HomePage';
// Rarely opened: its own chunk keeps the admin shell small
const ForgotPasswordPage = lazy(() =>
  import('../pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const LandingPage = lazy(() => import('../pages/LandingPage').then((m) => ({ default: m.LandingPage })));
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { SectorGate } from './SectorGate';
import {
  CHEQUE_SECTORS,
  CONTRACT_PRICE_SECTORS,
  EXPIRY_SECTORS,
  HALL_SECTORS,
  RENTAL_SECTORS,
  SERIAL_SECTORS,
  WARRANTY_SECTORS,
} from '../lib/sectors';

// The devices page carries the QR generator: loaded when opened, not with every admin page.
const DevicesPage = lazy(() => import('./devices/DevicesPage').then((m) => ({ default: m.DevicesPage })));
// The catalog screens, each its own chunk: the list, the card, the categories, and «رمز الدخول للكاشير».
const ProductsPage = lazy(() => import('./products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ProductRoute = lazy(() => import('./products/ProductPage').then((m) => ({ default: m.ProductRoute })));
const LabelsPage = lazy(() => import('./labels/LabelsPage').then((m) => ({ default: m.LabelsPage })));
const SerialsPage = lazy(() => import('./purchases/SerialsPage').then((m) => ({ default: m.SerialsPage })));
const RentalsPage = lazy(() => import('./contracts/RentalsPage').then((m) => ({ default: m.RentalsPage })));
const MaintenancePage = lazy(() =>
  import('./contracts/MaintenancePage').then((m) => ({ default: m.MaintenancePage })),
);
const ContractPricesPage = lazy(() =>
  import('./contracts/ContractPricesPage').then((m) => ({ default: m.ContractPricesPage })),
);
const DebtAgeingPage = lazy(() =>
  import('./contracts/DebtAgeingPage').then((m) => ({ default: m.DebtAgeingPage })),
);
const WarrantyPage = lazy(() => import('./warranty/WarrantyPage').then((m) => ({ default: m.WarrantyPage })));
const TaxRatesPage = lazy(() => import('./tax/TaxRatesPage').then((m) => ({ default: m.TaxRatesPage })));
const QuotationsPage = lazy(() =>
  import('./quotations/QuotationsPage').then((m) => ({ default: m.QuotationsPage })),
);
const QuotationPage = lazy(() =>
  import('./quotations/QuotationPage').then((m) => ({ default: m.QuotationPage })),
);
const MerchandisePage = lazy(() =>
  import('./reports/MerchandisePage').then((m) => ({ default: m.MerchandisePage })),
);
const BelowCostPage = lazy(() =>
  import('./reports/BelowCostPage').then((m) => ({ default: m.BelowCostPage })),
);
const FoodCostPage = lazy(() => import('./reports/FoodCostPage').then((m) => ({ default: m.FoodCostPage })));
const SuppliersPage = lazy(() =>
  import('./purchases/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const ReportsHomePage = lazy(() =>
  import('./reports/ReportsHomePage').then((m) => ({ default: m.ReportsHomePage })),
);
const SalesReportPage = lazy(() =>
  import('./reports/SalesReportPage').then((m) => ({ default: m.SalesReportPage })),
);
const CancellationsPage = lazy(() =>
  import('./reports/CancellationsPage').then((m) => ({ default: m.CancellationsPage })),
);
const SupplierReturnsPage = lazy(() =>
  import('./purchases/SupplierReturnsPage').then((m) => ({ default: m.SupplierReturnsPage })),
);
const PurchaseOrdersPage = lazy(() =>
  import('./purchases/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
);
const PurchaseOrderFormPage = lazy(() =>
  import('./purchases/PurchaseOrderFormPage').then((m) => ({ default: m.PurchaseOrderFormPage })),
);
const PurchaseOrderPage = lazy(() =>
  import('./purchases/PurchaseOrderPage').then((m) => ({ default: m.PurchaseOrderPage })),
);
const TransfersPage = lazy(() =>
  import('./purchases/TransfersPage').then((m) => ({ default: m.TransfersPage })),
);
const ImportPage = lazy(() => import('./import/ImportPage').then((m) => ({ default: m.ImportPage })));
const PriceListPage = lazy(() =>
  import('./products/PriceListPage').then((m) => ({ default: m.PriceListPage })),
);
const PriceHistoryPage = lazy(() =>
  import('./products/PriceHistoryPage').then((m) => ({ default: m.PriceHistoryPage })),
);
const BulkPricesPage = lazy(() =>
  import('./products/BulkPricesPage').then((m) => ({ default: m.BulkPricesPage })),
);
const OnlineStorePage = lazy(() =>
  import('./shop/OnlineStorePage').then((m) => ({ default: m.OnlineStorePage })),
);
const ControlledRegisterPage = lazy(() =>
  import('./pharmacy/ControlledRegisterPage').then((m) => ({ default: m.ControlledRegisterPage })),
);
const ExpiryPage = lazy(() => import('./purchases/ExpiryPage').then((m) => ({ default: m.ExpiryPage })));
const RecallPage = lazy(() => import('./purchases/RecallPage').then((m) => ({ default: m.RecallPage })));
const ChequesPage = lazy(() => import('./cheques/ChequesPage').then((m) => ({ default: m.ChequesPage })));
// الأقساط: the plans, the due list and the store's rules
const InstalmentPlansPage = lazy(() =>
  import('./installments/PlansPage').then((m) => ({ default: m.PlansPage })),
);
const InstalmentPlanPage = lazy(() =>
  import('./installments/PlanPage').then((m) => ({ default: m.PlanPage })),
);
const InstalmentWorklistPage = lazy(() =>
  import('./installments/WorklistPage').then((m) => ({ default: m.WorklistPage })),
);
const InstalmentSettingsPage = lazy(() =>
  import('./installments/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
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
const BranchesPage = lazy(() => import('./branches/BranchesPage').then((m) => ({ default: m.BranchesPage })));
const StaffPage = lazy(() => import('./staff/StaffPage').then((m) => ({ default: m.StaffPage })));
const PinPage = lazy(() => import('./staff/PinPage').then((m) => ({ default: m.PinPage })));
// The reports: «مبيعات اليوم», the shifts and their close report, «شاشة الدليل», and the books.
const DayReportPage = lazy(() =>
  import('./reports/DayReportPage').then((m) => ({ default: m.DayReportPage })),
);
const InvoicesPage = lazy(() => import('./sales/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const ShiftsPage = lazy(() => import('./reports/ShiftsPage').then((m) => ({ default: m.ShiftsPage })));
const ShiftReportPage = lazy(() =>
  import('./reports/ShiftReportPage').then((m) => ({ default: m.ShiftReportPage })),
);
const EvidencePage = lazy(() => import('./reports/EvidencePage').then((m) => ({ default: m.EvidencePage })));
// Statements, expenses and the profit and loss (29).
const StatementPage = lazy(() =>
  import('./ledger/StatementPage').then((m) => ({ default: m.StatementPage })),
);
const ExpensesPage = lazy(() => import('./ledger/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const Accounting = lazy(() => import('./accounting/AccountingRoutes'));
const Distribution = lazy(() => import('./distribution/DistributionRoutes'));
const DistributionReports = lazy(() =>
  import('./distribution/DistributionReportsPage').then((m) => ({ default: m.DistributionReportsPage })),
);

/** The root: the home page for a signed-in user, the landing page for a visitor (the session is restored first) */
function Front() {
  const { state } = useAuth();
  if (state.status === 'loading') return <ShellSkeleton />;
  return state.status === 'signedIn' ? (
    <HomePage />
  ) : (
    <Suspense fallback={<ShellSkeleton />}>
      <LandingPage />
    </Suspense>
  );
}

const page = (element: ReactNode) => <Suspense fallback={<PageLoading />}>{element}</Suspense>;

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
          <Route
            path="/forgot-password"
            element={
              <Suspense fallback={<ShellSkeleton />}>
                <ForgotPasswordPage />
              </Suspense>
            }
          />
        </Route>
        {/* A visitor who is not signed in sees the landing page at the root; a signed-in user, the home page */}
        <Route path="/" element={<Front />} />
        <Route element={<RequireAuth />}>
          <Route path="/devices" element={page(<DevicesPage />)} />
          <Route path="/products" element={page(<ProductsPage />)} />
          <Route path="/products/import" element={<Navigate to="/import?type=products" replace />} />
          <Route path="/products/:id" element={page(<ProductRoute />)} />
          <Route path="/categories" element={page(<CategoriesPage />)} />
          <Route path="/promotions" element={page(<PromotionsPage />)} />
          <Route
            path="/cheques"
            element={page(
              <SectorGate sectors={CHEQUE_SECTORS}>
                <ChequesPage />
              </SectorGate>,
            )}
          />
          <Route path="/installments" element={page(<InstalmentPlansPage />)} />
          <Route path="/installments/due" element={page(<InstalmentWorklistPage />)} />
          <Route path="/installments/settings" element={page(<InstalmentSettingsPage />)} />
          <Route path="/installments/:id" element={page(<InstalmentPlanPage />)} />
          <Route path="/customers" element={page(<CustomersPage />)} />
          <Route path="/messages" element={page(<BroadcastsPage />)} />
          <Route path="/purchases" element={page(<PurchasesPage />)} />
          <Route path="/suppliers" element={page(<SuppliersPage />)} />
          <Route path="/inventory" element={page(<InventoryPage />)} />
          <Route
            path="/expiry"
            element={page(
              <SectorGate sectors={EXPIRY_SECTORS}>
                <ExpiryPage />
              </SectorGate>,
            )}
          />
          <Route
            path="/recall"
            element={page(
              <SectorGate sectors={EXPIRY_SECTORS}>
                <RecallPage />
              </SectorGate>,
            )}
          />
          <Route
            path="/controlled-register"
            element={page(
              <SectorGate sectors={['pharmacy']}>
                <ControlledRegisterPage />
              </SectorGate>,
            )}
          />
          <Route path="/online-store" element={page(<OnlineStorePage />)} />
          <Route path="/prices" element={page(<BulkPricesPage />)} />
          <Route path="/price-history" element={page(<PriceHistoryPage />)} />
          <Route path="/price-list" element={page(<PriceListPage />)} />
          <Route path="/import" element={page(<ImportPage />)} />
          <Route path="/transfers" element={page(<TransfersPage />)} />
          <Route path="/purchase-orders" element={page(<PurchaseOrdersPage />)} />
          <Route path="/purchase-orders/new" element={page(<PurchaseOrderFormPage />)} />
          <Route path="/purchase-orders/:id" element={page(<PurchaseOrderPage />)} />
          <Route path="/purchase-orders/:id/edit" element={page(<PurchaseOrderFormPage />)} />
          <Route path="/supplier-returns" element={page(<SupplierReturnsPage />)} />
          <Route path="/reports" element={page(<ReportsHomePage />)} />
          <Route path="/reports/sales" element={page(<SalesReportPage />)} />
          <Route path="/reports/below-cost" element={page(<BelowCostPage />)} />
          <Route path="/reports/food-cost" element={page(<FoodCostPage />)} />
          <Route path="/reports/merchandise" element={page(<MerchandisePage />)} />
          <Route
            path="/reports/cancellations"
            element={page(
              <SectorGate sectors={HALL_SECTORS}>
                <CancellationsPage />
              </SectorGate>,
            )}
          />
          <Route
            path="/serials"
            element={page(
              <SectorGate sectors={SERIAL_SECTORS}>
                <SerialsPage />
              </SectorGate>,
            )}
          />
          <Route
            path="/warranty"
            element={page(
              <SectorGate sectors={WARRANTY_SECTORS}>
                <WarrantyPage />
              </SectorGate>,
            )}
          />
          <Route
            path="/rentals"
            element={page(
              <SectorGate sectors={RENTAL_SECTORS}>
                <RentalsPage />
              </SectorGate>,
            )}
          />
          <Route
            path="/maintenance"
            element={page(
              <SectorGate sectors={RENTAL_SECTORS}>
                <MaintenancePage />
              </SectorGate>,
            )}
          />
          <Route
            path="/contract-prices"
            element={page(
              <SectorGate sectors={CONTRACT_PRICE_SECTORS}>
                <ContractPricesPage />
              </SectorGate>,
            )}
          />
          <Route path="/reports/debt-ageing" element={page(<DebtAgeingPage />)} />
          <Route path="/labels" element={page(<LabelsPage />)} />
          <Route path="/tax-rates" element={page(<TaxRatesPage />)} />
          <Route path="/quotations" element={page(<QuotationsPage />)} />
          <Route path="/quotations/:id" element={page(<QuotationPage />)} />
          <Route path="/customers/:id" element={page(<CustomerPage />)} />
          <Route path="/customers/:id/statement" element={page(<StatementPage type="customer" />)} />
          <Route path="/suppliers/:id/statement" element={page(<StatementPage type="supplier" />)} />
          <Route path="/expenses" element={page(<ExpensesPage />)} />
          <Route path="/branches" element={page(<BranchesPage />)} />
          <Route path="/staff" element={page(<StaffPage />)} />
          <Route path="/me/pin" element={page(<PinPage />)} />
          <Route path="/welcome" element={page(<WelcomePage />)} />
          <Route path="/settings" element={page(<SettingsPage />)} />
          <Route path="/subscription" element={page(<SubscriptionPage />)} />
          {/* A parent path with no page of its own opens its first child, not «غير موجود» */}
          <Route path="/sales" element={<Navigate to="/sales/today" replace />} />
          <Route path="/me" element={<Navigate to="/me/pin" replace />} />
          <Route path="/sales/today" element={page(<DayReportPage />)} />
          <Route path="/sales/invoices" element={page(<InvoicesPage />)} />
          <Route path="/shifts" element={page(<ShiftsPage />)} />
          <Route path="/shifts/:id" element={page(<ShiftReportPage />)} />
          <Route path="/evidence" element={page(<EvidencePage />)} />
          <Route path="/accounting/*" element={page(<Accounting />)} />
          <Route path="/distribution/*" element={page(<Distribution />)} />
          <Route path="/reports/distribution" element={page(<DistributionReports />)} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
