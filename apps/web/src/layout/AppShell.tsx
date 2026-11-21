import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { MeResponse, OnlineOrder } from '@serva/core';
import {
  CardIcon,
  CashIcon,
  CONTROL_HEIGHT,
  GiftIcon,
  HomeIcon,
  MenuIcon,
  NextIcon,
  ProductsIcon,
  SalesIcon,
  ScrollStrip,
  StoreIcon,
  cn,
} from '@serva/ui';
import { holdsAny } from '../admin/reports/access';
import { useAuth, useMe } from '../auth/useAuth';
import { apiFetch } from '../lib/api';
import { formatDays, formatNumber } from '../lib/format';
import { LEGAL } from '../legal/config';
import { navGroupsFor, pageOwns, sectionAt, type NavSection } from './nav';
import type { Notice } from './Notifications';
import { trapTab } from './popover';
import { SidebarPanel, type NavCount, type SidebarPlan } from './Sidebar';
import { bannerFor, factsOfMe, SubscriptionBanner } from './subscription-banner';
import { TopBar } from './TopBar';
import './shell.css';

// ── The sidebar's fold, kept on this device ──────────────────────────────────────────────────────

/** The localStorage key of the sidebar's fold: 'collapsed' or 'expanded'. */
export const SIDEBAR_STORAGE_KEY = 'serva.sidebar';

function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function keepCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Storage refused (private mode, full): the fold holds for this page only.
  }
}

// ── What waits: the online shop's pending orders ─────────────────────────────────────────────────

const getPendingOrders = () =>
  apiFetch<{ items: OnlineOrder[] }>('/v1/online-orders?status=pending', { auth: true });

/** How long the bell trusts its last answer while the user moves from page to page. */
const PENDING_FRESH_MS = 30_000;

let pendingAsk: Promise<{ items: OnlineOrder[] }> | null = null;

/**
 * The pending list, asked once while an answer is on its way: the shell and the home page both need it
 * at the same moment on first load, and one request serves both.
 */
export function getPendingOrdersOnce(fresh = false): Promise<{ items: OnlineOrder[] }> {
  // After an order was decided the answer on its way is older than the decision: ask again
  if (fresh) pendingAsk = null;
  pendingAsk ??= getPendingOrders().finally(() => {
    pendingAsk = null;
  });
  return pendingAsk;
}

/** The last answer per signed-in user (a new sign-in brings a new `me`, and asks again). */
const pendingSeen = new WeakMap<MeResponse, { at: number; items: OnlineOrder[] }>();

/**
 * The online shop's pending orders and holds, for the bell and the sidebar's count: the request the
 * home page makes, for whoever may see the orders (customers.view, as the server checks). Every page
 * mounts its own shell, so an answer under 30 seconds old is reused instead of asked again, except
 * after the online store's page, where orders are accepted and refused.
 */
/** Dispatch on `window` after an order is accepted or refused so the sidebar badge refreshes at once */
export const ORDERS_CHANGED = 'serva:orders-changed';

/**
 * What the shop's «pending» list is made of, said once for the sidebar badge, the bell and the home
 * page: new orders waiting for a yes or no, customers asking to cancel, and pieces held on a deposit.
 * The three add up to the list, so the badge is always the sum of the lines under the bell.
 */
export function splitPending(items: readonly OnlineOrder[]): {
  newOrders: number;
  cancelRequests: number;
  holds: number;
} {
  const holds = items.filter((order) => order.source === 'hold').length;
  const cancelRequests = items.filter(
    (order) => order.source !== 'hold' && order.status === 'cancel_requested',
  ).length;
  return { newOrders: items.length - holds - cancelRequests, cancelRequests, holds };
}

/** How often an open page asks again while the tab is in front (the shop PC left on all morning) */
const POLL_MS = 45_000;

