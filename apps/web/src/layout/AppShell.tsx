import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import {
  AdminShell,
  Button,
  DeviceIcon,
  HomeIcon,
  Logo,
  LogoMark,
  LogoutIcon,
  navItemClass,
} from '@serva/ui';
import { useAuth, useMe } from '../auth/useAuth';

// The menu lists only screens that exist (tab 12: no button the user cannot use). Sections join it
// as they ship, each with its icon from @serva/ui and its glossary name (الزبائن، المنتجات…).
function Sidebar({ planName, showDevices }: { planName: string; showDevices: boolean }) {
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
          <li>
            <NavLink to="/" end className={({ isActive }) => navItemClass(isActive)}>
              <HomeIcon size={24} />
              الرئيسية
            </NavLink>
          </li>
          {showDevices ? (
            <li>
              <NavLink to="/devices" className={({ isActive }) => navItemClass(isActive)}>
                <DeviceIcon size={24} />
                الأجهزة
              </NavLink>
            </li>
          ) : null}
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
  // The owner and branch managers see the devices; the server checks each request again.
  const showDevices = me.user.roles.some((r) => r.key === 'owner' || r.key === 'manager');

  async function handleLogout() {
    setSigningOut(true);
    await logout();
  }

  return (
    <AdminShell
      sidebar={<Sidebar planName={me.subscription.planName} showDevices={showDevices} />}
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
