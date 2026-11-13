import { useState } from 'react';
import { Button } from '@serva/ui';
import { CancelView } from '../../hall/waiter/OrderView';
import type { PinStatus } from '../PinScreen';
import { approversFor } from '../staff/approve';
import type { StaffMember } from '../staff/staff';
import type { CancelAnswer } from './cancelSent';
import { SalePanel } from '../sale/SalePanel';

/**
 * A line the kitchen already has, removed at the till: the same «سبب + رمز المدير» the waiter gives,
 * so the kitchen screen shows the cancellation. «احذفه من هنا فقط» keeps today's behaviour (the
 * line leaves this cart; the kitchen is not told).
 */
export function CancelSentLine({
  name,
  staff,
  onConfirm,
  onLocalOnly,
  onBack,
}: {
  name: string;
  staff: readonly StaffMember[];
  onConfirm: (input: { reason: string; approverId: string; pin: string }) => Promise<CancelAnswer>;
  onLocalOnly: () => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PinStatus>({ kind: 'idle' });
  const approvers = approversFor(staff, 'hall.cancel_approve').map((m) => ({
    id: m.id,
    fullName: m.fullName,
  }));
  return (
    <SalePanel label="إلغاء بند وصل المطبخ" title="إلغاء بند وصل المطبخ">
      <CancelView
        line={{ name }}
        approvers={approvers}
        status={status}
        busy={busy}
        onBack={onBack}
        onConfirm={async (input) => {
          setBusy(true);
          setStatus({ kind: 'idle' });
          const answer = await onConfirm(input);
          setBusy(false);
          if (answer.kind === 'status') setStatus(answer.status);
          else if (answer.kind === 'error') setStatus({ kind: 'message', text: answer.message });
        }}
      />
      <Button variant="ghost" size="md" onClick={onLocalOnly}>
        احذفه من هنا فقط، دون إخبار المطبخ
      </Button>
    </SalePanel>
  );
}
