import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { MeResponse, OnlineOrder } from '@serva/core';
import {
  AdminShell,
  CardIcon,
  CONTROL_HEIGHT,
  GiftIcon,
  Logo,
  LogoMark,
  NavGroup,
  NavItem,
  SparklesIcon,
  StoreIcon,
  Tooltip,
  cn,
} from '@serva/ui';
import { holdsAny } from '../admin/reports/access';
import { useAuth, useMe } from '../auth/useAuth';
import { apiFetch } from '../lib/api';
import { formatDays } from '../lib/format';
import { navGroupsFor, pageOwns, sectionAt, type NavGroupKey, type NavSection } from './nav';
import { TopBar, type Notice } from './TopBar';

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

/** The last answer per signed-in user (a new sign-in brings a new `me`, and asks again). */
const pendingSeen = new WeakMap<MeResponse, { at: number; items: OnlineOrder[] }>();

/**
 * The online shop's pending orders and holds, for the bell and the sidebar's count: the request the
 * home page makes, for whoever may see the orders (customers.view, as the server checks). Every page
 * mounts its own shell, so an answer under 30 seconds old is reused instead of asked again, except
 * after the online store's page, where orders are accepted and refused.
 */
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
    const seen = pendingSeen.get(me);
    if (seen && Date.now() - seen.at < PENDING_FRESH_MS) return;
    let current = true;
    getPendingOrders().then(
      ({ items: fresh }) => {
        pendingSeen.set(me, { at: Date.now(), items: fresh });
        if (current) setItems(fresh);
      },
      // The bell keeps what it had; the page's own requests say when the connection is down.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [me, allowed]);
  return allowed ? items : [];
}

function trialText(daysLeft: number | null, numberFormat: MeResponse['settings']['numberFormat']): string {
  if (daysLeft === null) return 'أنت على الباقة المجانية';
  if (daysLeft <= 0) return 'تنتهي الباقة المجانية اليوم';
  return `باقي ${formatDays(daysLeft, numberFormat)} من الباقة المجانية`;
}

/**
 * The bell's list: only what the app already knows. The shop's pending orders and holds (for whoever
 * may see them), and the subscription's state for whoever manages it. `attention` counts toward the
 * bell's dot: a trial with days to spare is news, not an alarm.
 */
