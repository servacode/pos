import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Avatar,
  CashierStatusBar,
  CloseIcon,
  cn,
  ConnectionPill,
  ExpandIcon,
  InfoIcon,
  Logo,
  LogoMark,
  MenuItem,
  ThemeToggle,
  useDigits,
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

/** Set the first time the hint is drawn: from then on it lives in «المزيد» and the strip stays away. */
export const INSTALL_HINT_SEEN_KEY = 'serva.installHintSeen';
const INSTALL_HINT_EVENT = 'serva:install-hint';

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function installHintDismissed(): boolean {
  return readFlag(INSTALL_HINT_KEY);
}

/** «ثبّت التطبيق» inside «المزيد»: where the browser warning goes once it has been seen or dismissed. */
export function InstallHintMenuItem({ persisted }: { persisted: boolean | null }) {
  if (persisted !== false) return null;
  if (!readFlag(INSTALL_HINT_KEY) && !readFlag(INSTALL_HINT_SEEN_KEY)) return null;
  return (
    <MenuItem icon={<InfoIcon />} onSelect={() => window.dispatchEvent(new Event(INSTALL_HINT_EVENT))}>
      ثبّت التطبيق
    </MenuItem>
  );
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
 * The one status chip of the bar: «متصل» (or what goes on without internet) at a glance, and on a tap
 * the connection in full, the last send, the time and the last receipt. Esc or a tap elsewhere closes it.
 */
function StatusChip({
  online,
  outbox,
  lastInvoice,
}: {
  online: boolean;
  outbox?: OutboxStatus | null;
  lastInvoice?: ReactNode;
}) {
  const digits = useDigits();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const pending = outbox?.pending ?? 0;
  const sentence = connectionText(online, pending);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <span ref={box} className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-label="حالة الاتصال والإرسال"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 shrink-0 items-center gap-2 rounded-full pe-1 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted"
      >
        <ConnectionPill online={online}>
          {/* The sentence is the chip's text (spoken, and kept for the tooltip); the face shows the short words */}
          <span className="sr-only">{sentence}</span>
          <span aria-hidden="true" title={sentence} className="whitespace-nowrap max-sm:hidden">
            {online ? 'متصل' : 'دون إنترنت'}
          </span>
          {pending > 0 ? (
            <span aria-hidden="true" className="num">
              {pending}
            </span>
          ) : null}
        </ConnectionPill>
        <span className="hidden sm:contents">
          <Clock />
        </span>
        <ExpandIcon size={16} className="shrink-0 text-ink-subtle" />
      </button>
      {open ? (
        <div
          role="group"
          aria-label="تفاصيل الحالة"
          className="absolute end-0 top-full z-70 mt-2 flex w-60 flex-col gap-2 rounded-card border border-line bg-surface p-3 text-sm shadow-e3"
        >
          <p className="font-semibold text-ink">{online ? 'متصل بالإنترنت' : 'دون إنترنت: البيع مستمر'}</p>
          <p className="text-ink-muted">{pending > 0 ? `${pending} بانتظار الإرسال` : 'كل شيء أُرسل'}</p>
          {outbox?.lastSentAt ? (
            <p className="text-ink-muted">آخر إرسال {clockText(outbox.lastSentAt, digits)}</p>
          ) : null}
          <p className="text-ink-muted sm:hidden">
            الساعة <Clock />
          </p>
          {lastInvoice ? <div className="-mx-1 border-t border-line pt-2">{lastInvoice}</div> : null}
        </div>
      ) : null}
    </span>
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
  const [hintHidden, setHintHidden] = useState(installHintDismissed);
  // Seen once on this device: the strip stays away and the hint waits in «المزيد» (asked for, it shows again)
  const [seenBefore] = useState(() => readFlag(INSTALL_HINT_SEEN_KEY));
  const [forced, setForced] = useState(false);
  const showHint = persisted === false && !hintHidden && (!seenBefore || forced);
  // Seen means on screen for a few seconds (a screen that swaps its bar at once has not been read yet)
  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(INSTALL_HINT_SEEN_KEY, '1');
      } catch {
        // The browser keeps nothing: the strip simply shows again next time.
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [showHint]);
  useEffect(() => {
    const again = () => {
      setHintHidden(false);
      setForced(true);
    };
    window.addEventListener(INSTALL_HINT_EVENT, again);
    return () => window.removeEventListener(INSTALL_HINT_EVENT, again);
  }, []);
  // The full height of the top chrome (bar + strip), so what floats under it (toasts) never sits beneath
  const chrome = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = chrome.current;
    if (!element) return;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty('--till-chrome', `${Math.round(element.getBoundingClientRect().bottom)}px`);
    measure();
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    watcher?.observe(element);
    return () => {
      watcher?.disconnect();
      root.style.removeProperty('--till-chrome');
    };
  }, []);
  return (
    <div ref={chrome} className="relative z-60">
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
            {/* A phone has no room for the whole block: the branch alone, so the cashier knows where this till is */}
            <p className={cn('min-w-0 max-w-24 shrink-[3] sm:hidden', user && 'hidden')}>
              <span className="block truncate text-xs/tight font-semibold text-ink-muted">
                {device.storeName}
              </span>
            </p>
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
              <span className="max-sm:hidden">
                <Avatar name={user.name} size="sm" />
              </span>
              <p
                className="flex min-w-0 flex-col"
                title={[user.name, device?.storeName].filter(Boolean).join(' · ')}
              >
                <span className="truncate text-sm/tight font-semibold text-ink">{user.name}</span>
                <span className="truncate text-xs/tight text-ink-muted max-sm:hidden">{user.detail}</span>
                {/* A phone has no room beside the name: the store goes under it, so the cashier knows whose till this is */}
                {device ? (
                  <span className="truncate text-xs/tight text-ink-muted sm:hidden">{device.storeName}</span>
                ) : null}
              </p>
            </div>
          </>
        ) : null}
        <span className="flex-1" />
        {/* One status chip: the connection at a glance; a tap opens the rest (what waits, the last send, the time, the last receipt) */}
        <StatusChip online={online} outbox={outbox} lastInvoice={lastInvoice} />
        <span className="flex shrink-0 items-center gap-1">
          <ThemeToggle size="md" />
          {menu}
        </span>
      </CashierStatusBar>
      {/* Empty (no hint, and the subscription chip says nothing): the strip is not drawn at all */}
      <div className="flex min-h-10 flex-wrap items-center justify-end gap-2 border-b border-line bg-surface px-4 py-1 empty:hidden">
        {showHint ? (
          // Tab 15 › ما يراه الكاشير: the browser may wipe this device's data. Said quietly (a soft
          // chip, not a warning colour) and once understood it stays away: the whole sentence on wide
          // screens; the step to take, with the reason on hover, where the bar is short.
          <span
            role="alert"
            title="هذا المتصفح قد يمسح البيانات، ثبّت التطبيق"
            className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-surface-muted ps-3 pe-1 text-sm font-medium text-ink-muted sm:min-w-0 sm:shrink"
          >
            <InfoIcon size={16} className="shrink-0" />
            {/* The short words always show (a phone too): a readable chip, never a blank pill */}
            <span className="truncate">
              <span className="sr-only 2xl:not-sr-only">هذا المتصفح قد يمسح البيانات، </span>ثبّت التطبيق
            </span>
            <button
              type="button"
              aria-label="أخفِ تنبيه التثبيت"
              onClick={() => {
                setHintHidden(true);
                setForced(false);
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
      </div>
    </div>
  );
}
