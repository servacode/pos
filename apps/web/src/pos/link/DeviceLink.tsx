import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { parsePairingQr, type ActivateDeviceInput, type ActivatedDevice } from '@serva/core';
import type { SyncStore } from '@serva/sync/client';
import { Alert } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { deviceStore } from '../../offline/database';
import {
  clearPendingLink,
  linkHelpers,
  loadPendingLink,
  savePendingLink,
  type LinkHelpers,
  type SavedLink,
} from '../../offline/link';
import { APP_VERSION } from '../../offline/sync';
import { activateDevice, signOutOwner } from './api';
import { DownloadStep } from './DownloadStep';
import { LinkSteps } from './LinkSteps';
import { MethodStep, type LinkCredentials, type LinkMethod } from './MethodStep';
import { NameStep, type NamedDevice } from './NameStep';
import { WaitingStep } from './WaitingStep';

type Stage =
  | { step: 'loading' }
  | { step: 'method'; method: LinkMethod; code?: { storeCode: string; manualCode: string } }
  | { step: 'name'; credentials: LinkCredentials }
  | { step: 'waiting'; link: SavedLink }
  | { step: 'download'; device: ActivatedDevice; ownerSignedIn: boolean };

interface DeviceLinkProps {
  /** Called once the device is saved and its data downloaded: the cashier asks for the login code. */
  onLinked: () => void;
  store?: SyncStore;
  helpers?: LinkHelpers;
}

/**
 * «ربط الجهاز» (12, kit cashier/DeviceLink): shown by the cashier while this device has no
 * activated record. Nothing is asked of the server until the person picks a way and goes on.
 */
export function DeviceLink({ onLinked, store = deviceStore(), helpers = linkHelpers }: DeviceLinkProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ step: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A reload while waiting goes on waiting; a scanned link (/link#spq_…) skips to naming.
  useEffect(() => {
    let alive = true;
    const scanned = parsePairingQr(location.hash);
    void loadPendingLink(store).then((link) => {
      if (!alive) return;
      if (link) setStage({ step: 'waiting', link });
      else if (scanned) setStage({ step: 'name', credentials: { method: 'qr', qrToken: scanned } });
      else setStage({ step: 'method', method: 'code' });
    });
    if (scanned) void navigate({ pathname: location.pathname, hash: '' }, { replace: true });
    return () => {
      alive = false;
    };
    // Read once on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = useCallback(
    async (method: LinkMethod = 'code') => {
      await clearPendingLink(store).catch(() => undefined);
      setError(null);
      setStage({ step: 'method', method });
    },
    [store],
  );

  async function activate(credentials: LinkCredentials, named: NamedDevice) {
    setSubmitting(true);
    setError(null);
    try {
      const { publicKey } = await helpers.createDeviceKeys(store);
      const device = {
        name: named.name,
        kind: 'cashier' as const,
        platform: 'browser' as const,
        publicKey,
        appVersion: APP_VERSION,
      };
      const input: ActivateDeviceInput =
        credentials.method === 'owner'
          ? { method: 'owner', branchId: named.branchId ?? '', ...device }
          : credentials.method === 'qr'
            ? { method: 'qr', qrToken: credentials.qrToken, ...device }
            : {
                method: 'code',
                storeCode: credentials.storeCode,
                manualCode: credentials.manualCode,
                ...device,
              };
      const answer = await activateDevice(
        input,
        credentials.method === 'owner' ? credentials.owner.token : undefined,
      );
      if (answer.status === 'active') {
        await startDownload(answer.device, credentials.method === 'owner' ? credentials.owner.token : null);
        return;
      }
      const link: SavedLink = {
        ...answer,
        method: credentials.method === 'code' ? 'code' : 'qr',
        manualCode: credentials.method === 'code' ? credentials.manualCode : null,
        requestedAt: new Date().toISOString(),
      };
      await savePendingLink(store, link);
      setStage({ step: 'waiting', link });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function startDownload(device: ActivatedDevice, ownerToken: string | null) {
    // The token is answered once: save it before anything else can fail.
    await helpers.saveActivatedDevice(store, device);
    await clearPendingLink(store).catch(() => undefined);
    if (ownerToken) void signOutOwner(ownerToken);
    setStage({ step: 'download', device, ownerSignedIn: ownerToken !== null });
  }

  function leaveName(credentials: LinkCredentials) {
    setError(null);
    if (credentials.method === 'owner') void signOutOwner(credentials.owner.token);
    setStage({
      step: 'method',
      method: credentials.method,
      code:
        credentials.method === 'code'
          ? { storeCode: credentials.storeCode, manualCode: credentials.manualCode }
          : undefined,
    });
  }

  if (stage.step === 'loading') return null;

  const ownerSignedIn =
    (stage.step === 'name' && stage.credentials.method === 'owner') ||
    (stage.step === 'download' && stage.ownerSignedIn);

  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <p className="text-lg font-semibold text-ink">إعداد جهاز الكاشير</p>
        <LinkSteps current={stage.step} ownerSignedIn={ownerSignedIn} />
      </div>

      {error && stage.step !== 'name' ? (
        <Alert tone="error" className="w-full max-w-6xl">
          {error}
        </Alert>
      ) : null}

      {stage.step === 'method' ? (
        <MethodStep
          method={stage.method}
          initialCode={stage.code}
          onMethodChange={(method) => setStage({ step: 'method', method })}
          onNext={(credentials) => {
            setError(null);
            setStage({ step: 'name', credentials });
          }}
        />
      ) : null}

      {stage.step === 'name' ? (
        <NameStep
          credentials={stage.credentials}
          submitting={submitting}
          error={error}
          onBack={() => leaveName(stage.credentials)}
          onSubmit={(named) => void activate(stage.credentials, named)}
        />
      ) : null}

      {stage.step === 'waiting' ? (
        <WaitingStep
          link={stage.link}
          onActive={(device) =>
            void startDownload(device, null).catch(() =>
              setError('لم نستطع حفظ الجهاز في هذا المتصفح. اسمح له بالتخزين ثم ابدأ من جديد.'),
            )
          }
          onRestart={(method) => void restart(method)}
        />
      ) : null}

      {stage.step === 'download' ? (
        <DownloadStep store={store} helpers={helpers} storeName={stage.device.storeName} onDone={onLinked} />
      ) : null}
    </div>
  );
}
