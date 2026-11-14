import * as RadixDialog from '@radix-ui/react-dialog';
import { useDirection } from '@radix-ui/react-direction';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { useDensity, type Density } from './context';
import { CloseIcon } from './icons';

// ── One overlay at a time ───────────────────────────────────────────────────────────────────────
// Tab 14: no dialog over a dialog. A step that needs another decision (the manager code during a
// payment) is a layer inside the open dialog or sheet, never a second window on top of it. The
// first overlay to open holds the slot; another one asking while it is open is refused and logged.

let owner: symbol | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function currentOwner() {
  return owner;
}

function setOwner(next: symbol | null) {
  owner = next;
  listeners.forEach((listener) => listener());
}

/** True while this overlay is open and holds the one overlay slot. */
function useOverlaySlot(open: boolean): boolean {
  const [me] = useState(() => Symbol('overlay'));
  const holder = useSyncExternalStore(subscribe, currentOwner, currentOwner);

  useEffect(() => {
    if (!open) return;
    if (owner === null) setOwner(me);
    else if (owner !== me) {
      console.error(
        '[@serva/ui] A dialog or sheet is already open. Show this step as a layer inside it instead (tab 14: no dialog over a dialog).',
      );
    }
    return () => {
      if (owner === me) setOwner(null);
    };
  }, [open, me]);

  return open && holder === me;
}

// ── Dialog ──────────────────────────────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** The buttons at the end. The safe one comes first and has focus; the action names itself. */
  actions?: ReactNode;
  /** Small for a confirmation (400), medium for a short form (480). */
  size?: 'sm' | 'md';
}

// هوية 4 › Dialog: the page dims behind a light blur; the window floats on it (panel radius, the
// floating shadow and a hairline, which carries the edge in dark mode).
const OVERLAY = 'fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] motion-safe:animate-fade';
const PANEL = 'bg-surface text-ink shadow-e3';
const TITLE = 'text-lg font-semibold text-ink';

/** The description under the title: 14 on the admin, 16 on the cashier (tab 14: never under 16 there). */
function descriptionClass(density: Density): string {
  return cn(density === 'touch' ? 'text-base' : 'text-sm', 'text-ink-muted');
}

/**
 * A decision or a short form (tab 14 › النافذة). Esc and the close button close it; a click outside
 * does not, so nothing typed is lost by a slip.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  size = 'md',
}: DialogProps) {
  const shown = useOverlaySlot(open);
  const dir = useDirection();
  const density = useDensity();
  return (
    <RadixDialog.Root open={shown} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cn(OVERLAY, 'grid place-items-center overflow-y-auto p-4 sm:p-6')}>
          <RadixDialog.Content
            dir={dir}
            {...(description ? {} : { 'aria-describedby': undefined })}
            onInteractOutside={(event) => event.preventDefault()}
            className={cn(
              'relative flex w-full flex-col gap-5 rounded-panel border border-line p-6 motion-safe:animate-rise',
              PANEL,
              size === 'sm' ? 'max-w-100' : 'max-w-120',
            )}
          >
            <div className="flex items-start gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <RadixDialog.Title className={TITLE}>{title}</RadixDialog.Title>
                {description ? (
                  <RadixDialog.Description className={descriptionClass(density)}>
                    {description}
                  </RadixDialog.Description>
                ) : null}
              </div>
              <RadixDialog.Close asChild>
                <IconButton label="أغلق" icon={<CloseIcon />} className="-me-2 -mt-2" />
              </RadixDialog.Close>
            </div>
            {children}
            {/* At the end of the line, the safe action first (هوية 4 › Dialog). */}
            {actions ? (
              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">{actions}</div>
            ) : null}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// ── Sheet ───────────────────────────────────────────────────────────────────────────────────────

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Fixed at the bottom of the sheet: the main action (pay, save). */
  footer?: ReactNode;
  /** 'end': a side panel from the inline end, the left in Arabic. 'bottom': the phone sheet. */
  side?: 'end' | 'bottom';
  /** Close on a click outside. Off by default: the payment sheet must not close by a slip. */
  closeOnOutsideClick?: boolean;
}

/**
 * Details and edits without leaving the page, and the cashier's payment (tab 14 › اللوح الجانبي):
 * slides in from the left in Arabic, or up from the bottom on a phone. The dialog's skin (هوية 4 ›
 * Sheet): the panel radius on the corners that face the page, the hairline on that edge.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'end',
  closeOnOutsideClick = false,
}: SheetProps) {
  const shown = useOverlaySlot(open);
  const dir = useDirection();
  const density = useDensity();
  const bottom = side === 'bottom';
  return (
    <RadixDialog.Root open={shown} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content
          dir={dir}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onInteractOutside={closeOnOutsideClick ? undefined : (event) => event.preventDefault()}
          className={cn(
            'fixed z-40 flex flex-col',
            PANEL,
            bottom
              ? 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-panel border-t border-line pb-[env(safe-area-inset-bottom)] motion-safe:animate-sheet-up'
              : // The whole window, square, while it is no wider than the panel (30rem, max-w-120); in
                // a wider one the panel stands clear of the page edge with its inner corners rounded.
                // In rem like the width, so the two still meet at a larger browser text size.
                'inset-y-0 end-0 w-full max-w-120 border-s border-line motion-safe:animate-sheet-in [@media(width>30rem)]:rounded-s-panel',
          )}
        >
          {bottom ? (
            <span
              aria-hidden="true"
              className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-control/50"
            />
          ) : null}
          <div
            className={cn(
              'flex shrink-0 items-start gap-4 px-6',
              bottom ? 'pt-3 pb-1' : 'border-b border-line py-5',
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <RadixDialog.Title className={TITLE}>{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className={descriptionClass(density)}>
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="أغلق" icon={<CloseIcon />} className="-me-2 -mt-2" />
            </RadixDialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
