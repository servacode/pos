import type { ReactNode } from 'react';
import { Avatar, CashierStatusBar, ConnectionPill, Logo, useDigits } from '@serva/ui';
import type { LocalDevice } from '../offline/device';
import { clockText } from './format';

export interface OutboxStatus {
  pending: number;
  /** When the device last sent its documents (meta.lastPushAt), or null */
  lastSentAt: number | null;
}

/** «متصل · كل شيء أُرسل», «متصل · 3 بانتظار الإرسال», «دون إنترنت · البيع مستمر · 3 بانتظار الإرسال». */
export function connectionText(online: boolean, pending: number): string {
  const waiting = pending > 0 ? `${pending} بانتظار الإرسال` : null;
  if (online) return waiting ? `متصل · ${waiting}` : 'متصل · كل شيء أُرسل';
  return waiting ? `دون إنترنت · البيع مستمر · ${waiting}` : 'دون إنترنت · البيع مستمر';
}

export interface StatusBarProps {
  device: LocalDevice | null;
  persisted: boolean | null;
  online: boolean;
  outbox?: OutboxStatus | null;
  /** The signed-in person and their shift */
  user?: { name: string; detail: ReactNode } | null;
  /** «آخر فاتورة»: reprints the last receipt */
  lastInvoice?: ReactNode;
  menu?: ReactNode;
}

/**
 * The cashier status bar (kit cashier/StatusBar): the store, the branch and device, who works, the
 * last invoice, the connection with what waits to be sent, and the last time it was sent.
 */
export function StatusBar({ device, persisted, online, outbox, user, lastInvoice, menu }: StatusBarProps) {
  const digits = useDigits();
  return (
    <CashierStatusBar>
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
      {user ? (
        <div className="flex min-w-0 items-center gap-2 border-s border-line ps-3">
          <Avatar name={user.name} size="sm" />
          <p className="flex min-w-0 flex-col">
            <span className="truncate text-sm/tight font-semibold text-ink">{user.name}</span>
            <span className="truncate text-xs/tight text-ink-muted">{user.detail}</span>
          </p>
        </div>
      ) : null}
      <span className="flex-1" />
      {persisted === false ? (
        // Tab 15 › ما يراه الكاشير: the browser may wipe this device's data.
        <span role="alert" className="truncate text-sm font-semibold text-danger-ink">
          هذا المتصفح قد يمسح البيانات، ثبّت التطبيق
        </span>
      ) : null}
      {lastInvoice}
      <ConnectionPill online={online}>{connectionText(online, outbox?.pending ?? 0)}</ConnectionPill>
      {outbox?.lastSentAt ? (
        <span className="shrink-0 text-xs whitespace-nowrap text-ink-muted">
          آخر إرسال {clockText(outbox.lastSentAt, digits)}
        </span>
      ) : null}
      {menu}
    </CashierStatusBar>
  );
}
