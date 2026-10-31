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
}

/** How long a toast stays (tab 14 › الإشعار المؤقت): 4 s, paused while hovered or focused. */
export const TOAST_DURATION_MS = 4000;

const ICONS: Record<ToastTone, Icon> = { success: CheckCircleIcon, error: AlertCircleIcon, info: InfoIcon };

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/** Shows a toast: `const toast = useToast(); toast({ message: 'حُفظ المنتج' })`. */
export function useToast(): (options: ToastOptions) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast needs a <ToastProvider> above it');
  return show;
}

function ToastView({ toast, onDone }: { toast: ToastItem; onDone: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS);
  const ToneIcon = ICONS[toast.tone ?? 'success'];

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
      className="pointer-events-auto flex min-h-12 items-center gap-2.5 rounded-control bg-ink ps-4 pe-1.5 text-sm font-semibold text-surface shadow-e2 motion-safe:animate-rise"
    >
      <ToneIcon />
      <span className="flex-1 py-3">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDone(toast.id);
          }}
          className="min-h-11 rounded-small px-3 underline-offset-4 hover:underline"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="أغلق الإشعار"
        onClick={() => onDone(toast.id)}
        className="grid size-11 place-items-center rounded-small opacity-80 hover:opacity-100"
      >
        <CloseIcon size={16} />
      </button>
    </li>
  );
}

/** Holds the toasts of an app: bottom centre, above dialogs (z 50), announced without moving focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current.slice(-2), { ...options, id }]);
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
          'pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4',
          toasts.length === 0 && 'sr-only',
        )}
      >
        <ol className="flex w-full max-w-md flex-col gap-2">
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} onDone={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext>
  );
}
