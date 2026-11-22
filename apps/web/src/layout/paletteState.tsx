import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PaletteIntent } from './CommandPalette';

type PaletteState = { open: boolean; intent: PaletteIntent };
type PaletteStore = [PaletteState, (next: PaletteState | ((state: PaletteState) => PaletteState)) => void];

const CLOSED: PaletteState = { open: false, intent: 'search' };
const PaletteContext = createContext<PaletteStore | null>(null);

/**
 * Holds whether the search is open ABOVE the pages' loading boundary. The frame drawn while a page
 * loads is a real shell (its search answers), and it is swapped for the page's own shell when the
 * page arrives: kept here, a search opened in that second stays open.
 */
export function PaletteStateProvider({ children }: { children: ReactNode }) {
  const store = useState<PaletteState>(CLOSED);
  return <PaletteContext.Provider value={store}>{children}</PaletteContext.Provider>;
}

/** The search's state: the shared one under the provider, the top bar's own otherwise. */
export function usePaletteState(): PaletteStore {
  const shared = useContext(PaletteContext);
  const own = useState<PaletteState>(CLOSED);
  return shared ?? own;
}
