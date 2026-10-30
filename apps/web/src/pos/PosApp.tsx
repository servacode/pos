import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { CashierShell, CashierStatusBar, ConnectionPill, DeviceIcon, Logo } from '@serva/ui';
import { readLocalDevice, type LocalDevice } from './localDevice';
import { PinScreen } from './PinScreen';
import { useOnline } from './useOnline';

function OnlinePill() {
  return <ConnectionPill online={useOnline()} />;
}

/** The cashier status bar: the store, the branch and device, the connection. */
function StatusBar({ device }: { device: LocalDevice | null }) {
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
      <OnlinePill />
    </CashierStatusBar>
  );
}

function NotLinked() {
  return (
    <section
      aria-labelledby="not-linked-title"
      className="flex max-w-md flex-col items-center gap-4 text-center"
    >
      <span className="grid size-24 place-items-center rounded-full bg-brand-soft text-brand-ink">
        <DeviceIcon size={48} />
      </span>
      <h1 id="not-linked-title" className="text-2xl font-bold text-ink">
        هذا الجهاز غير مربوط بمتجر بعد
      </h1>
      <p className="text-ink-muted">
        يُربط جهاز الكاشير بالمتجر مرة واحدة من حساب المالك، ثم يفتح هنا برمز الدخول حتى دون إنترنت.
      </p>
    </section>
  );
}

/**
 * The cashier app. It boots only from what this device keeps locally and asks for the login code:
 * no session refresh and no request of any kind, so it opens the same with or without internet.
 */
export function PosApp() {
  const [device] = useState(readLocalDevice);

  return (
    <CashierShell statusBar={<StatusBar device={device} />} mainClassName="grid place-items-center p-6">
      <title>الكاشير · Serva POS</title>
      <Routes>
        <Route index element={device ? <PinScreen /> : <NotLinked />} />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </CashierShell>
  );
}
