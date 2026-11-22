import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from '../../auth/useAuth';
import { DistributionFrame } from './parts';

const OrdersPage = lazy(() => import('./OrdersPage').then((m) => ({ default: m.OrdersPage })));
const OrderPage = lazy(() => import('./OrderPage').then((m) => ({ default: m.OrderPage })));
const RoutesPage = lazy(() => import('./RoutesPage').then((m) => ({ default: m.RoutesPage })));
const RoutePage = lazy(() => import('./RoutePage').then((m) => ({ default: m.RoutePage })));
const NewOrderPage = lazy(() => import('./NewOrderPage').then((m) => ({ default: m.NewOrderPage })));
const BoardPage = lazy(() => import('./BoardPage').then((m) => ({ default: m.BoardPage })));
const SettlementsPage = lazy(() => import('./SettlementsPage').then((m) => ({ default: m.SettlementsPage })));
const SettlementPage = lazy(() => import('./SettlementPage').then((m) => ({ default: m.SettlementPage })));
const NewSettlementPage = lazy(() =>
  import('./SettlementPage').then((m) => ({ default: m.NewSettlementPage })),
);
const TargetsPage = lazy(() => import('./TargetsPage').then((m) => ({ default: m.TargetsPage })));
const RepsPage = lazy(() => import('./RepsPage').then((m) => ({ default: m.RepsPage })));
const VansPage = lazy(() => import('./VansPage').then((m) => ({ default: m.VansPage })));
const RegionsPage = lazy(() => import('./RegionsPage').then((m) => ({ default: m.RegionsPage })));
const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })));

/** The first page this user may open: the orders for the supervisor of orders, else the routes */
function First() {
  const me = useMe();
  return (
    <Navigate
      to={
        me.user.permissions.includes('sales_orders.manage')
          ? '/distribution/orders'
          : me.user.permissions.includes('routes.manage')
            ? '/distribution/routes'
            : me.user.permissions.includes('rep.settle')
              ? '/distribution/settlements'
              : '/distribution/today'
      }
      replace
    />
  );
}

/**
 * «التوزيع» (docs/specs/32-sales-reps.md), under /distribution: the pre-sale orders, the routes and
 * their customers, the reps, the vans, the regions and the rules. One route in the admin app; each
 * page is its own chunk, loaded only when opened.
 */
export default function DistributionRoutes() {
  return (
    <Routes>
      <Route element={<DistributionFrame />}>
        <Route index element={<First />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/:id" element={<OrderPage />} />
        <Route path="today" element={<BoardPage />} />
        <Route path="settlements" element={<SettlementsPage />} />
        <Route path="settlements/new" element={<NewSettlementPage />} />
        <Route path="settlements/:id" element={<SettlementPage />} />
        <Route path="targets" element={<TargetsPage />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="routes/:id" element={<RoutePage />} />
        <Route path="reps" element={<RepsPage />} />
        <Route path="vans" element={<VansPage />} />
        <Route path="regions" element={<RegionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/distribution" replace />} />
      </Route>
    </Routes>
  );
}
