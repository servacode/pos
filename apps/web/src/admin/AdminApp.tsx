import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { FullScreenLoader } from '@serva/ui';
import { AuthProvider } from '../auth/AuthProvider';
import { GuestOnly, RequireAuth } from '../auth/guards';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';

// The devices page carries the QR generator: loaded when opened, not with every admin page.
const DevicesPage = lazy(() => import('./devices/DevicesPage').then((m) => ({ default: m.DevicesPage })));

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
          <Route
            path="/devices"
            element={
              <Suspense fallback={<FullScreenLoader />}>
                <DevicesPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
