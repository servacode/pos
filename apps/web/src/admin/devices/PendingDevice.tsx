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

/** «جهاز جديد يطلب الربط» (kit owner-phone/DeviceApprove): who, where, when, then «ارفض» · «اسمح». */
export function PendingDevice({ device, busy, canDecide, onDecide }: PendingDeviceProps) {
  const KindIcon = KIND_ICONS[device.kind];
  const now = useNow(30_000);
  return (
    <article
      aria-label={`طلب ربط: ${device.name}`}
      className="flex flex-col gap-3 rounded-card border-2 border-warning bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-info-soft text-info-ink">
          <KindIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-ink">جهاز جديد يطلب الربط</span>
          <span className="text-sm text-ink">
            <bdi className="font-bold">{device.name}</bdi> · {deviceTypeLabel(device.kind, device.platform)}
          </span>
          <span className="text-xs text-ink-muted">
            {device.branchName} · {formatSince(device.createdAt, now)}
          </span>
        </div>
      </div>
      {canDecide ? (
        <>
          <p className="text-xs text-ink-muted">
            اسمح فقط لجهاز تراه أمامك أو طلبت ربطه. لم تطلب هذا؟ اضغط «ارفض» ثم غيّر كلمة السر.
          </p>
          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            <Button
              variant="secondary"
              className="text-danger-ink"
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
