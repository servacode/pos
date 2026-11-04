import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import {
  AdminShell,
  Avatar,
  Button,
  cn,
  KeyIcon,
  Logo,
  LogoMark,
  LogoutIcon,
  NavGroup,
  navItemClass,
  SparklesIcon,
} from '@serva/ui';
import type { MeResponse } from '@serva/core';
import { useAuth, useMe } from '../auth/useAuth';
import { navFor, navSections, type NavEntry } from './nav';

// The menu lists only screens that exist and that the user may open (nav.ts), in sections.
function Sidebar({ me, entries }: { me: MeResponse; entries: NavEntry[] }) {
  const role = me.user.roles[0]?.name;
  const trial = me.subscription.status === 'trialing';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pt-5 pb-4">
        <Link
          to="/"
          className="flex min-h-12 w-fit items-center rounded-control"
          aria-label="سيرفا، الرئيسية"
        >
          <Logo />
        </Link>
      </div>

      <nav aria-label="القائمة الرئيسية" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {navSections(entries).map(({ group, entries: items }) => (
          <NavGroup key={group ?? 'home'} label={group ?? undefined}>
            {items.map(({ to, label, icon: EntryIcon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => navItemClass(isActive)}>
                  <EntryIcon size={20} />
                  {label}
                </NavLink>
              </li>
            ))}
          </NavGroup>
        ))}
      </nav>

      <div className="flex flex-col gap-3 border-t border-line p-3">
        <Link
          to="/subscription"
          className="flex items-center gap-2.5 rounded-control bg-[linear-gradient(135deg,var(--color-brand-soft),var(--color-surface-muted))] px-3 py-2.5 text-sm transition-shadow hover:shadow-e1"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-on-brand">
            <SparklesIcon size={16} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-ink">باقة {me.subscription.planName}</span>
            <span className="truncate text-xs text-ink-muted">
              {trial && me.subscription.daysLeft !== null
                ? `تجربة · باقي ${me.subscription.daysLeft} يوماً`
                : 'إدارة الاشتراك'}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-3 px-1">
          <Avatar name={me.user.fullName} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-ink">{me.user.fullName}</span>
            {role ? <span className="truncate text-xs text-ink-muted">{role}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** «الثلاثاء 4 تشرين الثاني»: today, as the shop counts it. */
function today(): string {
  return new Intl.DateTimeFormat('ar-SY-u-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  return (
    <AdminShell
      sidebar={<Sidebar me={me} entries={navFor(me)} />}
      topBar={
        <>
          <LogoMark className="lg:hidden" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate font-bold text-ink lg:text-lg">{me.tenant.name}</p>
            <p className="truncate text-sm text-ink-muted">
              {me.branches.length === 1 ? me.branches[0]!.name : `${me.branches.length} فروع`}
              <span className="hidden text-ink-subtle sm:inline"> · {today()}</span>
            </p>
          </div>
          {/* The user's own settings: for now the code they sign in with on cashier devices. */}
          <NavLink
            to="/me/pin"
            aria-label="رمز الدخول للكاشير"
            title="رمز الدخول للكاشير"
            className={({ isActive }) =>
              cn(
                'inline-flex min-h-12 shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted sm:px-4',
                isActive && 'border-brand-soft bg-brand-soft text-brand-ink',
              )
            }
          >
            <KeyIcon />
            <span className="hidden md:inline">رمز الدخول للكاشير</span>
          </NavLink>
          <Button
            variant="ghost"
            onClick={handleLogout}
            loading={signingOut}
            icon={<LogoutIcon />}
            className="shrink-0 px-3 text-sm sm:px-4"
          >
            <span className="sm:hidden">خروج</span>
            <span className="hidden sm:inline">تسجيل الخروج</span>
          </Button>
        </>
      }
    >
      {children}
    </AdminShell>
  );
}