function noticesFor(me: MeResponse, pending: OnlineOrder[], canSeePlan: boolean): Notice[] {
  const notices: Notice[] = [];
  const holds = pending.filter((order) => order.source === 'hold').length;
  const orders = pending.length - holds;
  if (orders > 0) {
    notices.push({
      key: 'orders',
      to: '/online-store',
      icon: StoreIcon,
      tone: 'warning',
      title: orders === 1 ? 'طلب جديد من المتجر الإلكتروني' : 'طلبات جديدة من المتجر الإلكتروني',
      detail: 'بانتظار قبولك أو رفضك',
      count: orders,
      attention: orders,
    });
  }
  if (holds > 0) {
    notices.push({
      key: 'holds',
      to: '/online-store',
      icon: GiftIcon,
      tone: 'brand',
      title: holds === 1 ? 'قطعة محجوزة بعربون' : 'قطع محجوزة بعربون',
      detail: 'تنتظر صاحبها في المحل',
      count: holds,
      attention: holds,
    });
  }
  if (canSeePlan) {
    const { status, daysLeft } = me.subscription;
    const days = daysLeft === null ? '' : formatDays(daysLeft, me.settings.numberFormat);
    if (status === 'trialing') {
      const endingSoon = daysLeft !== null && daysLeft <= 3;
      notices.push({
        key: 'plan',
        to: '/subscription',
        icon: GiftIcon,
        tone: endingSoon ? 'warning' : 'brand',
        title: trialText(daysLeft, me.settings.numberFormat),
        detail: 'اختر باقة ليبقى متجرك شغّالاً بعدها',
        attention: endingSoon ? 1 : 0,
      });
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

// ── The sidebar ──────────────────────────────────────────────────────────────────────────────────

// The menu lists one link per section the user may open (nav.ts), in groups; a section's pages
// are tabs above the page (SectionTabs).
function Sidebar({
  collapsed,
  groups,
  current,
  counts,
  plan,
}: {
  collapsed: boolean;
  groups: { key: NavGroupKey; label?: string; sections: NavSection[] }[];
  current: NavSection | undefined;
  counts: Partial<Record<NavSection['key'], number>>;
  plan: { name: string; note: string | undefined; canManage: boolean };
}) {
  return (
    <>
      <div className={cn('flex h-8 shrink-0 items-center', collapsed ? 'justify-center' : 'px-1.5')}>
        <Link
          to="/"
          className="flex min-h-12 items-center rounded-control px-1 focus-visible:outline-sidebar-brand"
          aria-label="سيرفا، الرئيسية"
        >
          {collapsed ? <LogoMark /> : <Logo tone="sidebar" />}
        </Link>
      </div>
      <nav aria-label="القائمة الرئيسية" className="mt-6 flex flex-col">
        {groups.map((group) => (
          <NavGroup key={group.key} label={group.label}>
            {group.sections.map((section) => {
              const SectionIcon = section.icon;
              return (
                <li key={section.key}>
                  <NavItem
                    as={Link}
                    to={section.pages[0]!.to}
                    active={section === current}
                    icon={<SectionIcon size={20} />}
                    count={counts[section.key]}
                  >
                    {section.label}
                  </NavItem>
                </li>
              );
            })}
          </NavGroup>
        ))}
      </nav>
      <PlanCard collapsed={collapsed} {...plan} />
    </>
  );
}

/** The store's plan at the foot of the sidebar, with the way to the subscription for its manager. */
function PlanCard({
  collapsed,
  name,
  note,
  canManage,
}: {
  collapsed: boolean;
  name: string;
  note: string | undefined;
  canManage: boolean;
}) {
  if (collapsed) {
    if (!canManage) return null;
    const label = `باقتك: ${name}`;
    return (
      <div className="mt-auto flex justify-center pt-4">
        <Tooltip content={label} side="end">
          <Link
            to="/subscription"
            aria-label={label}
            className={cn(
              CONTROL_HEIGHT.comfortable,
              'grid w-10 place-items-center rounded-control text-sidebar-brand transition-colors duration-120 ease-standard hover:bg-sidebar-hover focus-visible:outline-sidebar-brand pointer-coarse:w-12',
            )}
          >
            <SparklesIcon />
          </Link>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="mt-auto pt-4">
      <div className="rounded-card border border-sidebar-line bg-sidebar-hover p-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-small bg-sidebar-active text-sidebar-brand"
          >
            <SparklesIcon size={16} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-sidebar-muted">باقتك</span>
            <span className="truncate text-sm font-semibold text-sidebar-strong">{name}</span>
          </div>
        </div>
        {note ? <p className="mt-2.5 text-xs text-sidebar-muted">{note}</p> : null}
        {canManage ? (
          <Link
            to="/subscription"
            className={cn(
              CONTROL_HEIGHT.comfortable,
              'mt-3 flex items-center justify-center rounded-control bg-sidebar-active px-3 text-sm font-semibold text-sidebar-strong transition-colors duration-120 ease-standard hover:bg-sidebar-line focus-visible:outline-sidebar-brand',
            )}
          >
            إدارة الاشتراك
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// ── The section's pages, as tabs under the top bar ──────────────────────────────────────────────

/**
 * The pages of the current section as underline tabs (هوية 4 › Underline tabs), links to each page,
 * for a section of two pages or more. They stay under the top bar as the page scrolls.
 */
function SectionTabs({ section, pathname }: { section: NavSection; pathname: string }) {
  return (
    // -mb-px: the open tab's line lies on the header's hairline.
    <nav aria-label={`صفحات ${section.label}`} className="-mb-px scrollbar-none overflow-x-auto">
      <ul className="flex min-w-max gap-1">
        {section.pages.map((page) => {
          const active = pageOwns(page, pathname);
          return (
            <li key={page.to}>
              <Link
                to={page.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  CONTROL_HEIGHT.comfortable,
                  // The focus ring is drawn inside the tab, so the scrolling strip never clips it.
                  'inline-flex items-center rounded-t-small border-b-2 px-3 text-[0.9375rem] font-semibold whitespace-nowrap transition-colors duration-120 ease-standard focus-visible:-outline-offset-2',
                  active
                    ? 'border-brand text-ink'
                    : 'border-transparent text-ink-muted hover:border-line-control/50 hover:text-ink',
                )}
              >
                {page.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Words that say what a shop is rather than its name: «متجر أحمد نور» shows «أن».
const SHOP_WORDS = new Set(['متجر', 'محل', 'محلات', 'شركة', 'مؤسسة', 'سوبرماركت', 'صيدلية', 'مطعم']);

/** The first letters of the store's name, for the top bar's store square. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const named = words.filter((word) => !SHOP_WORDS.has(word));
  return (named.length > 0 ? named : words)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}

/**
 * The frame of every admin page (هوية 4): the sidebar of sections, the top bar, the section's tabs.
 * Each page mounts its own, so what must outlive a page (the fold) lives on the device.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A page chosen in the drawer closes it.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const groups = navGroupsFor(me);
  const sections = groups.flatMap((group) => group.sections);
  const current = sectionAt(sections, pathname);
  const canSeePlan = holdsAny(me, ['subscription.manage']);
  const seesOrders = holdsAny(me, ['customers.view']);
  const pending = usePendingOrders(me, seesOrders, pathname);
  const notices = seesOrders || canSeePlan ? noticesFor(me, pending, canSeePlan) : null;
  const { status, daysLeft } = me.subscription;
  const plan = {
    name: me.subscription.planName,
    note:
      status === 'trialing' && daysLeft !== null
        ? daysLeft <= 0
          ? 'تنتهي التجربة اليوم'
          : `باقي ${formatDays(daysLeft, me.settings.numberFormat)} على نهاية التجربة`
        : undefined,
    canManage: canSeePlan,
  };

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    keepCollapsed(next);
  }

  const tabs =
    current && current.pages.length > 1 ? <SectionTabs section={current} pathname={pathname} /> : undefined;

  return (
    <AdminShell
      collapsed={collapsed}
      drawerOpen={drawerOpen}
      onDrawerOpenChange={setDrawerOpen}
      sidebar={({ collapsed: folded }) => (
        <Sidebar
          collapsed={folded}
          groups={groups}
          current={current}
          counts={{ online: pending.length || undefined }}
          plan={plan}
        />
      )}
      topBar={
        <TopBar
          storeName={me.tenant.name}
          storeInitials={initials(me.tenant.name)}
          userName={me.user.fullName}
          roleName={me.user.roles[0]?.name}
          planName={me.subscription.planName}
          sections={sections}
          current={current}
          canSell={holdsAny(me, ['sale.create'])}
          canSeePlan={canSeePlan}
          notices={notices}
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          onOpenMenu={() => setDrawerOpen(true)}
          onLogout={logout}
        />
      }
      subBar={tabs}
    >
      {children}
    </AdminShell>
  );
}
