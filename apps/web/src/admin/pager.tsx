import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button } from '@serva/ui';
import { errorMessage } from '../lib/api';

/** What «Pager» draws: the page the list is on and how to move; one shape for server and local lists. */
export interface PagerState {
  page: number;
  /** The number of the first and the last row on this page */
  from: number;
  to: number;
  hasNext: boolean;
  /** 1 while the next page loads, -1 while the previous one does, else 0 */
  moving: 0 | 1 | -1;
  /** The reason the last move failed; the list stays on its page */
  error: string | null;
  onPrev: () => void;
  onNext: () => void;
  onRetry: () => void;
  /** True while the list loads from nothing (new filters, retry): the controls show but stay off */
  loading?: boolean;
  /** With `loading`: whether the list had page controls before, so a single page does not flash them */
  wasPaged?: boolean;
}

/** «‹ السابق · صفحة N · الفواتير من A إلى B · التالي ›». The list is one page; nothing shows when it is the only one. */
export function Pager({ noun, pager }: { noun: string; pager: PagerState }) {
  const { page, from, to, hasNext, moving, error, loading, wasPaged } = pager;
  if (loading) {
    if (!wasPaged) return null;
    return (
      <nav
        aria-label="الصفحات"
        aria-busy="true"
        className="flex flex-wrap items-center justify-center gap-3 print:hidden"
      >
        <Button variant="secondary" aria-label="الصفحة السابقة" disabled>
          <span aria-hidden="true">›</span> السابق
        </Button>
        <span aria-current="page" className="text-sm text-ink-muted">
          نحمّل {noun}…
        </span>
        <Button variant="secondary" aria-label="الصفحة التالية" disabled>
          التالي <span aria-hidden="true">‹</span>
        </Button>
      </nav>
    );
  }
  if (page === 1 && !hasNext && !error) return null;
  return (
    <div className="flex flex-col items-center gap-3 print:hidden">
      {error ? (
        <Alert tone="error">
          <span className="flex flex-wrap items-center gap-3">
            {error}
            <Button variant="secondary" size="sm" onClick={pager.onRetry}>
              أعد المحاولة
            </Button>
          </span>
        </Alert>
      ) : null}
      <nav aria-label="الصفحات" className="flex flex-wrap items-center justify-center gap-3">
        <Button
          variant="secondary"
          aria-label="الصفحة السابقة"
          disabled={page === 1 || moving !== 0}
          loading={moving === -1}
          onClick={pager.onPrev}
        >
          <span aria-hidden="true">›</span> السابق
        </Button>
        <span aria-current="page" className="text-sm text-ink-muted">
          صفحة <bdi className="num">{page}</bdi> · {noun} من <bdi className="num">{from}</bdi> إلى{' '}
          <bdi className="num">{to}</bdi>
        </span>
        <Button
          variant="secondary"
          aria-label="الصفحة التالية"
          disabled={!hasNext || moving !== 0}
          loading={moving === 1}
          onClick={pager.onNext}
        >
          التالي <span aria-hidden="true">‹</span>
        </Button>
      </nav>
    </div>
  );
}

interface Step {
  cursor: string | null;
  /** How many rows lie before this page */
  offset: number;
}
const FIRST: Step = { cursor: null, offset: 0 };

/**
 * Pages over a cursor API that gives no total: the cursors of the pages passed are kept, one page
 * shows at a time, and «السابق» goes back by them. A new `key` (the filters) starts again at page 1.
 * A page that fails to load leaves the list on the page it was on, with the error and a retry.
 */
