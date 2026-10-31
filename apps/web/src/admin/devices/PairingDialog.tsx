import { useCallback, useEffect, useState } from 'react';
import {
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_SECONDS,
  type DeviceSummary,
  type MeResponse,
  type PairingCodeResponse,
} from '@serva/core';
import { Alert, Button, ClockIcon, ProgressBar, RetryIcon, Select, Skeleton } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { formatCountdown, formatPairingCode } from '../../lib/devices';
import { useNow } from '../../lib/useNow';
import { createPairingCode } from './api';
import { PendingDevice } from './PendingDevice';
import { QrCode } from './QrCode';

interface PairingDialogBodyProps {
  branches: MeResponse['branches'];
  /** Devices waiting for «اسمح», refreshed every 5 s by the page while this is open */
  pending: DeviceSummary[];
  busyId: string | null;
  onDecide: (device: DeviceSummary, decision: 'approve' | 'reject') => void;
}

/**
 * «اربط جهازاً جديداً»: a pairing code for a branch, as a QR and as the 8-character code with the
 * store code, valid 10 minutes. A device that uses it shows up here for «اسمح» or «ارفض».
 */
export function PairingDialogBody({ branches, pending, busyId, onDecide }: PairingDialogBodyProps) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [code, setCode] = useState<PairingCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const now = useNow(1000, code !== null);

  const create = useCallback(async (forBranch: string) => {
    setCreating(true);
    setError(null);
    setCode(null);
    try {
      setCode(await createPairingCode({ branchId: forBranch }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    if (branchId) void create(branchId);
  }, [branchId, create]);

  const left = code ? Date.parse(code.expiresAt) - now : 0;
  const expired = code !== null && left <= 0;
  const waiting = pending.filter((device) => device.branchId === branchId);

  return (
    <div className="flex flex-col gap-4">
      {branches.length > 1 ? (
        <Select label="الفرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {creating ? (
        <div aria-busy="true" className="flex items-center gap-4">
          <Skeleton className="size-36 shrink-0 rounded-control" />
          <span className="sr-only">نجهّز رمز الربط…</span>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-9 w-1/2" />
          </div>
        </div>
      ) : null}

      {code ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="shrink-0 rounded-control border border-line bg-surface p-2 dark:bg-ink">
              {expired ? (
                <div className="grid size-36 place-items-center text-center text-sm font-semibold text-ink-muted">
                  انتهى الرمز
                </div>
              ) : (
                <QrCode
                  value={code.qrPayload}
                  label={`رمز QR لربط جهاز في ${code.branchName}`}
                  className="size-36"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-sm text-ink-muted">
                امسح الرمز من شاشة «ربط الجهاز» على الجهاز الجديد، أو اكتب:
              </span>
              <span className="text-sm text-ink-muted">رمز الربط</span>
              <bdi
                dir="ltr"
                className="num text-start text-[1.625rem]/tight font-bold tracking-[0.15em] text-ink"
              >
                {formatPairingCode(code.manualCode)}
              </bdi>
              <span className="text-sm text-ink-muted">
                رمز المتجر <bdi className="num font-bold text-ink">{code.storeCode}</bdi>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-control bg-surface-muted px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink" role="timer">
              <ClockIcon />
              {expired ? (
                'انتهى الرمز. اطلب رمزاً جديداً.'
              ) : (
                <>
                  ينتهي بعد <span className="num">{formatCountdown(left)}</span> · {code.branchName}
                </>
              )}
            </p>
            <ProgressBar
              label="الوقت الباقي للرمز"
              value={Math.max(0, left)}
              max={PAIRING_TTL_SECONDS * 1000}
              valueText={`${formatCountdown(left)} دقيقة باقية`}
              tone="warning"
            />
            <p className="text-xs text-ink-muted">
              صالح 10 دقائق ولـ{PAIRING_MAX_ATTEMPTS} محاولات، ويربط جهازاً واحداً فقط.
            </p>
          </div>

          <Button variant="secondary" icon={<RetryIcon />} onClick={() => void create(branchId)}>
            رمز جديد
          </Button>
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <section aria-label="أجهزة تطلب الربط" className="flex flex-col gap-3">
          {waiting.map((device) => (
            <PendingDevice
              key={device.id}
              device={device}
              busy={busyId === device.id}
              canDecide
              onDecide={(decision) => onDecide(device, decision)}
            />
          ))}
        </section>
      ) : code && !expired ? (
        <p className="text-sm text-ink-muted" role="status">
          حين يستعمل جهاز هذا الرمز يظهر طلبه هنا لتسمح له.
        </p>
      ) : null}
    </div>
  );
}
