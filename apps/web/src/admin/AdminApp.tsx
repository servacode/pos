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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
