import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth, useMe } from '../auth/useAuth';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { SoonBadge } from '../ui/Badge';
import { Logo, LogoMark } from '../ui/Logo';
import {
  CartIcon,
  ChartIcon,
  HomeIcon,
  LogoutIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon,
  WarehouseIcon,
  type Icon,
} from '../ui/icons';

interface NavItem {
  label: string;
  icon: Icon;
}

const UPCOMING: readonly NavItem[] = [
  { label: 'البيع', icon: CartIcon },
  { label: 'المنتجات', icon: PackageIcon },
  { label: 'المخزون', icon: WarehouseIcon },
  { label: 'العملاء', icon: UsersIcon },
  { label: 'التقارير', icon: ChartIcon },
  { label: 'الإعدادات', icon: SettingsIcon },
];

function HomeLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      aria-current="page"
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-3 rounded-control bg-brand-soft font-semibold text-brand-ink',
        compact ? 'rounded-full px-4 text-sm' : 'px-3',
      )}
    >
      <HomeIcon />
      الرئيسية
    </Link>
  );
}

function UpcomingItem({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const ItemIcon = item.icon;
  return (
    <span
      aria-disabled="true"
      className={cn(
        'flex min-h-11 shrink-0 cursor-default items-center gap-3 text-ink-subtle',
        compact ? 'gap-2 rounded-full border border-line px-3.5 text-sm' : 'rounded-control px-3',
      )}
    >
      <ItemIcon />
      <span className={compact ? undefined : 'flex-1'}>{item.label}</span>
      <SoonBadge />
    </span>
  );
}

function Sidebar({ planName }: { planName: string }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-e border-line bg-surface px-4 py-6 lg:flex">
      <Link to="/" className="self-start rounded-control px-2" aria-label="Serva POS">
        <Logo markClassName="size-9" />
      </Link>
      <nav aria-label="القائمة الرئيسية">
        <ul className="flex flex-col gap-1">
          <li>
            <HomeLink />
          </li>
          {UPCOMING.map((item) => (
            <li key={item.label}>
              <UpcomingItem item={item} />
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-auto rounded-control bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
        باقتك: <span className="font-semibold text-ink">{planName}</span>
      </p>
    </aside>
  );
}

function MobileNav() {
  return (
    <nav aria-label="القائمة الرئيسية" className="lg:hidden">
      <ul className="scrollbar-none -mb-px flex gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
        <li>
          <HomeLink compact />
        </li>
        {UPCOMING.map((item) => (
          <li key={item.label}>
            <UpcomingItem item={item} compact />
          </li>
        ))}
      </ul>
    </nav>
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Sidebar planName={me.subscription.planName} />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-md lg:bg-canvas/85">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-10 lg:py-5">
            <LogoMark className="size-10 lg:hidden" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-base font-bold text-ink lg:text-xl">{me.tenant.name}</p>
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
          <MobileNav />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