export function useCursorPages<P extends { items: readonly unknown[]; nextCursor: string | null }>(
  key: string,
  fetchPage: (cursor: string | null) => Promise<P>,
  options: {
    /** The cursors of the pages passed (page 2 on), to open the list on the page they lead to */
    initial?: readonly string[];
    /** How many rows a page holds, to number the rows of a page opened from `initial` */
    pageSize?: number;
    /** Told the cursors of the pages passed whenever the page on screen changes, to keep them in the address */
    onCursors?: (cursors: string[]) => void;
  } = {},
) {
  const [state, setState] = useState<{
    key: string | null;
    steps: Step[];
    data: P | null;
    error: string | null;
  }>({
    key: null,
    steps: [FIRST],
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [moving, setMoving] = useState<0 | 1 | -1>(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  // The pages of the key that has an answer on screen
  const live = useRef<{ key: string | null; steps: Step[] }>({ key: null, steps: [FIRST] });
  const lastMove = useRef<1 | -1>(1);
  const scrollNext = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The first load opens on the page the address names; one that no longer exists falls back to page 1
  const started = useRef(false);
  const seeded = useRef(false);

  useEffect(() => {
    let current = true;
    if (!started.current) {
      started.current = true;
      const { initial = [], pageSize = 50 } = optionsRef.current;
      if (initial.length > 0) {
        seeded.current = true;
        live.current = {
          key,
          steps: [FIRST, ...initial.map((cursor, i) => ({ cursor, offset: (i + 1) * pageSize }))],
        };
      }
    }
    if (live.current.key !== key) {
      live.current = { key: null, steps: [FIRST] };
      seeded.current = false;
    }
    const steps = live.current.steps;
    setMoveError(null);
    fetchRef.current(steps[steps.length - 1]!.cursor).then(
      (data) => {
        if (!current) return;
        seeded.current = false;
        live.current = { key, steps };
        setState({ key, steps, data, error: null });
        optionsRef.current.onCursors?.(steps.slice(1).map((step) => step.cursor ?? ''));
      },
      (error: unknown) => {
        if (!current) return;
        if (seeded.current && steps.length > 1) {
          seeded.current = false;
          live.current = { key: null, steps: [FIRST] };
          setAttempt((n) => n + 1);
          return;
        }
        setState({ key, steps, data: null, error: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  useEffect(() => {
    if (!scrollNext.current) return;
    scrollNext.current = false;
    topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [state.data]);

  const fresh = state.key === key;
  const data = fresh ? state.data : null;
  const last = state.steps[state.steps.length - 1]!;

  const go = useCallback(
    async (dir: 1 | -1) => {
      const { data: here, steps } = state;
      if (!here || moving !== 0 || state.key !== key) return;
      const target =
        dir === 1
          ? here.nextCursor
            ? [
                ...steps,
                { cursor: here.nextCursor, offset: steps[steps.length - 1]!.offset + here.items.length },
              ]
            : null
          : steps.length > 1
            ? steps.slice(0, -1)
            : null;
      if (!target) return;
      lastMove.current = dir;
      setMoving(dir);
      setMoveError(null);
      try {
        const next = await fetchRef.current(target[target.length - 1]!.cursor);
        if (live.current.key !== key) return;
        live.current = { key, steps: target };
        scrollNext.current = true;
        setState({ key, steps: target, data: next, error: null });
        optionsRef.current.onCursors?.(target.slice(1).map((step) => step.cursor ?? ''));
      } catch (error) {
        setMoveError(errorMessage(error));
      } finally {
        setMoving(0);
      }
    },
    [state, moving, key],
  );

  return {
    data,
    error: fresh ? state.error : null,
    /** True while the page is loading from nothing (first load, new filters, retry) */
    loading: !fresh,
    /** Loads the page again; the list stays on its page */
    retry: () => {
      setState((s) => ({ ...s, key: null }));
      setAttempt((n) => n + 1);
    },
    /** Changes what is on the page in place, a row that was edited */
    patch: (change: (page: P) => P) => setState((s) => (s.data ? { ...s, data: change(s.data) } : s)),
    /** Put on the element above the list: a move scrolls it into view */
    topRef,
    pager: {
      // New filters or a retry: the old page's numbers mean nothing, the controls wait for the answer
      page: fresh ? state.steps.length : 1,
      from: fresh ? last.offset + 1 : 1,
      to: fresh ? last.offset + (data?.items.length ?? 0) : 0,
      hasNext: fresh && Boolean(data?.nextCursor),
      moving,
      error: moveError,
      onPrev: () => void go(-1),
      onNext: () => void go(1),
      onRetry: () => void go(lastMove.current),
      loading: !fresh,
      wasPaged: state.steps.length > 1 || Boolean(state.data?.nextCursor),
    } satisfies PagerState,
  };
}

/** Pages over rows already in memory: `render` gets the rows of one page. Give it a new `key` to start at page 1. */
export function Paged<T>({
  rows,
  size,
  noun,
  render,
}: {
  rows: readonly T[];
  size: number;
  noun: string;
  render: (page: T[]) => ReactNode;
}) {
  const [asked, setAsked] = useState(1);
  const top = useRef<HTMLDivElement>(null);
  const page = Math.min(asked, Math.max(1, Math.ceil(rows.length / size)));
  const offset = (page - 1) * size;
  const move = (to: number) => {
    setAsked(to);
    top.current?.scrollIntoView?.({ block: 'start' });
  };
  return (
    <div className="flex flex-col gap-3">
      <div ref={top}>{render(rows.slice(offset, offset + size))}</div>
      <Pager
        noun={noun}
        pager={{
          page,
          from: offset + 1,
          to: Math.min(offset + size, rows.length),
          hasNext: offset + size < rows.length,
          moving: 0,
          error: null,
          onPrev: () => move(page - 1),
          onNext: () => move(page + 1),
          onRetry: () => undefined,
        }}
      />
    </div>
  );
}
