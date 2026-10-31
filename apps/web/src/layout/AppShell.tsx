import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { AdminShell, Button, KeyIcon, Logo, LogoMark, LogoutIcon, cn, navItemClass } from '@serva/ui';
import { useAuth, useMe } from '../auth/useAuth';
import { navFor, type NavEntry } from './nav';

// The menu lists only screens that exist and that the user may open (nav.ts).
function Sidebar({ planName, entries }: { planName: string; entries: NavEntry[] }) {
  return (
    <>
      <Link
        to="/"
        className="flex min-h-12 items-center self-start rounded-control px-2"
        aria-label="سيرفا، الرئيسية"
      >
        <Logo />
      </Link>
      <nav aria-label="القائمة الرئيسية">
        <ul className="flex flex-col gap-1">
          {entries.map(({ to, label, icon: EntryIcon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => navItemClass(isActive)}>
                <EntryIcon size={24} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-auto rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-muted">
        باقتك: <span className="font-semibold text-ink">{planName}</span>
      </p>
    </>
  );
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
      sidebar={<Sidebar planName={me.subscription.planName} entries={navFor(me.user.permissions)} />}
      topBar={
        <>
          <LogoMark className="lg:hidden" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate font-bold text-ink lg:text-lg">{me.tenant.name}</p>
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
