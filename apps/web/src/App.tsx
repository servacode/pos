import { DirectionProvider } from '@radix-ui/react-direction';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { FullScreenLoader, TestModeRibbon } from '@serva/ui';
import { useTestMode } from './lib/testMode';

// Two apps, two code-split entries. The cashier (/pos) boots from what the device keeps locally
// and asks for the login code, with no network request; the store admin restores its session
// from the server. Neither loads the other's code.
const PosApp = lazy(() => import('./pos/PosApp').then((m) => ({ default: m.PosApp })));
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

// The component gallery (tab 14 › معرض المكوّنات) exists in dev builds only: in a production build
// import.meta.env.DEV is false, so this import is dead code and no chunk is emitted for it.
const UiGallery = import.meta.env.DEV
  ? lazy(() => import('./dev/UiGallery').then((m) => ({ default: m.UiGallery })))
  : null;

/** The pairing QR holds `<origin>/link#spq_…`: a device's camera opens the cashier's link screen. */
function PairingLink() {
  const { hash } = useLocation();
  return <Navigate to={{ pathname: '/pos', hash }} replace />;
}

export function App() {
  const testMode = useTestMode();
  // Radix primitives read the reading direction from this provider (arrow keys in menus, tabs,
  // radio groups and sliders); the document itself is <html dir="rtl">.
  return (
    <DirectionProvider dir="rtl">
      {/* The local server's test mode: on every page, admin and cashier alike. */}
      {testMode ? <TestModeRibbon className="sticky top-0 z-50" /> : null}
      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          {UiGallery ? <Route path="/dev/ui" element={<UiGallery />} /> : null}
          <Route path="/pos/*" element={<PosApp />} />
          <Route path="/link" element={<PairingLink />} />
          <Route path="*" element={<AdminApp />} />
        </Routes>
      </Suspense>
    </DirectionProvider>
  );
}
