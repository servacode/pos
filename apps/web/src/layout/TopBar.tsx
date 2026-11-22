import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import {
  AddIcon,
  CashIcon,
  ConnectionPill,
  MenuIcon,
  NextIcon,
  SearchIcon,
  StoreIcon,
  ThemeToggle,
} from '@serva/ui';
import type { NumberFormat } from '../lib/format';
import { useOnline } from '../pos/useOnline';
import { CommandPalette } from './CommandPalette';
import { usePaletteState } from './paletteState';
import { pageOwns, type NavSection } from './nav';
import { Notifications, type Notice } from './Notifications';
import { BranchSelect } from './BranchSelect';

export type { Notice } from './Notifications';

/** Pages the menu does not list (the person's own pages), named at the end of the breadcrumb */
const UNLISTED_TITLES: Record<string, string> = {
  '/me/pin': 'رمز الدخول',
  '/welcome': 'معالج البداية',
};

/** A menu this short belongs to a cashier: no keyboard hint for the page search */
const SHORTCUT_MIN_PAGES = 5;

/**
 * The admin top bar (هوية 4, round 45), the same on every page and in this order from the start:
 * where you are (store › section › page), the search field (Ctrl K), the branch scope, the bell, the
 * theme, and last, filled, «افتح الكاشير» (F2). The account lives in the sidebar's footer. Under 768 px
 * it is 56 high: the menu button, the title over its section, the search and the bell.
 */
export function TopBar({
  storeName,
  userId,
  timeZone,
  numberFormat,
  sections,
  current,
  canSell,
  notices,
  branchLabel,
  branchChoice,
  onOpenMenu,
}: {
  storeName: string;
  userId: string;
  timeZone: string;
  numberFormat: NumberFormat;
  sections: NavSection[];
  current: NavSection | undefined;
  canSell: boolean;
  /** The bell's list; null for whoever gets no notices (no bell). */
  notices: Notice[] | null;
  /** The branch the data is of: the user's own branch, or «كل الفروع» for a store with several. */
  branchLabel: string | null;
  /** A store with several branches and a person who sees them all: the filter's list and its choice. */
  branchChoice?: { branches: { id: string; name: string }[]; value: string | null } | null;
  /** Opens the sidebar as a drawer (under 768 px). */
  onOpenMenu: () => void;
}) {
  const { pathname } = useLocation();
  const online = useOnline();
  const page = current?.pages.find((p) => pageOwns(p, pathname));
  const [palette, setPalette] = usePaletteState();
  // The keyboard hint is for people who run the store from a desk; a cashier whose menu is a handful
  // of pages never needs it
  const showShortcut = sections.reduce((n, section) => n + section.pages.length, 0) > SHORTCUT_MIN_PAGES;
  const stacked = current !== undefined && current.key !== 'home';
  const unlisted = current === undefined ? UNLISTED_TITLES[pathname] : undefined;
  const pageDiffers = current !== undefined && page !== undefined && page.label !== current.label;

  // Ctrl K opens the search, Alt N (or Ctrl N in an installed app) the list of new things, F2 the till: from anywhere in the admin.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette({ open: true, intent: 'search' });
      } else if (
        // A browser tab keeps Ctrl N for a new window, so Alt N is the key that always reaches the page
        (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') ||
        (event.altKey && !mod && !event.shiftKey && event.code === 'KeyN')
      ) {
        event.preventDefault();
        setPalette({ open: true, intent: 'new' });
      } else if (canSell && event.key === 'F2') {
        event.preventDefault();
        window.location.assign('/pos');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSell, setPalette]);

  return (
    <div className="sh-top">
      <nav aria-label="أنت هنا" className="sh-crumb">
        <ol className={stacked || unlisted || current?.key === 'home' ? 'has-stack' : undefined}>
          <li className="sh-menu-li">
            <button
              type="button"
              className="sh-ibtn sh-menu-btn"
              aria-label="افتح القائمة"
              onClick={onOpenMenu}
            >
              <MenuIcon />
            </button>
          </li>
          <li className="sh-crumb-store">
            <Link to="/">
              <span className="sh-crumb-av" aria-hidden="true">
                {[...storeName.trim()][0] ?? ''}
              </span>
              <span title={storeName} className="line-clamp-2 leading-tight">
                {storeName}
              </span>
            </Link>
          </li>
          {current?.key === 'home' ? (
            <>
              <li className="sh-crumb-sep" aria-hidden="true">
                <NextIcon size={16} />
              </li>
              <li className="sh-crumb-stack">
                <span aria-current="page">الرئيسية</span>
              </li>
            </>
          ) : null}
          {unlisted ? (
            <>
              <li className="sh-crumb-sep" aria-hidden="true">
                <NextIcon size={16} />
              </li>
              <li className="sh-crumb-stack">
                <span aria-current="page">{unlisted}</span>
              </li>
            </>
          ) : null}
          {stacked && current ? (
            <>
              <li className="sh-crumb-sep" aria-hidden="true">
                <NextIcon size={16} />
              </li>
              <li className="sh-crumb-stack">
                {pageDiffers && page ? (
                  <>
                    <Link to={current.pages[0]!.to} title={current.label}>
                      {current.label}
                    </Link>
                    <NextIcon size={16} className="sh-crumb-in" aria-hidden="true" />
                    <span aria-current="page" title={page.label}>
                      {page.label}
                    </span>
                  </>
                ) : (
                  <span aria-current="page" title={current.label}>
                    {current.label}
                  </span>
                )}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      {online ? null : (
        <span className="sh-offline">
          <ConnectionPill online={false}>دون إنترنت</ConnectionPill>
        </span>
      )}

      <button
        type="button"
        className="sh-search"
        aria-label="ابحث عن منتج أو زبون أو دفعة"
        aria-keyshortcuts="Control+K"
        onClick={() => setPalette({ open: true, intent: 'search' })}
      >
        <SearchIcon size={20} />
        <span className="sh-lbl">ابحث عن منتج أو زبون أو فاتورة…</span>
        {showShortcut ? <kbd className="sh-kbd">Ctrl K</kbd> : null}
      </button>

      <div className="sh-tb">
        {branchChoice ? (
          <BranchSelect branches={branchChoice.branches} value={branchChoice.value} />
        ) : branchLabel ? (
          <span className="sh-branch" role="group" aria-label={`الفرع: ${branchLabel}`}>
            <StoreIcon size={20} />
            <span>{branchLabel}</span>
          </span>
        ) : null}
        {branchLabel ? <span className="sh-vr" aria-hidden="true" /> : null}
        <button
          type="button"
          className="sh-ibtn sh-new-btn"
          aria-label="جديد"
          aria-keyshortcuts="Alt+N"
          title="جديد (Alt N)"
          onClick={() => setPalette({ open: true, intent: 'new' })}
        >
          <AddIcon />
        </button>
        {notices ? (
          <Notifications notices={notices} userId={userId} timeZone={timeZone} numberFormat={numberFormat} />
        ) : null}
        <span className="sh-themewrap">
          <ThemeToggle />
        </span>
        {canSell ? (
          <>
            <span className="sh-vr" aria-hidden="true" />
            <a href="/pos" className="sh-primary" aria-keyshortcuts="F2">
              <CashIcon size={20} />
              افتح الكاشير
              <kbd className="sh-kbd">F2</kbd>
            </a>
          </>
        ) : null}
      </div>
      <CommandPalette
        open={palette.open}
        onOpenChange={(open) => setPalette((state) => ({ ...state, open }))}
        intent={palette.intent}
        sections={sections}
      />
    </div>
  );
}
