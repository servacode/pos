import { useEffect, useState, type ReactNode } from 'react';
import {
  Avatar,
  CashierStatusBar,
  CloseIcon,
  ConnectionPill,
  Logo,
  LogoMark,
  ThemeToggle,
  useDigits,
  WarningIcon,
} from '@serva/ui';
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
  /** The subscription chip (trial ending, grace, read-only) */
  notice?: ReactNode;
}

/** Where the cashier's «understood» for the browser warning is kept (this browser, not the store's data). */
export const INSTALL_HINT_KEY = 'serva.installHintDismissed';

function installHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** A hairline between the bar's groups. */
function Divider() {
  return <span aria-hidden="true" className="h-7 w-px shrink-0 bg-line" />;
}

/**
 * The time on the till, to the minute. Its own small component, so the tick re-renders the clock
 * alone and never the sale beside it.
 */
function Clock() {
  const digits = useDigits();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time
      dateTime={new Date(now).toISOString()}
      className="num shrink-0 text-sm font-semibold whitespace-nowrap text-ink"
    >
      {clockText(now, digits)}
    </time>
  );
}

/**
 * The cashier status bar (kit cashier/StatusBar; هوية 4): at the start the store, the branch and
 * device, and who works with their shift; at the end the browser warning when there is one, the
 * last invoice, the connection with what waits to be sent and when it last went, the time, the
 * theme and the menu.
 */
export function StatusBar({
  device,
  persisted,
  online,
  outbox,
  user,
  lastInvoice,
  menu,
  notice,
}: StatusBarProps) {
  const digits = useDigits();
  const [hintHidden, setHintHidden] = useState(installHintDismissed);
  return (
    <CashierStatusBar>
      {/* The whole logo where the bar is wide; the mark alone where the store and the person need room */}
      <span className="hidden shrink-0 xl:flex">
        <Logo />
      </span>
      <LogoMark className="xl:hidden" />
      {device ? (
        <>
          <span className="hidden sm:contents">
            <Divider />
          </span>
          <p className="hidden min-w-24 shrink-[2] flex-col sm:flex">
            <span className="truncate text-sm/tight font-semibold text-ink">{device.storeName}</span>
            <span className="truncate text-xs/tight text-ink-muted">
              {device.branchName} · {device.deviceName}
            </span>
          </p>
        </>
      ) : null}
      {user ? (
        <>
          <Divider />
          <div className="flex min-w-28 shrink-[2] items-center gap-2.5">
            <Avatar name={user.name} size="sm" />
            <p className="flex min-w-0 flex-col">
              <span className="truncate text-sm/tight font-semibold text-ink">{user.name}</span>
              <span className="hidden truncate text-xs/tight text-ink-muted sm:block">{user.detail}</span>
            </p>
          </div>
        </>
      ) : null}
      <span className="flex-1" />
      {persisted === false && !hintHidden ? (
        // Tab 15 › ما يراه الكاشير: the browser may wipe this device's data. Said quietly (a soft
        // chip, not a warning colour) and once understood it stays away: the whole sentence on wide
        // screens; the step to take, with the reason on hover, where the bar is short.
        <span
          role="alert"
          title="هذا المتصفح قد يمسح البيانات، ثبّت التطبيق"
          className="inline-flex min-h-8 min-w-0 items-center gap-1 rounded-full bg-surface-muted ps-3 pe-1 text-sm font-medium text-ink-muted"
        >
          <WarningIcon size={16} className="shrink-0" />
          <span className="truncate">
            <span className="sr-only 2xl:not-sr-only">هذا المتصفح قد يمسح البيانات، </span>ثبّت التطبيق
          </span>
          <button
            type="button"
            aria-label="أخفِ تنبيه التثبيت"
            onClick={() => {
              setHintHidden(true);
              try {
                window.localStorage.setItem(INSTALL_HINT_KEY, '1');
              } catch {
                // The browser keeps nothing: it will say so again next time.
              }
            }}
            className="grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-120 ease-standard hover:bg-line"
          >
            <CloseIcon size={16} />
          </button>
        </span>
      ) : null}
      {notice}
      {lastInvoice}
      <span className="flex shrink-0 items-center gap-2.5">
        <ConnectionPill online={online}>
          {/* The long sentence gives way (shortened with its full text on hover) so the store and the person keep their names */}
          <span
            title={connectionText(online, outbox?.pending ?? 0)}
            className="sr-only sm:not-sr-only sm:block sm:max-w-40 sm:truncate min-[1700px]:max-w-none"
          >
            {connectionText(online, outbox?.pending ?? 0)}
          </span>
          {/* On a phone the sentence is spoken only; what waits shows as a number, so it is never squeezed */}
          {(outbox?.pending ?? 0) > 0 ? (
            <span aria-hidden="true" className="num sm:hidden">
              {outbox!.pending}
            </span>
          ) : null}
        </ConnectionPill>
        {outbox?.lastSentAt ? (
          <span className="hidden shrink-0 text-xs whitespace-nowrap text-ink-muted xl:inline">
            آخر إرسال {clockText(outbox.lastSentAt, digits)}
          </span>
        ) : null}
      </span>
      <span className="hidden sm:contents">
        <Divider />
        <Clock />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <ThemeToggle size="md" />
        {menu}
      </span>
    </CashierStatusBar>
  );
}
