import { useState, type ReactNode } from 'react';
import type { Permission } from '@serva/core';
import type { Approval } from '@serva/core/contracts/documents';
import { AlertCircleIcon, Button, IconChip, KeyIcon } from '@serva/ui';
import { OptionChip } from '../FlowParts';
import { PinPad, type PinStatus } from '../PinScreen';
import { usePos } from '../services';
import { approveWithCode, approversFor } from './approve';
import type { StaffMember } from './staff';
import { statusOf } from './StaffSignIn';

/**
 * «رمز المدير» as a layer inside the open panel (tab 14: no dialog over a dialog): who approves,
 * then their 6-digit code. The approval carries their id, the moment, and whether the device was
 * offline (the server flags approval_offline).
 */
export function ManagerCode({
  staff,
  permission,
  reason,
  onApproved,
  onCancel,
}: {
  staff: readonly StaffMember[];
  permission: Permission;
  /** Why it is needed, in one line */
  reason: ReactNode;
  onApproved: (approval: Approval, approver: StaffMember) => void;
  onCancel: () => void;
}) {
  const pos = usePos();
  const approvers = approversFor(staff, permission);
  const [picked, setPicked] = useState<StaffMember | null>(approvers.length === 1 ? approvers[0]! : null);
  const [status, setStatus] = useState<PinStatus>({ kind: 'idle' });

  async function submit(pin: string) {
    if (!picked) return;
    setStatus({ kind: 'checking' });
    const result = await approveWithCode(
      { local: pos.local, token: pos.device.token, online: pos.online(), now: pos.now, fetch: pos.fetch },
      picked,
      pin,
    );
    if (result.ok) onApproved(result.approval, result.approver);
    else setStatus(statusOf(result));
  }

  return (
    <section
      aria-label="رمز المدير"
      className="flex flex-col gap-4 rounded-card border border-warning/30 bg-surface p-4 shadow-e2 motion-safe:animate-rise sm:p-5"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <IconChip tone="warning">
            <KeyIcon />
          </IconChip>
          <h3 className="min-w-0 flex-1 text-lg font-semibold text-ink">رمز المدير</h3>
          <Button variant="ghost" onClick={onCancel}>
            إلغاء
          </Button>
        </div>
        <p className="text-sm text-ink-muted">{reason}</p>
      </div>
      {approvers.length === 0 ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-card border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger-ink"
        >
          <AlertCircleIcon size={20} className="shrink-0" />
          لا يوجد على هذا الجهاز مدير برمز من 6 أرقام يملك هذه الموافقة.
        </p>
      ) : (
        <>
          {approvers.length > 1 ? (
            <div role="group" aria-label="من يوافق؟" className="flex flex-wrap gap-2">
              {approvers.map((m) => (
                <OptionChip
                  key={m.id}
                  selected={picked?.id === m.id}
                  onClick={() => {
                    setPicked(m);
                    setStatus({ kind: 'idle' });
                  }}
                >
                  {m.fullName}
                </OptionChip>
              ))}
            </div>
          ) : null}
          {picked ? (
            <PinPad
              key={picked.id}
              length={6}
              label={`رمز ${picked.fullName}`}
              onComplete={submit}
              status={status}
            />
          ) : (
            <p className="text-sm text-ink-muted">اختر من يوافق، ثم يكتب رمزه.</p>
          )}
        </>
      )}
    </section>
  );
}