function usePendingOrders(me: MeResponse, allowed: boolean, pathname: string): OnlineOrder[] {
  const [items, setItems] = useState<OnlineOrder[]>(() => pendingSeen.get(me)?.items ?? []);
  const deciding = pathname === '/online-store' || pathname.startsWith('/online-store/');
  useEffect(() => {
    if (!deciding) return;
    return () => {
      pendingSeen.delete(me);
    };
  }, [me, deciding]);
  useEffect(() => {
    if (!allowed) return;
    let current = true;
    // Only the latest question counts: a slow answer to an earlier one never overwrites a newer one
    let asked = 0;
    const ask = (fresh = false) => {
      const mine = (asked += 1);
      return getPendingOrdersOnce(fresh).then(
        ({ items: fresh }) => {
          if (mine !== asked) return;
          pendingSeen.set(me, { at: Date.now(), items: fresh });
          if (current) setItems(fresh);
        },
        // The bell keeps what it had; the page's own requests say when the connection is down.
        () => undefined,
      );
    };
    const seen = pendingSeen.get(me);
    if (!seen || Date.now() - seen.at >= PENDING_FRESH_MS) void ask();
    // Any page, tab in front: ask again every 45 seconds, and the moment the tab comes back or the
    // window gets focus. On the online store's page orders are accepted and refused: a short poll
    // and an event after each action keep the badge right.
    const visible = () => document.visibilityState !== 'hidden';
    const askIfSeen = () => {
      if (visible()) void ask();
    };
    const onChanged = () => void ask(true);
    const timer = window.setInterval(askIfSeen, deciding ? 8000 : POLL_MS);
    document.addEventListener('visibilitychange', askIfSeen);
    window.addEventListener('focus', askIfSeen);
    window.addEventListener(ORDERS_CHANGED, onChanged);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', askIfSeen);
      window.removeEventListener('focus', askIfSeen);
      window.removeEventListener(ORDERS_CHANGED, onChanged);
    };
  }, [me, allowed, deciding]);
  return allowed ? items : [];
}

// ── The bell's list ──────────────────────────────────────────────────────────────────────────────

const latestOf = (orders: readonly OnlineOrder[]): OnlineOrder | undefined =>
  orders.reduce<OnlineOrder | undefined>(
    (best, order) => (!best || order.createdAt > best.createdAt ? order : best),
    undefined,
  );

const atOf = (orders: readonly OnlineOrder[]): { at?: string } => {
  const at = latestOf(orders)?.createdAt;
  return at ? { at } : {};
};

/** «آخرها من سلمى، …»: the newest of a kind of order, by its customer's name. */
const lastFrom = (orders: readonly OnlineOrder[], then: string): string => {
  const name = latestOf(orders)?.customerName;
  return name ? `آخرها من ${name}، ${then}` : then;
};

/**
 * The bell's list: only what the app already knows. The shop's pending orders and holds (for whoever
 * may see them), and the subscription's state for whoever manages it. A trial with days to spare is
 * not here: the sidebar's plan card says it once.
 */
