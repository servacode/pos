import type { MeResponse } from '@serva/core';
import {
  BarcodeIcon,
  CartIcon,
  CashIcon,
  CategoriesIcon,
  CustomersIcon,
  ClockIcon,
  DeviceIcon,
  HomeIcon,
  OfferIcon,
  PrintIcon,
  ProductsIcon,
  SettingsIcon,
  ReportsIcon,
  SalesIcon,
  ShieldCheckIcon,
  TrendUpIcon,
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
  { to: '/reports/merchandise', label: 'حركة الأصناف', icon: ReportsIcon, permission: ['report.view'] },
  { to: '/products', label: 'المنتجات', icon: ProductsIcon, permission: ['catalog.manage'] },
  { to: '/categories', label: 'التصنيفات', icon: CategoriesIcon, permission: ['catalog.manage'] },
  { to: '/promotions', label: 'العروض', icon: OfferIcon, permission: ['catalog.manage'] },
  { to: '/labels', label: 'طباعة الملصقات', icon: PrintIcon, permission: ['catalog.manage'] },
  { to: '/customers', label: 'الزبائن', icon: CustomersIcon, permission: ['customers.view'] },
  { to: '/cheques', label: 'الشيكات', icon: CashIcon, permission: ['customers.view'] },
  { to: '/purchases', label: 'المشتريات', icon: CartIcon, permission: ['purchases.manage'] },
  { to: '/inventory', label: 'المخزون والأرباح', icon: TrendUpIcon, permission: ['cost.view'] },
  { to: '/expiry', label: 'الصلاحية', icon: ClockIcon, permission: ['purchases.manage'] },
  { to: '/serials', label: 'الأرقام التسلسلية', icon: BarcodeIcon, permission: ['catalog.manage'] },
  {
    to: '/accounting',
    label: 'المحاسبة',
    icon: ReportsIcon,
    permission: ACCOUNTING_ACCESS,
    accountingMode: true,
  },
  { to: '/devices', label: 'الأجهزة', icon: DeviceIcon, permission: ['devices.view'] },
  { to: '/evidence', label: 'شاشة الدليل', icon: ShieldCheckIcon, permission: EVIDENCE_ACCESS },
  { to: '/settings', label: 'إعدادات المتجر', icon: SettingsIcon, permission: ['settings.manage'] },
  { to: '/subscription', label: 'الاشتراك', icon: ShieldCheckIcon, permission: ['subscription.manage'] },
];

export function navFor(me: Pick<MeResponse, 'user' | 'settings'>): NavEntry[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (!entry.permission || holdsAny(me, entry.permission)) &&
      (!entry.accountingMode || inAccountingMode(me)),
  );
}
