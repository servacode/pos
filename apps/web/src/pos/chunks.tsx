import { Component, lazy, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

/**
 * The till's lazy screens. Each one is loaded again from scratch when the cashier presses retry
 * (React caches a failed import for good, so a new lazy component is made), and all of them are
 * fetched right after sign-in so a dropped connection never needs a file the till has not got yet.
 */
const resets = new Set<() => void>();

export function lazyChunk<C extends ComponentType<never>>(load: () => Promise<{ default: C }>): C {
  const make = () => lazy(load as unknown as () => Promise<{ default: ComponentType<object> }>);
  let Inner = make();
  resets.add(() => {
    Inner = make();
  });
  const Chunk = (props: object) => <Inner {...props} />;
  return Chunk as unknown as C;
}

export const loadShift = () => import('./shift/ShiftScreens');
export const loadReturn = () => import('./return/ReturnScreen');
export const loadReceipt = () => import('./customers/ReceiptScreen');
export const loadGift = () => import('./customers/GiftVoucherScreen');
export const loadAlterations = () => import('./alterations/AlterationsScreen');
export const loadPayment = () => import('./pay/PaymentPanel');

/** Fetches every screen of the till into the browser cache; failures are ignored (retried on use). */
export function preloadTill(): void {
  for (const load of [loadPayment, loadShift, loadReturn, loadReceipt, loadGift, loadAlterations]) {
    void load().catch(() => undefined);
  }
}

type BoundaryState = { failed: boolean };

/** Catches a screen that failed to load (or crashed) and offers a retry instead of a blank page. */
export class TillBoundary extends Component<{ children: ReactNode; onBack?: () => void }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Nothing to report: the retry button is the whole recovery.
  }

  private retry = () => {
    for (const reset of resets) reset();
    this.setState({ failed: false });
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid place-items-center gap-4 p-8 text-center">
        <p className="text-lg font-bold">تعذّر فتح هذه الشاشة. تأكد من الاتصال ثم أعد المحاولة.</p>
        <div className="flex gap-3">
          <button type="button" className="rounded-lg border px-5 py-3 font-bold" onClick={this.retry}>
            إعادة المحاولة
          </button>
          {this.props.onBack ? (
            <button
              type="button"
              className="rounded-lg border px-5 py-3"
              onClick={() => {
                this.retry();
                this.props.onBack?.();
              }}
            >
              رجوع
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}
