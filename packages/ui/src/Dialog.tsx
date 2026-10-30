import * as RadixDialog from '@radix-ui/react-dialog';
import { useDirection } from '@radix-ui/react-direction';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
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

const OVERLAY = 'fixed inset-0 z-40 bg-overlay motion-safe:animate-fade';

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
  return (
    <RadixDialog.Root open={shown} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cn(OVERLAY, 'grid place-items-center overflow-y-auto p-4')}>
          <RadixDialog.Content
            dir={dir}
            {...(description ? {} : { 'aria-describedby': undefined })}
            onInteractOutside={(event) => event.preventDefault()}
            className={cn(
              'relative flex w-full flex-col gap-4 rounded-card bg-surface p-6 text-ink shadow-e3 motion-safe:animate-rise',
              size === 'sm' ? 'max-w-100' : 'max-w-120',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <RadixDialog.Title className="text-xl font-semibold">{title}</RadixDialog.Title>
                {description ? (
                  <RadixDialog.Description className="text-ink-muted">{description}</RadixDialog.Description>
                ) : null}
              </div>
              <RadixDialog.Close asChild>
                <IconButton label="أغلق" icon={<CloseIcon />} className="-me-2 -mt-2" />
              </RadixDialog.Close>
            </div>
            {children}
            {actions ? <div className="flex flex-wrap justify-end gap-3">{actions}</div> : null}
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
 * slides in from the left in Arabic, or up from the bottom on a phone.
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
            'fixed z-40 flex flex-col bg-surface text-ink shadow-e3',
            bottom
              ? 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-card pb-[env(safe-area-inset-bottom)] motion-safe:animate-sheet-up'
              : 'inset-y-0 end-0 w-full max-w-120 motion-safe:animate-sheet-in',
          )}
        >
          {bottom ? (
            <span aria-hidden="true" className="mx-auto mt-3 h-1 w-10 rounded-full bg-line-control" />
          ) : null}
          <div className={cn('flex items-start gap-3 px-6', bottom ? 'pt-3' : 'border-b border-line py-4')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <RadixDialog.Title className="text-xl font-semibold">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-ink-muted">{description}</RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="أغلق" icon={<CloseIcon />} className="-me-2" />
            </RadixDialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">{children}</div>
          {footer ? <div className="border-t border-line px-6 py-4">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
