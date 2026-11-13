import { useCallback, useEffect, useState } from 'react';
import {
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_SECONDS,
  type DeviceSummary,
  type MeResponse,
  type PairingCodeResponse,
  type CreatePairingCodeInput,
} from '@serva/core';
import { Alert, Button, ClockIcon, DeviceIcon, ProgressBar, RetryIcon, Select, Skeleton } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { DEVICE_KIND_LABELS, formatCountdown, formatPairingCode } from '../../lib/devices';
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
 * «اربط جهازاً جديداً»: a pairing code for a branch, as a large QR on its light square and as the
 * 8-character code in big equal-width letters with the store code, valid 10 minutes. A device that
 * uses it shows up at the top, in the place kept for it, for «اسمح» or «ارفض».
 */
export function PairingDialogBody({ branches, pending, busyId, onDecide }: PairingDialogBodyProps) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [kind, setKind] = useState<NonNullable<CreatePairingCodeInput['kind']>>('cashier');
  const [code, setCode] = useState<PairingCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const now = useNow(1000, code !== null);

  const create = useCallback(
    async (forBranch: string, forKind: NonNullable<CreatePairingCodeInput['kind']>) => {
      setCreating(true);
      setError(null);
      setCode(null);
      try {
        setCode(
          await createPairingCode({
            branchId: forBranch,
            ...(forKind === 'cashier' ? {} : { kind: forKind }),
          }),
        );
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (branchId) void create(branchId, kind);
  }, [branchId, kind, create]);

  const left = code ? Date.parse(code.expiresAt) - now : 0;
  const expired = code !== null && left <= 0;
  const waiting = pending.filter((device) => device.branchId === branchId);

  return (
    <div className="flex flex-col gap-5">
      {/* The requests come first: here a device that used the code waits for «اسمح». */}
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
        <p
          role="status"
          className="flex items-center gap-3 rounded-card border border-dashed border-line-control/50 px-4 py-3 text-sm text-ink-muted"
        >
          <DeviceIcon className="text-ink-subtle" />
          حين يستعمل جهاز هذا الرمز يظهر طلبه هنا لتسمح له.
        </p>
      ) : null}

      {branches.length > 1 ? (
        <Select label="الفرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      ) : null}

      <Select
        label="نوع الجهاز"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
        hint="جوال النادل وشاشة المطبخ يفتحان صفحتيهما من الرابط نفسه."
      >
        {(['cashier', 'waiter', 'kitchen_screen', 'call_screen'] as const).map((k) => (
          <option key={k} value={k}>
            {DEVICE_KIND_LABELS[k]}
          </option>
        ))}
      </Select>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {creating ? (
        <div aria-busy="true" className="flex flex-col items-center gap-4">
          <span className="sr-only">نجهّز رمز الربط…</span>
          <Skeleton className="size-52" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {code ? (
        <div className="flex flex-col items-center gap-4">
          {/* Dark modules on a light square in both modes: scanners refuse an inverted code. */}
          <div className="rounded-card border border-line bg-surface p-2 shadow-e1 dark:bg-ink">
            {expired ? (
              <div className="grid size-48 place-items-center text-center text-sm font-semibold text-ink-muted dark:text-surface">
                انتهى الرمز
              </div>
            ) : (
              <QrCode
                value={code.qrPayload}
                label={`رمز QR لربط جهاز في ${code.branchName}`}
                className="size-48"
              />
            )}
          </div>

          <span className="text-center text-sm text-ink-muted">
            امسح الرمز من شاشة «ربط الجهاز» على الجهاز الجديد، أو اكتب:
          </span>
          <div className="flex w-full flex-col items-center gap-1 rounded-card border border-line bg-surface-muted/60 px-4 py-3">
            <span className="text-xs font-semibold text-ink-subtle">رمز الربط</span>
            <bdi dir="ltr" className="num text-3xl font-bold tracking-[0.18em] text-ink">
              {formatPairingCode(code.manualCode)}
            </bdi>
            <span className="text-sm text-ink-muted">
              رمز المتجر <bdi className="num font-bold tracking-wider text-ink">{code.storeCode}</bdi>
            </span>
          </div>

          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink" role="timer">
                <ClockIcon size={16} className="text-warning-ink" />
                {expired ? (
                  'انتهى الرمز. اطلب رمزاً جديداً.'
                ) : (
                  <>
                    ينتهي بعد <span className="num">{formatCountdown(left)}</span> · {code.branchName}
                  </>
                )}
              </p>
              <Button
                variant={expired ? 'primary' : 'ghost'}
                size="sm"
                icon={<RetryIcon size={16} />}
                onClick={() => void create(branchId, kind)}
                className="-me-2"
              >
                رمز جديد
              </Button>
            </div>
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
        </div>
      ) : null}
    </div>
  );
}
