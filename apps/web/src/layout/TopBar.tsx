import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Avatar,
  Badge,
  CardIcon,
  CashIcon,
  ConnectionPill,
  CONTROL_HEIGHT,
  Dialog,
  IconButton,
  IconChip,
  KeyIcon,
  LogoutIcon,
  Menu,
  MenuIcon,
  MenuItem,
  MenuSeparator,
  NextIcon,
  NotificationsIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  SearchIcon,
  SegmentedControl,
  Spinner,
  TextField,
  ThemeToggle,
  Tooltip,
  cn,
  useThemePreference,
  type Icon,
  type MenuItemRenderProps,
  type SegmentOption,
  type ThemePreference,
} from '@serva/ui';
import { useOnline } from '../pos/useOnline';
import { pageOwns, type NavSection } from './nav';

/** One line of the bell's list: something that waits for the user, and where to deal with it. */
export interface Notice {
  key: string;
  to: string;
  icon: Icon;
  tone: 'brand' | 'warning' | 'danger' | 'info';
  title: string;
  detail?: string;
  /** How many: the shop's orders, the holds. */
  count?: number;
  /** What counts toward the bell's dot (0 for news that asks for nothing yet). */
  attention: number;
}

/**
 * The admin top bar (هوية 4): where you are (store › section › page) and the sidebar's fold at the
 * start, a quick jump to any page (Ctrl K) in the middle, and at the end the connection (only when
 * it is lost), the notices, the theme, the till and the account. Under 1024 px the sidebar opens
 * from the menu button here.
 */
