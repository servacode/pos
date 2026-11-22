import { useEffect, useRef } from 'react';
import type { Cart } from './cart';
import { isTyping, type SaleMode, type SaleScreenProps } from './saleTypes';

export interface SaleKeysArgs {
  props: SaleScreenProps;
  mode: SaleMode;
  checking: boolean;
  keypadOpen: boolean;
  cart: Cart;
  canPay: boolean;
  setMode: (mode: SaleMode) => void;
  searchRef: { current: HTMLInputElement | null };
  stopChecking: () => void;
  startChecking: () => void;
  holdSale: () => void;
  startPay: () => void;
}

/** The till's keyboard shortcuts: F2, F4, F9, F12, Alt+1, Esc and «؟» */
export function useSaleKeys({
  props,
  mode,
  checking,
  keypadOpen,
  cart,
  canPay,
  setMode,
  searchRef,
  stopChecking,
  startChecking,
  holdSale,
  startPay,
}: SaleKeysArgs) {
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event) => {
    if (props.extraShortcuts?.(event)) return;
    const typing = isTyping(event.target);
    if (event.key === 'Escape' && mode.kind !== 'items' && mode.kind !== 'pay') {
      setMode({ kind: 'items' });
      return;
    }
    if (event.key === 'Escape' && checking) {
      stopChecking();
      return;
    }
    if (keypadOpen || mode.kind === 'pay') return;
    if (event.key === 'F2' || (event.key === '/' && !typing)) {
      event.preventDefault();
      setMode({ kind: 'items' });
      searchRef.current?.focus();
    } else if (event.key === 'F4' || (event.altKey && event.code === 'Digit3')) {
      event.preventDefault();
      if (cart.lines.length > 0) holdSale();
      else if ((props.heldList?.length ?? props.heldCount) > 0) setMode({ kind: 'heldList' });
    } else if (event.key === 'F9') {
      event.preventDefault();
      if (checking) stopChecking();
      else startChecking();
    } else if (event.key === 'F12' || (event.key === '+' && !typing)) {
      event.preventDefault();
      if (canPay) startPay();
    } else if (event.altKey && event.code === 'Digit1') {
      event.preventDefault();
      if (cart.lines.length > 0) setMode({ kind: 'invoice' });
    } else if ((event.key === '?' || event.key === '؟') && !typing) {
      event.preventDefault();
      setMode({ kind: 'help' });
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
