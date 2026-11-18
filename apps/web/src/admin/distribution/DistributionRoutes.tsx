import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from '../../auth/useAuth';
import { DistributionFrame } from './parts';

const OrdersPage = lazy(() => import('./OrdersPage').then((m) => ({ default: m.OrdersPage })));
const OrderPage = lazy(() => import('./OrderPage').then((m) => ({ default: m.OrderPage })));
const RoutesPage = lazy(() => import('./RoutesPage').then((m) => ({ default: m.RoutesPage })));
const RoutePage = lazy(() => import('./RoutePage').then((m) => ({ default: m.RoutePage })));
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
        me.user.permissions.includes('sales_orders.manage') ? '/distribution/orders' : '/distribution/routes'
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
        <Route path="orders/:id" element={<OrderPage />} />
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
