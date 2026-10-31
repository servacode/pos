import type { MeResponse } from '@serva/core';
import {
  CategoriesIcon,
  ClockIcon,
  DeviceIcon,
  HomeIcon,
  ProductsIcon,
  ReportsIcon,
  SalesIcon,
  ShieldCheckIcon,
  type Icon,
} from '@serva/ui';
import {
  ACCOUNTING_ACCESS,
  DAY_REPORT_ACCESS,
  EVIDENCE_ACCESS,
  holdsAny,
  inAccountingMode,
  SHIFTS_ACCESS,
  type AccessRule,
} from '../admin/reports/access';

export interface NavEntry {
  to: string;
  label: string;
  icon: Icon;
  /**
   * Shown only to whoever holds one of these keys in `me.user.permissions`; the server checks each
   * request again.
   */
  permission?: AccessRule;
  /** Shown only in accounting mode (12 › المحاسبة: hidden until it is turned on). */
  accountingMode?: boolean;
  /** Active only on this exact address (the home page) */
  end?: boolean;
}

/**
 * The admin menu (12 › خريطة الشاشات), in its order. It lists only screens that exist (tab 12: no
 * button the user cannot use), each with its icon from @serva/ui and its glossary name.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'الرئيسية', icon: HomeIcon, end: true },
  { to: '/sales/today', label: 'مبيعات اليوم', icon: SalesIcon, permission: DAY_REPORT_ACCESS },
  { to: '/shifts', label: 'الورديات', icon: ClockIcon, permission: SHIFTS_ACCESS },
  { to: '/products', label: 'المنتجات', icon: ProductsIcon, permission: ['catalog.manage'] },
  { to: '/categories', label: 'التصنيفات', icon: CategoriesIcon, permission: ['catalog.manage'] },
  {
    to: '/accounting',
    label: 'المحاسبة',
    icon: ReportsIcon,
    permission: ACCOUNTING_ACCESS,
    accountingMode: true,
  },
  { to: '/devices', label: 'الأجهزة', icon: DeviceIcon, permission: ['devices.view'] },
  { to: '/evidence', label: 'شاشة الدليل', icon: ShieldCheckIcon, permission: EVIDENCE_ACCESS },
];

export function navFor(me: Pick<MeResponse, 'user' | 'settings'>): NavEntry[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (!entry.permission || holdsAny(me, entry.permission)) &&
      (!entry.accountingMode || inAccountingMode(me)),
  );
}
