import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { CashierShell, CashierStatusBar, ConnectionPill, Logo } from '@serva/ui';
import type { LocalDevice } from '../offline/device';
import { useDevice } from '../offline/useDevice';
import { PinScreen } from './PinScreen';
import { useOnline } from './useOnline';

// Linking runs once per device: its screens load only on a device that is not linked yet.
const DeviceLink = lazy(() => import('./link/DeviceLink').then((m) => ({ default: m.DeviceLink })));

function OnlinePill() {
  return <ConnectionPill online={useOnline()} />;
}

/** The cashier status bar: the store, the branch and device, the connection. */
function StatusBar({ device, persisted }: { device: LocalDevice | null; persisted: boolean | null }) {
  return (
    <CashierStatusBar>
      <Logo />
      {device ? (
        <>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
          <p className="flex min-w-0 flex-col">
            <span className="truncate text-sm/tight font-semibold text-ink">{device.storeName}</span>
            <span className="truncate text-xs/tight text-ink-muted">
              {device.branchName} · {device.deviceName}
            </span>
          </p>
        </>
      ) : null}
      <span className="flex-1" />
      {persisted === false ? (
        // Tab 15 › ما يراه الكاشير: the browser may wipe this device's data.
        <span role="alert" className="truncate text-sm font-semibold text-danger-ink">
          هذا المتصفح قد يمسح البيانات، ثبّت التطبيق
        </span>
      ) : null}
      <OnlinePill />
    </CashierStatusBar>
  );
}

/**
 * The cashier app. It boots only from what this device keeps locally (the device database) and
 * asks for the login code: no session refresh and no request before that, so it opens the same
 * with or without internet. An activated device then syncs in the background.
 */
export function PosApp() {
  const { loading, device, persisted, reload } = useDevice();

  return (
    <CashierShell
      statusBar={<StatusBar device={device} persisted={persisted} />}
      mainClassName={
        device || loading ? 'grid place-items-center p-6' : 'flex justify-center p-6 lg:px-14 lg:py-8'
      }
    >
      <title>الكاشير · Serva POS</title>
      <Routes>
        <Route
          index
          element={
            loading ? null : device ? (
              <PinScreen />
            ) : (
              <Suspense fallback={null}>
                <DeviceLink onLinked={reload} />
              </Suspense>
            )
          }
        />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </CashierShell>
  );
}