function noticesFor(me: MeResponse, pending: OnlineOrder[], canSeePlan: boolean): Notice[] {
  const notices: Notice[] = [];
  const { newOrders: orders, cancelRequests, holds } = splitPending(pending);
  const holdList = pending.filter((order) => order.source === 'hold');
  const cancelList = pending.filter(
    (order) => order.source !== 'hold' && order.status === 'cancel_requested',
  );
  const orderList = pending.filter((order) => order.source !== 'hold' && order.status !== 'cancel_requested');
  if (cancelRequests > 0) {
    notices.push({
      key: 'cancels',
      to: '/online-store',
      icon: StoreIcon,
      tone: 'warning',
      title: cancelRequests === 1 ? 'زبون يطلب إلغاء طلبه' : 'زبائن يطلبون إلغاء طلباتهم',
      detail: lastFrom(cancelList, 'بانتظار موافقتك على الإلغاء'),
      count: cancelRequests,
      attention: cancelRequests,
      ...atOf(cancelList),
    });
  }
  if (orders > 0) {
    notices.push({
      key: 'orders',
      to: '/online-store',
      icon: StoreIcon,
      tone: 'warning',
      title: orders === 1 ? 'طلب جديد من المتجر الإلكتروني' : 'طلبات جديدة من المتجر الإلكتروني',
      detail: lastFrom(orderList, 'بانتظار قبولك أو رفضك'),
      count: orders,
      attention: orders,
      ...atOf(orderList),
    });
  }
  if (holds > 0) {
    notices.push({
      key: 'holds',
      to: '/online-store',
      icon: GiftIcon,
      tone: 'brand',
      title: holds === 1 ? 'قطعة محجوزة بعربون' : 'قطع محجوزة بعربون',
      detail: lastFrom(holdList, 'تنتظر صاحبها في المحل'),
      count: holds,
      attention: holds,
      ...atOf(holdList),
    });
  }
  if (canSeePlan) {
    const { status, daysLeft, lifecycle, readOnly } = me.subscription;
    const days = daysLeft === null ? '' : formatDays(daysLeft, me.settings.numberFormat);
    if (readOnly || lifecycle === 'read_only') {
      notices.push({
        key: 'plan',
        to: '/subscription',
        icon: CardIcon,
        tone: 'danger',
        title: 'المتجر للقراءة والتصدير فقط',
        detail: 'ادفع من صفحة الاشتراك ليعود البيع',
        attention: 1,
      });
    } else if (lifecycle === 'grace') {
      const left = me.subscription.graceDaysLeft;
      notices.push({
        key: 'plan',
        to: '/subscription',
        icon: CardIcon,
        tone: 'warning',
        title: 'انتهى الاشتراك: مهلة السماح',
        detail:
          left === null || left <= 0
            ? 'ينتهي البيع اليوم. ادفع الآن'
            : `باقي ${formatDays(left, me.settings.numberFormat)} على البيع. ادفع الآن`,
        attention: 1,
      });
    } else if (status === 'trialing') {
      // Said once, by the sidebar's plan card (and the banner when selling is at stake).
    } else if (status === 'past_due') {
      notices.push({
        key: 'plan',
        to: '/subscription',
        icon: CardIcon,
        tone: 'warning',
        title: 'الاشتراك متأخر عن الدفع',
        detail: 'ادفع الفاتورة ليبقى متجرك شغّالاً',
        attention: 1,
      });
    } else if (status === 'suspended' || status === 'cancelled') {
      notices.push({
        key: 'plan',
        to: '/subscription',
        icon: CardIcon,
        tone: 'danger',
        title: status === 'suspended' ? 'الاشتراك موقوف' : 'الاشتراك ملغى',
        detail: 'افتح الاشتراك لتعيد تشغيله',
        attention: 1,
      });
    } else if (daysLeft !== null && daysLeft <= 7) {
      notices.push({
        key: 'plan',
        to: '/subscription',
        icon: CardIcon,
        tone: 'info',
        title: daysLeft <= 0 ? 'ينتهي الاشتراك اليوم' : `باقي ${days} على نهاية الاشتراك`,
        detail: 'جدّد الاشتراك قبل أن ينتهي',
        attention: daysLeft <= 3 ? 1 : 0,
      });
    }
  }
  return notices;
}

/** «طلب واحد», «طلبان», «5 طلبات», «12 طلباً» + «بانتظارك». */
function waitingWords(count: number, text: string): string {
  if (count === 1) return 'طلب واحد بانتظارك';
  if (count === 2) return 'طلبان بانتظارك';
  return count <= 10 ? `${text} طلبات بانتظارك` : `${text} طلباً بانتظارك`;
}

/** «فرعان», «3 فروع», «12 فرعاً». */
function branchWords(count: number, text: string): string {
  if (count === 2) return 'فرعان';
  return count <= 10 ? `${text} فروع` : `${text} فرعاً`;
}

// ── The section's pages, as tabs under the top bar ──────────────────────────────────────────────

/**
 * The pages of the current section as underline tabs (هوية 4 › Underline tabs), links to each page,
 * for a section of two pages or more. They stay under the top bar as the page scrolls.
 */
