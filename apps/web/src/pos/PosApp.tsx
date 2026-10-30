import { Navigate, Route, Routes } from 'react-router';
import { cn } from '../lib/cn';
import { Logo } from '../ui/Logo';
import { ConnectedIcon, DeviceIcon, OfflineIcon } from '../ui/icons';
import type { LocalDevice } from '../offline/device';
import { useDevice } from '../offline/useDevice';
import { PinScreen } from './PinScreen';
import { useOnline } from './useOnline';

function ConnectionPill() {
  const online = useOnline();
  return (
    <span
      className={cn(
        'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
        online ? 'bg-success-soft text-success-ink' : 'bg-warning-soft text-warning-ink',
      )}
    >
      {online ? <ConnectedIcon size={16} /> : <OfflineIcon size={16} />}
      {online ? 'متصل' : 'دون إنترنت · البيع مستمر'}
    </span>
  );
}

/** The cashier status bar (kit: cash-status): above every layer, 44 px. */
function StatusBar({ device, persisted }: { device: LocalDevice | null; persisted: boolean | null }) {
  return (
    <header className="relative z-60 flex h-11 items-center gap-3 border-b border-line bg-surface px-4">
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
      <ConnectionPill />
    </header>
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
 * The cashier app. It boots only from what this device keeps locally (the device database) and
 * asks for the login code: no session refresh and no request before that, so it opens the same
 * with or without internet. An activated device then syncs in the background.
 */
export function PosApp() {
  const { loading, device, persisted } = useDevice();

  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] bg-canvas">
      <title>الكاشير · Serva POS</title>
      <StatusBar device={device} persisted={persisted} />
      <main className="grid place-items-center p-6">
        <Routes>
          <Route index element={loading ? null : device ? <PinScreen /> : <NotLinked />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>
    </div>
  );
}
