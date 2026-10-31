import { useState, type ReactNode } from 'react';
import type { Permission } from '@serva/core';
import type { Approval } from '@serva/core/contracts/documents';
import { Button, cn, KeyIcon } from '@serva/ui';
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
      className="flex flex-col gap-3 rounded-card border-2 border-warning bg-warning-soft/60 p-4 motion-safe:animate-rise"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-ink">
          <KeyIcon size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-lg font-bold text-ink">رمز المدير</h3>
          <p className="text-sm text-ink-muted">{reason}</p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
      {approvers.length === 0 ? (
        <p role="alert" className="text-sm font-semibold text-danger-ink">
          لا يوجد على هذا الجهاز مدير برمز من 6 أرقام يملك هذه الموافقة.
        </p>
      ) : (
        <>
          {approvers.length > 1 ? (
            <div role="group" aria-label="من يوافق؟" className="flex flex-wrap gap-2">
              {approvers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={picked?.id === m.id}
                  onClick={() => {
                    setPicked(m);
                    setStatus({ kind: 'idle' });
                  }}
                  className={cn(
                    'min-h-12 rounded-full border-2 px-4 font-semibold',
                    picked?.id === m.id
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line bg-surface text-ink',
                  )}
                >
                  {m.fullName}
                </button>
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