function SectionTabs({ section, pathname }: { section: NavSection; pathname: string }) {
  // The open tab comes to the middle of a strip that scrolls (a phone), so its neighbours are in view
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const open = nav.current?.querySelector('[aria-current="page"]');
    if (open && typeof open.scrollIntoView === 'function') {
      open.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [pathname]);
  return (
    // -mb-px: the open tab's line lies on the header's hairline.
    <nav ref={nav} aria-label={`صفحات ${section.label}`} className="-mb-px">
      <ScrollStrip className="max-sm:snap-x max-sm:snap-proximity">
        <ul className="flex min-w-max gap-1">
          {section.pages.map((page) => {
            const active = pageOwns(page, pathname);
            return (
              <li key={page.to} className="snap-start">
                <Link
                  to={page.to}
                  aria-current={active ? 'page' : undefined}
                  aria-label={page.tab ? page.label : undefined}
                  className={cn(
                    CONTROL_HEIGHT.comfortable,
                    // The focus ring is drawn inside the tab, so the scrolling strip never clips it.
                    'inline-flex items-center rounded-t-small border-b-2 px-3 text-[0.9375rem] font-semibold whitespace-nowrap max-sm:px-2.5 transition-colors duration-120 ease-standard focus-visible:-outline-offset-2',
                    active
                      ? 'border-brand text-ink'
                      : 'border-transparent text-ink-muted hover:border-line-control/50 hover:text-ink',
                  )}
                >
                  {page.tab ?? page.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </ScrollStrip>
    </nav>
  );
}

// Words that say what a shop is rather than its name: «متجر أحمد نور» shows «أن».
const SHOP_WORDS = new Set(['متجر', 'محل', 'محلات', 'شركة', 'مؤسسة', 'سوبرماركت', 'صيدلية', 'مطعم']);

/** The first letters of the store's name, for the sidebar's store square. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const named = words.filter((word) => !SHOP_WORDS.has(word));
  return (named.length > 0 ? named : words)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}

// ── The frame ────────────────────────────────────────────────────────────────────────────────────

/** True while the media query matches (false where the browser cannot say: tests). */
function useMatchMedia(query: string): boolean {
  const read = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** The sidebar folds to the rail on its own below this width; below PHONE it becomes a drawer. */
const NARROW = '(max-width: 1099px)';
const PHONE = '(max-width: 767px)';

/** The drawer: the sidebar's panel from the start side over a dimmed page. Esc, ✕, the scrim or a chosen page close it. */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    box.current?.querySelector<HTMLElement>('a[href], button')?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="sh-scrim" aria-hidden="true" onMouseDown={onClose} />
      {/* The modal's own container keeps Tab inside and closes on a chosen link: not a control itself. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="القائمة"
        className="sh-drawer"
        onKeyDown={(event) => trapTab(event, box.current)}
        // A chosen link closes the drawer, the open page's own too (no address change to wait for).
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) onClose();
        }}
      >
        {children}
      </aside>
    </>
  );
}

/**
 * The frame of every admin page (هوية 4, round 45): the sidebar of sections, the top bar, the
 * section's tabs, and on a phone the tab bar. Each page mounts its own, so what must outlive a page
 * (the fold) lives on the device.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const narrow = useMatchMedia(NARROW);
  const phone = useMatchMedia(PHONE);
  const rail = collapsed || narrow;

  // A page chosen in the drawer closes it.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const groups = navGroupsFor(me);
  const sections = groups.flatMap((group) => group.sections);
  const current = sectionAt(sections, pathname);
  const canSeePlan = holdsAny(me, ['subscription.manage']);
  const canSell = holdsAny(me, ['sale.create']);
  const seesOrders = holdsAny(me, ['customers.view']);
  const pending = usePendingOrders(me, seesOrders, pathname);
  const notices = seesOrders || canSeePlan ? noticesFor(me, pending, canSeePlan) : null;
  const { status, daysLeft } = me.subscription;
  const digits = me.settings.numberFormat;

  const trialLeft = status === 'trialing' ? daysLeft : null;
  const plan: SidebarPlan = {
    name: me.subscription.planName,
    trial:
      trialLeft === null
        ? null
        : {
            daysText: trialLeft <= 0 ? 'تنتهي اليوم' : `باقي ${formatDays(trialLeft, digits)}`,
            days: Math.max(trialLeft, 0),
            total: Math.max(LEGAL.trialDays, trialLeft),
          },
    urgent: trialLeft !== null && trialLeft <= 3,
    canManage: canSeePlan,
  };
  const branchCount = me.branches.length;
  const store = {
    name: me.tenant.name,
    initials: initials(me.tenant.name),
    chip: trialLeft === null ? me.subscription.planName : 'تجربة',
    branches: branchCount > 1 ? branchWords(branchCount, formatNumber(branchCount, digits)) : null,
  };
  const tied = me.user.roles.some((role) => role.branchId !== null);
  const branchLabel =
    branchCount > 1 ? 'كل الفروع' : tied && branchCount === 1 ? (me.branches[0]?.name ?? null) : null;
  const waiting = formatNumber(pending.length, digits);
  const counts: Partial<Record<NavSection['key'], NavCount>> =
    pending.length > 0
      ? { online: { value: waiting, words: waitingWords(pending.length, waiting), waiting: true } }
      : {};
  const account = {
    userName: me.user.fullName,
    roleName: me.user.roles[0]?.name,
    phone: me.user.phone,
    canSeePlan,
    onLogout: logout,
  };

  function toggleSidebar() {
    // Narrow, the sidebar is the rail whatever was chosen: its handle opens the full menu instead.
    if (narrow) {
      setDrawerOpen(true);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    keepCollapsed(next);
  }

  // «[» folds and unfolds the sidebar (not while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      // Not while a dialog (the search box, the menu drawer) is open: the key belongs to it
      const inDialog = target instanceof HTMLElement && target.closest('[role="dialog"]') !== null;
      if (
        event.key === '[' &&
        !typing &&
        !inDialog &&
        !drawerOpen &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      )
        toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const foldLabel = narrow ? 'افتح القائمة' : collapsed ? 'توسيع القائمة' : 'طيّ القائمة';
  const tabs =
    current && current.pages.length > 1 ? <SectionTabs section={current} pathname={pathname} /> : undefined;
  const banner = bannerFor(factsOfMe(me.subscription), digits);
  // A trial about to end is said by the sidebar's card; the banner stays for what stops selling.
  const showBanner = banner !== null && !(banner.kind === 'ending' && status === 'trialing');

  const salesSection = sections.find((section) => section.key === 'sales');
  const productsSection = sections.find((section) => section.key === 'products');

  return (
    <div className="sh-app">
      {phone ? null : (
        <div className="sh-sbwrap" data-rail={rail}>
          <aside className="sh-aside" aria-label="الشريط الجانبي" data-rail={rail}>
            <SidebarPanel
              mode="side"
              rail={rail}
              store={store}
              groups={groups}
              current={current}
              counts={counts}
              plan={plan}
              account={account}
            />
            <button
              type="button"
              className="sh-handle"
              aria-label={foldLabel}
              title={`${foldLabel}  [`}
              onClick={toggleSidebar}
            >
              <NextIcon size={16} />
            </button>
          </aside>
        </div>
      )}

      <div className="sh-main">
        <header className="sh-header">
          <TopBar
            storeName={me.tenant.name}
            userId={me.user.id}
            timeZone={me.tenant.timezone}
            numberFormat={digits}
            sections={sections}
            current={current}
            canSell={canSell}
            notices={notices}
            branchLabel={branchLabel}
            onOpenMenu={() => setDrawerOpen(true)}
          />
          {tabs ? (
            <div className="sh-subbar">
              <div className="sh-subbar-in">{tabs}</div>
            </div>
          ) : null}
        </header>
        <main className="sh-page">
          {showBanner ? (
            <SubscriptionBanner
              subscription={me.subscription}
              numberFormat={digits}
              canPay={canSeePlan}
              className="mb-4"
            />
          ) : null}
          {children}
        </main>
      </div>

      {phone ? (
        <nav className="sh-tabbar" aria-label="الأقسام الأكثر استخداماً">
          <Link to="/" aria-current={current?.key === 'home' ? 'page' : undefined}>
            <span className="sh-tab-ic" aria-hidden="true">
              <HomeIcon size={20} />
            </span>
            الرئيسية
          </Link>
          {salesSection ? (
            <Link to={salesSection.pages[0]!.to} aria-current={current === salesSection ? 'page' : undefined}>
              <span className="sh-tab-ic" aria-hidden="true">
                <SalesIcon size={20} />
              </span>
              المبيعات
            </Link>
          ) : null}
          {canSell ? (
            <a href="/pos" className="sh-cash">
              <span className="sh-tab-ic" aria-hidden="true">
                <CashIcon size={24} />
              </span>
              الكاشير
            </a>
          ) : null}
          {productsSection ? (
            <Link
              to={productsSection.pages[0]!.to}
              aria-current={current === productsSection ? 'page' : undefined}
            >
              <span className="sh-tab-ic" aria-hidden="true">
                <ProductsIcon size={20} />
              </span>
              المنتجات
            </Link>
          ) : null}
          <button
            type="button"
            aria-label={counts.online ? `المزيد، ${counts.online.words}` : 'المزيد'}
            aria-haspopup="dialog"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="sh-tab-ic" aria-hidden="true">
              <MenuIcon size={20} />
            </span>
            المزيد
            {counts.online ? (
              <span className="sh-mdot" aria-hidden="true">
                {counts.online.value}
              </span>
            ) : null}
          </button>
        </nav>
      ) : null}

      {drawerOpen ? (
        <Drawer onClose={() => setDrawerOpen(false)}>
          <SidebarPanel
            mode="drawer"
            rail={false}
            store={store}
            groups={groups}
            current={current}
            counts={counts}
            plan={plan}
            account={account}
            onClose={() => setDrawerOpen(false)}
          />
        </Drawer>
      ) : null}
    </div>
  );
}
