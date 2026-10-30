import { DirectionProvider } from '@radix-ui/react-direction';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { FullScreenLoader } from './ui/FullScreenLoader';

// Two apps, two code-split entries. The cashier (/pos) boots from what the device keeps locally
// and asks for the login code, with no network request; the store admin restores its session
// from the server. Neither loads the other's code.
const PosApp = lazy(() => import('./pos/PosApp').then((m) => ({ default: m.PosApp })));
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

export function App() {
  // Radix primitives read the reading direction from this provider (arrow keys in menus, tabs,
  // radio groups and sliders); the document itself is <html dir="rtl">.
  return (
    <DirectionProvider dir="rtl">
      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          <Route path="/pos/*" element={<PosApp />} />
          <Route path="*" element={<AdminApp />} />
        </Routes>
      </Suspense>
    </DirectionProvider>
  );
}