export function TopBar({
  storeName,
  storeInitials,
  userName,
  roleName,
  planName,
  sections,
  current,
  canSell,
  canSeePlan,
  notices,
  collapsed,
  onToggleSidebar,
  onOpenMenu,
  onLogout,
}: {
  storeName: string;
  storeInitials: string;
  userName: string;
  roleName: string | undefined;
  planName: string;
  sections: NavSection[];
  current: NavSection | undefined;
  canSell: boolean;
  canSeePlan: boolean;
  /** The bell's list; null for whoever gets no notices (no bell). */
  notices: Notice[] | null;
  /** The sidebar is folded to its rail of icons. */
  collapsed: boolean;
  onToggleSidebar: () => void;
  /** Opens the sidebar as a drawer (under 1024 px). */
  onOpenMenu: () => void;
  onLogout: () => Promise<void>;
}) {
  const { pathname } = useLocation();
  const online = useOnline();
  const page = current?.pages.find((p) => pageOwns(p, pathname));
  const [searchOpen, setSearchOpen] = useState(false);
  const foldLabel = collapsed ? 'توسيع القائمة' : 'طيّ القائمة';

  // Ctrl K (or ⌘K) opens the page search from anywhere in the admin.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* The start: the sidebar's button, and where you are */}
      <div className="flex min-w-0 flex-1 items-center gap-2 @5xl:basis-0">
        <IconButton
          label="افتح القائمة"
          icon={<MenuIcon />}
          className="-ms-2 lg:hidden"
          onClick={onOpenMenu}
        />
        <span className="-ms-2 hidden lg:flex">
          <Tooltip content={foldLabel} side="bottom">
            <IconButton
              label={foldLabel}
              icon={collapsed ? <PanelExpandIcon /> : <PanelCollapseIcon />}
              onClick={onToggleSidebar}
            />
          </Tooltip>
        </span>
        <nav aria-label="أنت هنا" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 text-[0.9375rem]">
            <li className="flex min-w-0 items-center">
              <Link
                to="/"
                className="flex min-w-0 items-center gap-2.5 rounded-small font-semibold text-ink transition-colors duration-120 ease-standard hover:text-brand-ink"
              >
                <IconChip size="sm">
                  <span className="text-xs font-bold">{storeInitials}</span>
                </IconChip>
                <span className="truncate">{storeName}</span>
              </Link>
            </li>
            {current && current.key !== 'home' ? (
              <Crumb>
                {page && page.label !== current.label ? (
                  <Link
                    to={current.pages[0]!.to}
                    className="truncate text-ink-muted transition-colors duration-120 ease-standard hover:text-ink"
                  >
                    {current.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="truncate font-semibold text-ink">
                    {current.label}
                  </span>
                )}
              </Crumb>
            ) : null}
            {current && page && page.label !== current.label ? (
              <Crumb>
                <span aria-current="page" className="truncate font-semibold text-ink">
                  {page.label}
                </span>
              </Crumb>
            ) : null}
          </ol>
        </nav>
      </div>

      {/* The middle: jump to a page */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="ابحث عن صفحة"
        aria-keyshortcuts="Control+K"
        className={cn(
          CONTROL_HEIGHT.comfortable,
          'hidden w-64 shrink items-center gap-2.5 rounded-control border border-line bg-surface ps-3 pe-2 text-start text-sm text-ink-subtle shadow-e1 transition-[border-color,color] duration-120 ease-standard hover:border-line-control/50 hover:text-ink-muted @min-[59rem]:flex @6xl:w-80',
        )}
      >
        <SearchIcon size={16} />
        <span className="min-w-0 flex-1 truncate">ابحث عن صفحة…</span>
        <kbd
          dir="ltr"
          className="rounded-small border border-line bg-surface-muted px-1.5 font-sans text-xs/5 font-semibold text-ink-muted"
        >
          Ctrl K
        </kbd>
      </button>

      {/* The end: the connection, the notices, the theme, the till, the account */}
      <div className="flex shrink-0 items-center justify-end gap-1 @5xl:flex-1 @5xl:basis-0">
        {online ? null : (
          <span className="me-1 hidden sm:flex">
            <ConnectionPill online={false}>دون إنترنت</ConnectionPill>
          </span>
        )}
        <IconButton
          label="ابحث عن صفحة"
          icon={<SearchIcon />}
          className="@min-[59rem]:hidden"
          onClick={() => setSearchOpen(true)}
        />
        {notices ? <Notifications notices={notices} /> : null}
        {/* On a phone the theme moves into the account panel, to keep the bar uncrowded. */}
        <span className="hidden sm:flex">
          <ThemeToggle />
        </span>
        {/* The home page has its own big «افتح الكاشير» */}
        {canSell && pathname !== '/' ? (
          <a
            href="/pos"
            className={cn(
              CONTROL_HEIGHT.comfortable,
              'ms-1.5 hidden shrink-0 items-center gap-2 rounded-control border border-line-control/50 bg-surface px-3.5 text-sm font-semibold text-ink shadow-e1 transition-colors duration-120 ease-standard hover:bg-surface-muted sm:inline-flex',
            )}
          >
            <CashIcon size={20} className="text-brand-ink" />
            افتح الكاشير
          </a>
        ) : null}
        <span aria-hidden="true" className="mx-2 hidden h-6 w-px shrink-0 bg-line sm:block" />
        <AccountMenu
          userName={userName}
          roleName={roleName}
          storeName={storeName}
          planName={planName}
          canSeePlan={canSeePlan}
          onLogout={onLogout}
        />
      </div>
      <PageSearch open={searchOpen} onOpenChange={setSearchOpen} sections={sections} />
    </>
  );
}

function Crumb({ children }: { children: ReactNode }) {
  return (
    <li className="hidden min-w-0 items-center gap-1.5 sm:flex">
      <NextIcon size={16} className="shrink-0 text-ink-subtle" />
      {children}
    </li>
  );
}

// ── The notices ──────────────────────────────────────────────────────────────────────────────────

/**
 * The bell (هوية 4 › Menu): a dot when something waits, and the list of what waits, each line a
 * link to where it is dealt with. It asks the server nothing: the frame hands it what it knows.
 */
function Notifications({ notices }: { notices: Notice[] }) {
  const waiting = notices.reduce((sum, notice) => sum + notice.attention, 0);
  return (
    <Menu
      label="التنبيهات"
      align="end"
      className="w-80"
      trigger={
        <Tooltip content="التنبيهات" side="bottom">
          <IconButton
            label={waiting > 0 ? `التنبيهات (${waiting})` : 'التنبيهات'}
            icon={
              <span className="relative flex">
                <NotificationsIcon />
                {waiting > 0 ? (
                  <span className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-canvas" />
                ) : null}
              </span>
            }
          />
        </Tooltip>
      }
    >
      <div className="flex items-center justify-between gap-3 px-2.5 pt-1.5 pb-2">
        <p className="text-[0.9375rem] font-semibold text-ink">التنبيهات</p>
        {waiting > 0 ? (
          <Badge tone="danger">
            <bdi className="num">{waiting}</bdi> جديدة
          </Badge>
        ) : null}
      </div>
      <MenuSeparator />
      {notices.length > 0 ? (
        <div className="flex flex-col gap-0.5 pt-1">
          {notices.map((notice) => {
            const NoticeIcon = notice.icon;
            return (
              <MenuItem
                key={notice.key}
                className="py-2"
                icon={
                  <IconChip tone={notice.tone} size="sm">
                    <NoticeIcon size={16} />
                  </IconChip>
                }
                trailing={
                  notice.count ? (
                    <span className="num shrink-0 text-sm font-bold text-ink">{notice.count}</span>
                  ) : undefined
                }
                render={(props) => <Link to={notice.to} {...props} />}
              >
                <span className="block truncate text-sm font-semibold text-ink">{notice.title}</span>
                {notice.detail ? (
                  <span className="block truncate text-xs text-ink-muted">{notice.detail}</span>
                ) : null}
              </MenuItem>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 px-6 pt-6 pb-7 text-center">
          <IconChip size="lg" className="mb-1.5">
            <NotificationsIcon size={24} />
          </IconChip>
          <p className="font-semibold text-ink">لا تنبيهات جديدة</p>
          <p className="text-sm text-ink-muted">هنا يظهر كل ما ينتظرك.</p>
        </div>
      )}
    </Menu>
  );
}

// ── The account ──────────────────────────────────────────────────────────────────────────────────

/**
 * A Menu item's look on a plain link or button. The account panel is a disclosure of links and
 * buttons, not an application menu: its rows keep their own roles, and Tab moves through them.
 */
function plain({
  role: _role,
  tabIndex: _tabIndex,
  onPointerMove: _onPointerMove,
  onPointerLeave: _onPointerLeave,
  ...props
}: MenuItemRenderProps) {
  return props;
}

/** The theme's three choices, in ThemeToggle's words (tab 14 › الوضع الداكن). */
const THEME_CHOICES: readonly SegmentOption<ThemePreference>[] = [
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
  { value: 'system', label: 'حسب الجهاز' },
];

function AccountMenu({
  userName,
  roleName,
  storeName,
  planName,
  canSeePlan,
  onLogout,
}: {
  userName: string;
  roleName: string | undefined;
  storeName: string;
  planName: string;
  canSeePlan: boolean;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useThemePreference();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      if (box.current?.contains(document.activeElement)) trigger.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function logout() {
    setSigningOut(true);
    await onLogout();
  }

  return (
    <div ref={box} className="relative shrink-0">
      <Tooltip content={open ? null : 'حسابي'} side="bottom">
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`حسابي: ${userName}`}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'grid size-10 place-items-center rounded-full transition-[background-color,box-shadow] duration-120 ease-standard hover:bg-surface-muted pointer-coarse:size-12',
            open && 'bg-surface-muted',
          )}
        >
          <Avatar name={userName} size="sm" className="ring-2 ring-surface" />
        </button>
      </Tooltip>
      {open ? (
        <div
          id={panelId}
          className="absolute end-0 top-full z-30 mt-2 flex w-72 flex-col rounded-card border border-line bg-surface p-1.5 text-ink shadow-e3 motion-safe:animate-rise"
        >
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
            <Avatar name={userName} />
            <div className="flex min-w-0 flex-col">
              <p className="truncate font-semibold text-ink">{userName}</p>
              <p className="truncate text-sm text-ink-muted">
                {roleName ? `${roleName} · ` : ''}
                {storeName}
              </p>
            </div>
          </div>
          <MenuSeparator />
          <div className="flex flex-col gap-0.5 py-1">
            <MenuItem icon={<KeyIcon />} render={(props) => <Link to="/me/pin" {...plain(props)} />}>
              رمز الدخول للكاشير
            </MenuItem>
            {canSeePlan ? (
              <MenuItem
                icon={<CardIcon />}
                trailing={
                  <Badge tone="brand" dot={false}>
                    {planName}
                  </Badge>
                }
                render={(props) => <Link to="/subscription" {...plain(props)} />}
              >
                الاشتراك
              </MenuItem>
            ) : null}
          </div>
          {/* A phone's top bar has no theme button: the choice is here instead. */}
          <div className="sm:hidden">
            <MenuSeparator />
            <div className="flex flex-col gap-2 px-2.5 pt-2 pb-2.5">
              <p aria-hidden="true" className="text-xs font-semibold text-ink-subtle">
                المظهر
              </p>
              <SegmentedControl
                label="المظهر"
                fullWidth
                options={THEME_CHOICES}
                value={theme}
                onValueChange={setTheme}
              />
            </div>
          </div>
          <MenuSeparator />
          <div className="pt-1">
            <MenuItem
              tone="danger"
              icon={signingOut ? <Spinner /> : <LogoutIcon />}
              disabled={signingOut}
              onSelect={() => void logout()}
              render={(props) => <button type="button" {...plain(props)} />}
            >
              تسجيل الخروج
            </MenuItem>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Jump to a page (Ctrl K) ──────────────────────────────────────────────────────────────────────

function PageSearch({
  open,
  onOpenChange,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: NavSection[];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const focus = window.setTimeout(() => input.current?.focus(), 0);
      return () => window.clearTimeout(focus);
    }
    return undefined;
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    return sections.flatMap((section) =>
      section.pages
        .filter((page) => !q || page.label.includes(q) || section.label.includes(q))
        .map((page) => ({ section, page })),
    );
  }, [sections, query]);

  function go(to: string) {
    onOpenChange(false);
    void navigate(to);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      go(results[active].page.to);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="انتقل إلى صفحة">
      <TextField
        ref={input}
        label="اسم الصفحة"
        hideLabel
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        placeholder="مثلاً: الورديات، تغيير الأسعار…"
        startAdornment={<SearchIcon size={20} className="ms-3" />}
      />
      {results.length ? (
        <ul aria-label="الصفحات" className="-mx-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto px-0.5">
          {results.map(({ section, page }, i) => {
            const PageIcon = page.icon;
            const chosen = i === active;
            return (
              <li key={page.to}>
                <button
                  type="button"
                  onClick={() => go(page.to)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    CONTROL_HEIGHT.comfortable,
                    'flex w-full items-center gap-3 rounded-small px-2.5 text-start text-[0.9375rem] transition-colors duration-120 ease-standard',
                    chosen ? 'bg-brand-soft text-brand-ink' : 'text-ink hover:bg-surface-muted',
                  )}
                >
                  <PageIcon size={20} className={chosen ? 'text-brand-ink' : 'text-ink-subtle'} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{page.label}</span>
                  {section.label !== page.label ? (
                    <span className={cn('shrink-0 text-sm', chosen ? 'text-brand-ink' : 'text-ink-muted')}>
                      {section.label}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-ink-muted">لا صفحة بهذا الاسم.</p>
      )}
      <p className="hidden items-center gap-4 border-t border-line pt-4 text-xs text-ink-subtle pointer-fine:flex">
        <span className="flex items-center gap-1.5">
          <Key>↑</Key>
          <Key>↓</Key>
          للتنقّل
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Enter</Key>
          للفتح
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Esc</Key>
          للإغلاق
        </span>
      </p>
    </Dialog>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      dir="ltr"
      className="min-w-6 rounded-small border border-line bg-surface-muted px-1.5 text-center font-sans text-xs/5 font-semibold text-ink-muted"
    >
      {children}
    </kbd>
  );
}
