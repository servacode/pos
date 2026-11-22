import type { DeviceSummary } from '@serva/core';
import { Button, ShieldCheckIcon } from '@serva/ui';
import { deviceTypeLabel, formatSince } from '../../lib/devices';
import { useNow } from '../../lib/useNow';
import { KIND_ICONS } from './DeviceRow';

interface PendingDeviceProps {
  device: DeviceSummary;
  busy: boolean;
  /** The owner decides; a manager only sees that it waits */
  canDecide: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}

/**
 * «جهاز جديد يطلب الربط» (kit owner-phone/DeviceApprove): who, where, when, then «ارفض» · «اسمح».
 * A card edged in the warning colour, a warning dot beside its title: it waits for the owner.
 */
export function PendingDevice({ device, busy, canDecide, onDecide }: PendingDeviceProps) {
  const KindIcon = KIND_ICONS[device.kind];
  const now = useNow(30_000);
  return (
    <article
      aria-label={`طلب ربط: ${device.name}`}
      className="flex flex-col gap-4 rounded-card border border-warning/40 bg-surface p-4 shadow-e1 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-control bg-warning-soft text-warning-ink">
          <KindIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-warning-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-warning ring-4 ring-warning/20" />
            جهاز جديد يطلب الربط
          </span>
          <span className="text-ink">
            <bdi className="font-bold">{device.name}</bdi>
            <span className="text-sm text-ink-muted"> · {deviceTypeLabel(device.kind, device.platform)}</span>
          </span>
          <span className="text-xs text-ink-muted">
            {device.branchName} · {formatSince(device.createdAt, now)}
          </span>
        </div>
      </div>
      {canDecide ? (
        <>
          <p className="rounded-control bg-warning-soft px-3 py-2 text-xs text-warning-ink">
            اسمح فقط لجهاز تراه أمامك أو طلبت ربطه. لم تطلب هذا؟ اضغط «ارفض» ثم غيّر كلمة السر.
          </p>
          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            <Button
              variant="danger-soft"
              disabled={busy}
              onClick={() => onDecide('reject')}
              aria-label={`ارفض: ${device.name}`}
            >
              ارفض
            </Button>
            <Button
              icon={<ShieldCheckIcon />}
              loading={busy}
              onClick={() => onDecide('approve')}
              aria-label={`اسمح: ${device.name}`}
            >
              اسمح
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-muted">ينتظر موافقة المالك.</p>
      )}
    </article>
  );
}
