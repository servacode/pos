import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useAuth, useMe } from '../auth/useAuth';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { Logo, LogoMark } from '../ui/Logo';
import { HomeIcon, LogoutIcon } from '../ui/icons';

// The menu lists only screens that exist (tab 12: no button the user cannot use). Sections join it
// as they ship, each with its icon from ui/icons and its glossary name (الزبائن، المنتجات…).
function Sidebar({ planName }: { planName: string }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-e border-line bg-surface px-3 py-4 lg:flex">
      <Link
        to="/"
        className="flex min-h-12 items-center self-start rounded-control px-2"
        aria-label="سيرفا، الرئيسية"
      >
        <Logo />
      </Link>
      <nav aria-label="القائمة الرئيسية">
        <ul className="flex flex-col gap-1">
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  'flex min-h-12 items-center gap-3 rounded-control px-3 font-semibold',
                  isActive
                    ? 'bg-brand-soft text-brand-ink'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )
              }
            >
              <HomeIcon size={24} />
              الرئيسية
            </NavLink>
          </li>
        </ul>
      </nav>
      <p className="mt-auto rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-muted">
        باقتك: <span className="font-semibold text-ink">{planName}</span>
      </p>
    </aside>
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <Sidebar planName={me.subscription.planName} />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-surface">
          <div className="flex min-h-16 items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
            <LogoMark className="lg:hidden" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate font-bold text-ink lg:text-lg">{me.tenant.name}</p>
              <p className="truncate text-sm text-ink-muted">
                {me.user.fullName}
                {role ? <span className="text-ink-subtle"> · {role}</span> : null}
              </p>
            </div>
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
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
