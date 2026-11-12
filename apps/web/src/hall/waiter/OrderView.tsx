import { useState } from 'react';
import {
  LINE_STATUS_TEXT,
  type HallLine,
  type HallMenuResponse,
  type HallOrder,
  type LineStatus,
} from '@serva/core';
import type { CurrencyCode } from '@serva/core/currencies';
import { Alert, Badge, Button, cn, Money, TextField, type BadgeTone } from '@serva/ui';
import { PinPad, type PinStatus } from '../../pos/PinScreen';
import { lineTotalMinor } from '../format';

const TONE: Record<LineStatus, BadgeTone> = {
  new: 'neutral',
  sent: 'info',
  preparing: 'warning',
  ready: 'success',
  served: 'neutral',
  cancelled: 'danger',
};

/** What a line costs on the estimated bill: the menu's price with its choices */
function lineMinor(line: HallLine, menu: HallMenuResponse): number {
  const item = menu.items.find((i) => i.variantId === line.variantId);
  return item ? lineTotalMinor(item.priceMinor, line.choices, line.qty) : 0;
}

export function estimateMinor(order: HallOrder, menu: HallMenuResponse): number {
  return order.lines.filter((l) => l.status !== 'cancelled').reduce((sum, l) => sum + lineMinor(l, menu), 0);
}

/** The manager's approval of a cancellation after the kitchen: the reason, whose code, the code */
export function CancelView({
  line,
  approvers,
  status,
  busy,
  onConfirm,
  onBack,
}: {
  line: HallLine;
  approvers: HallMenuResponse['approvers'];
  status: PinStatus;
  busy: boolean;
  onConfirm: (input: { reason: string; approverId: string; pin: string }) => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState(approvers.length === 1 ? approvers[0]!.id : '');
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="إلغاء بند بعد المطبخ" className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">إلغاء «{line.name}»</h2>
      <p className="text-ink-muted">
        البند وصل المطبخ: الإلغاء يحتاج سبباً ورمز المدير، ويظهر في تقرير الإلغاءات.
      </p>
      <TextField
        label="سبب الإلغاء"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
      />
      {approvers.length === 0 ? (
        <Alert tone="warning">لا يوجد مدير له رمز دخول على هذا الفرع.</Alert>
      ) : (
        <div role="radiogroup" aria-label="المدير" className="flex flex-wrap gap-2">
          {approvers.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={approverId === a.id}
              onClick={() => setApproverId(a.id)}
              className={cn(
                'min-h-12 rounded-control border px-4 font-semibold',
                approverId === a.id
                  ? 'border-brand bg-brand-soft text-brand-ink'
                  : 'border-line-control bg-surface',
              )}
            >
              {a.fullName}
            </button>
          ))}
        </div>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {approverId ? (
        <PinPad
          length={6}
          label="رمز المدير"
          captureKeyboard={false}
          status={busy ? { kind: 'checking' } : status}
          onComplete={(pin) => {
            if (reason.trim().length < 2) {
              setError('اكتب سبب الإلغاء.');
              return;
            }
            setError(null);
            onConfirm({ reason: reason.trim(), approverId, pin });
          }}
        />
      ) : null}
      <Button variant="ghost" size="lg" onClick={onBack}>
        رجوع
      </Button>
    </section>
  );
}

/**
 * One table's order for the waiter: the lines by state, what is still not sent, «قدّم» for what is
 * ready, and the three actions: add, send to the kitchen, ask for the bill. No payment here.
 */
export function OrderView({
  order,
  menu,
  busy,
  onAdd,
  onSend,
  onBill,
  onRemove,
  onServe,
  onCancel,
  onBack,
}: {
  order: HallOrder;
  menu: HallMenuResponse;
  busy: boolean;
  onAdd: () => void;
  onSend: () => void;
  onBill: () => void;
  onRemove: (line: HallLine) => void;
  onServe: (lines: HallLine[]) => void;
  onCancel: (line: HallLine) => void;
  onBack: () => void;
}) {
  const live = order.lines.filter((l) => l.status !== 'cancelled' || l.cancelledAfterSend);
  const fresh = order.lines.filter((l) => l.status === 'new');
  const ready = order.lines.filter((l) => l.status === 'ready');
  const hasLines = order.lines.some((l) => l.status !== 'cancelled');
  const currency = menu.currency as CurrencyCode;
  return (
    <section aria-label={`طلب الطاولة ${order.table}`} className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <h2 className="text-2xl font-bold">
          طاولة <span className="num">{order.table}</span>
        </h2>
        {order.guests ? <Badge>{order.guests} أشخاص</Badge> : null}
        {order.status === 'bill_requested' ? <Badge tone="info">بانتظار الحساب</Badge> : null}
        <span className="flex-1" />
        <Button variant="ghost" size="md" onClick={onBack}>
          الطاولات
        </Button>
      </header>

      {ready.length > 0 ? (
        <Button size="lg" variant="primary" disabled={busy} onClick={() => onServe(ready)}>
          قدّم الجاهز ({ready.length})
        </Button>
      ) : null}

      {live.length === 0 ? (
        <p className="py-6 text-center text-ink-muted">لا أصناف بعد. اضغط «إضافة صنف».</p>
      ) : (
        <ul aria-label="أصناف الطلب" className="flex flex-col gap-2">
          {live.map((line) => (
            <li
              key={line.id}
              className={cn(
                'flex flex-col gap-2 rounded-card border bg-surface px-4 py-3 shadow-e1',
                line.status === 'ready' ? 'border-success' : 'border-line',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="num text-xl font-bold">{line.qty}×</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn('text-lg font-semibold', line.status === 'cancelled' && 'line-through')}
                  >
                    {line.name}
                  </span>
                  {line.seat ? <span className="text-sm text-ink-subtle">مقعد {line.seat}</span> : null}
                  {line.status === 'cancelled' && line.cancelReason ? (
                    <span className="text-sm text-danger-ink">{line.cancelReason}</span>
                  ) : null}
                </div>
                <Badge tone={TONE[line.status]}>{LINE_STATUS_TEXT[line.status]}</Badge>
              </div>
              <div className="flex gap-2">
                {line.status === 'new' ? (
                  <Button variant="ghost" size="md" disabled={busy} onClick={() => onRemove(line)}>
                    احذف {line.name}
                  </Button>
                ) : null}
                {line.status === 'sent' || line.status === 'preparing' || line.status === 'ready' ? (
                  <Button variant="ghost" size="md" disabled={busy} onClick={() => onCancel(line)}>
                    ألغِ {line.name}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasLines ? (
        <p className="flex items-center justify-between rounded-card bg-surface-total px-4 py-3 text-lg font-bold">
          الإجمالي التقريبي
          <Money minor={estimateMinor(order, menu)} currency={currency} />
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3">
        <Button size="lg" variant="secondary" disabled={busy} onClick={onAdd}>
          إضافة صنف
        </Button>
        <Button size="lg" disabled={busy || fresh.length === 0} onClick={onSend}>
          أرسل للمطبخ{fresh.length > 0 ? ` (${fresh.length})` : ''}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={busy || !hasLines || order.status === 'bill_requested'}
          onClick={onBill}
        >
          كشف حساب
        </Button>
      </div>
    </section>
  );
}
