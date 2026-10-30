import {
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from 'react';

/**
 * The four densities of tab 14 › الكثافات. Each surface sets its own: touch for the cashier, waiter
 * and sales rep; comfortable for the store admin (the default); compact for the platform panel and
 * long lists; dense for the accountant portal (mouse and keyboard only).
 */
export type Density = 'touch' | 'comfortable' | 'compact' | 'dense';

const DensityContext = createContext<Density>('comfortable');

export function DensityProvider({ density, children }: { density: Density; children: ReactNode }) {
  return <DensityContext value={density}>{children}</DensityContext>;
}

export function useDensity(): Density {
  return useContext(DensityContext);
}

/** Field and button height per density: 56 / 48 / 40 / 32. */
export const CONTROL_HEIGHT: Record<Density, string> = {
  touch: 'min-h-14',
  comfortable: 'min-h-12',
  compact: 'min-h-10',
  dense: 'min-h-8',
};

/** Table row height per density: 56 / 52 / 40 / 32. */
export const ROW_HEIGHT: Record<Density, string> = {
  touch: 'h-14',
  comfortable: 'h-13',
  compact: 'h-10',
  dense: 'h-8',
};

/** The store's digit shape (tab 14 › شكل الأرقام): Latin (123) by default, or Arabic-Indic (١٢٣). */
export type Digits = 'latn' | 'arab';

const DigitsContext = createContext<Digits>('latn');

export function DigitsProvider({ digits, children }: { digits: Digits; children: ReactNode }) {
  return <DigitsContext value={digits}>{children}</DigitsContext>;
}

export function useDigits(): Digits {
  return useContext(DigitsContext);
}

/** Props of a component that renders as `C` (an <a> by default, or a router link). */
export type PolymorphicProps<C extends ElementType, Own = object> = Own & { as?: C } & Omit<
    ComponentPropsWithoutRef<C>,
    keyof Own | 'as'
  >;
