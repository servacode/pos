import { useSyncExternalStore } from 'react';

/**
 * The branch the owner looks at from the top bar (round 54): one branch, or null for «كل الفروع».
 * Kept in this tab only (sessionStorage when allowed), and checked against the branches the person has,
 * so a branch that was removed never leaves the page filtered by nothing.
 */
const KEY = 'serva.branchScope';
let current: string | null = readKept();
const listeners = new Set<() => void>();

function readKept(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function setBranchScope(branchId: string | null): void {
  if (branchId === current) return;
  current = branchId;
  try {
    if (branchId) globalThis.sessionStorage?.setItem(KEY, branchId);
    else globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Storage refused: the choice still holds for this page load.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen branch id, or null for all branches; an id the person does not have counts as none */
export function useBranchScope(branches: { id: string }[]): string | null {
  const chosen = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return chosen !== null && branches.some((b) => b.id === chosen) ? chosen : null;
}
