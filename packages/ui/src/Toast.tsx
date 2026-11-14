import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';
import { AlertCircleIcon, CheckCircleIcon, CloseIcon, InfoIcon, type Icon } from './icons';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  /** What was done, named: «حُفظ المنتج», «أُرسلت الفاتورة على واتساب». */
  message: string;
  /** «تراجع» when the action can be undone. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  /**
   * The density of the screen that raised it (useToast): touch on the cashier, comfortable on the
   * admin. The toast's controls and text follow it wherever the ToastProvider sits in the tree.
   */
  density: Density;
}

/** How long a toast stays (tab 14 › الإشعار المؤقت): 4 s, paused while hovered or focused. */
export const TOAST_DURATION_MS = 4000;

/**
 * The status disc of each tone (هوية 4 › Toast). The toast is inverted (ink fill, surface text), so
 * the disc is the tone's solid colour with the mark in `surface`: light on the dark toast of the
 * light theme, dark on the light toast of the dark theme. The glyph is the tone's circled icon with
 * its circle filled and unstroked.
 */
const TONES: Record<ToastTone, { icon: Icon; disc: string }> = {
  success: { icon: CheckCircleIcon, disc: 'fill-success' },
  error: { icon: AlertCircleIcon, disc: 'fill-danger' },
  info: { icon: InfoIcon, disc: 'fill-info' },
};

// Controls on the inverted toast: button-cornered (هوية 4 › الأشكال), surface-coloured, a faint
// surface wash, and a focus ring in surface too, which reads on the ink fill in both themes.
const CONTROL =
  'rounded-control text-surface transition-[background-color,opacity] duration-120 ease-standard focus-visible:outline-surface focus-visible:-outline-offset-2';

/**
 * The close button's square on each density: as tall as «تراجع» (CONTROL_HEIGHT) and as wide, the
 * IconButton's own square there. Never under 48 where a finger is expected: 56 on the touch density
 * whatever the device reports, 48 under a coarse pointer on the admin.
 */
const CLOSE_SQUARE: Record<Density, string> = {
  touch: 'size-14',
  comfortable: 'size-10 pointer-coarse:size-12',
  compact: 'size-9 pointer-coarse:size-11',
  dense: 'size-8',
};

type Show = (options: ToastOptions, density: Density) => void;

const ToastContext = createContext<Show | null>(null);

/**
 * Shows a toast: `const toast = useToast(); toast({ message: 'حُفظ المنتج' })`. The toast takes the
 * density of the screen calling it, so the cashier's toasts are sized for a finger.
 */
export function useToast(): (options: ToastOptions) => void {
  const show = useContext(ToastContext);
  const density = useDensity();
  const toast = useCallback((options: ToastOptions) => show?.(options, density), [show, density]);
  if (!show) throw new Error('useToast needs a <ToastProvider> above it');
  return toast;
}

function ToastView({ toast, onDone }: { toast: ToastItem; onDone: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS);
  const tone = TONES[toast.tone ?? 'success'];
  const ToneIcon = tone.icon;
  const touch = toast.density === 'touch';

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDone(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onDone, toast.id]);

  return (
    <li
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex min-h-12 w-full items-center gap-3 rounded-card bg-ink py-1.5 ps-3 pe-1.5 font-semibold text-surface shadow-e3 motion-safe:animate-rise sm:w-auto sm:min-w-80',
        // Tab 14 › الخط: what the cashier reads is never under 16; 14 on the admin.
        touch ? 'text-base' : 'text-sm',
      )}
    >
      <ToneIcon
        size={24}
        strokeWidth={2.25}
        className={cn('text-surface [&_circle]:stroke-none', tone.disc)}
      />
      <span className="min-w-0 flex-1 py-1.5">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDone(toast.id);
          }}
          className={cn(
            CONTROL,
            CONTROL_HEIGHT[toast.density],
            'shrink-0 bg-surface/10 px-3 font-semibold hover:bg-surface/20',
          )}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="أغلق الإشعار"
        onClick={() => onDone(toast.id)}
        className={cn(
          CONTROL,
          CLOSE_SQUARE[toast.density],
          'grid shrink-0 place-items-center opacity-70 hover:bg-surface/10 hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <CloseIcon size={touch ? 20 : 16} />
      </button>
    </li>
  );
}

/** Holds the toasts of an app: bottom centre, above dialogs (z 50), announced without moving focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<Show>((options, density) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current.slice(-2), { ...options, id, density }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext value={value}>
      {children}
      <section
        aria-label="الإشعارات"
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          toasts.length === 0 && 'sr-only',
        )}
      >
        <ol className="flex w-full max-w-md flex-col items-center gap-2">
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} onDone={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext>
  );
}
