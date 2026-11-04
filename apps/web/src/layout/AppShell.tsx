import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { sectorLabel } from '@serva/core';
import {
  AdminShell,
  Button,
  KeyIcon,
  Logo,
  LogoMark,
  LogoutIcon,
  NavGroup,
  cn,
  navItemClass,
} from '@serva/ui';
import { useAuth, useMe } from '../auth/useAuth';
import { navGroupsFor, type NavEntry, type NavGroupKey } from './nav';

// The menu lists only screens that exist and that the user may open (nav.ts), in groups.
function Sidebar({
  planName,
  groups,
}: {
  planName: string;
  groups: { key: NavGroupKey; label?: string; entries: NavEntry[] }[];
}) {
  return (
    <>
      <Link
        to="/"
        className="flex min-h-12 items-center self-start rounded-control px-2"
        aria-label="سيرفا، الرئيسية"
      >
        <Logo />
      </Link>
      <nav aria-label="القائمة الرئيسية" className="flex flex-col">
        {groups.map((group) => (
          <NavGroup key={group.key} label={group.label}>
            {group.entries.map(({ to, label, icon: EntryIcon, end }) => (
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
      <p className="mt-auto rounded-control border border-line bg-canvas px-3 py-2.5 text-sm text-ink-muted">
        باقتك: <span className="font-semibold text-ink">{planName}</span>
      </p>
    </>
  );
}

/** The first letters of the store's first two words, for the top bar's round badge. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const role = me.user.roles[0]?.name;

  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  return (
    <AdminShell
      sidebar={<Sidebar planName={me.subscription.planName} groups={navGroupsFor(me)} />}
      topBar={
        <>
          <LogoMark className="lg:hidden" />
          <span
            aria-hidden="true"
            className="hidden size-10 shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand-ink sm:grid"
          >
            {initials(me.tenant.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate font-bold text-ink">
              {me.tenant.name}
              {me.tenant.sectors[0] ? (
                <span className="ms-2 hidden rounded-full bg-surface-muted px-2 py-0.5 align-middle text-xs font-semibold text-ink-muted md:inline">
                  {sectorLabel(me.tenant.sectors[0])}
                </span>
              ) : null}
            </p>
            <p className="truncate text-sm text-ink-muted">
              {me.user.fullName}
              {role ? <span className="text-ink-subtle"> · {role}</span> : null}
            </p>
          </div>
          {/* The user's own settings: for now the code they sign in with on cashier devices. */}
          <NavLink
            to="/me/pin"
            aria-label="رمز الدخول للكاشير"
            title="رمز الدخول للكاشير"
            className={({ isActive }) =>
              cn(
                'inline-flex min-h-12 shrink-0 items-center gap-2 rounded-control px-3 font-semibold text-ink hover:bg-surface-muted sm:px-4',
                isActive && 'bg-brand-soft text-brand-ink',
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
            className="shrink-0 px-3 sm:px-4"
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
