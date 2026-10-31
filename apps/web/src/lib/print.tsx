import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type Paper = '80mm' | 'A4';

const PAGE: Record<Paper, string> = {
  '80mm': '@page { size: 80mm auto; margin: 0 }',
  A4: '@page { size: A4; margin: 12mm }',
};

/**
 * What `window.print()` prints (21 › الطباعة): the sheet in a portal on <body>, with its paper's page
 * size. Hidden on screen; while it is mounted, the print stylesheet hides everything else.
 */
export function PrintSheet({ paper, children }: { paper: Paper; children: ReactNode }) {
  return createPortal(
    <div data-print-sheet={paper} className="hidden print:block">
      <style>{PAGE[paper]}</style>
      {children}
    </div>,
    document.body,
  );
}

/**
 * Print on demand: `print(paper)` mounts the sheet for that paper, then opens the print dialog once
 * it is in the page. The sheet stays until the next print, as the cashier's receipt does.
 */
export function usePrint() {
  const [job, setJob] = useState<{ paper: Paper; n: number } | null>(null);

  useEffect(() => {
    if (!job) return;
    const timer = setTimeout(() => {
      try {
        window.print();
      } catch {
        // No print dialog in this environment: nothing else to do.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [job]);

  return {
    paper: job?.paper ?? null,
    print: (paper: Paper) => setJob((current) => ({ paper, n: (current?.n ?? 0) + 1 })),
  };
}
