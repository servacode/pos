import type { MeResponse } from '@serva/core';
import {
  AccountingIcon,
  CategoriesIcon,
  ClockIcon,
  CustomersIcon,
  DashboardIcon,
  DeviceIcon,
  ExpiryIcon,
  InventoryIcon,
  MessagesIcon,
  OfferIcon,
  OnlineStoreIcon,
  PricesIcon,
  PrintIcon,
  ProductsIcon,
  ReportsIcon,
  SalesIcon,
  SerialIcon,
  SettingsIcon,
  ShieldCheckIcon,
  CartIcon,
  SubscriptionIcon,
  SupplierReturnIcon,
  TransferIcon,
  WalletIcon,
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

/** The menu's sections, in order; the home page stands above them with no title. */
export const NAV_GROUPS = ['البيع', 'الأصناف', 'الزبائن', 'المخزون والمشتريات', 'الإدارة'] as const;
export type NavGroupName = (typeof NAV_GROUPS)[number];

export interface NavEntry {
  to: string;
  /** Its section; none for the home page */
  group?: NavGroupName;
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
  { to: '/', label: 'الرئيسية', icon: DashboardIcon, end: true },

  {
    group: 'البيع',
    to: '/sales/today',
    label: 'مبيعات اليوم',
    icon: SalesIcon,
    permission: DAY_REPORT_ACCESS,
  },
  { group: 'البيع', to: '/shifts', label: 'الورديات', icon: ClockIcon, permission: SHIFTS_ACCESS },
  {
    group: 'البيع',
    to: '/reports/merchandise',
    label: 'حركة الأصناف',
    icon: ReportsIcon,
    permission: ['report.view'],
  },

  {
    group: 'الأصناف',
    to: '/products',
    label: 'المنتجات',
    icon: ProductsIcon,
    permission: ['catalog.manage'],
  },
  {
    group: 'الأصناف',
    to: '/categories',
    label: 'التصنيفات',
    icon: CategoriesIcon,
    permission: ['catalog.manage'],
  },
  { group: 'الأصناف', to: '/promotions', label: 'العروض', icon: OfferIcon, permission: ['catalog.manage'] },
  {
    group: 'الأصناف',
    to: '/prices',
    label: 'تغيير الأسعار',
    icon: PricesIcon,
    permission: ['catalog.manage'],
  },
  {
    group: 'الأصناف',
    to: '/labels',
    label: 'طباعة الملصقات',
    icon: PrintIcon,
    permission: ['catalog.manage'],
  },
  {
    group: 'الأصناف',
    to: '/serials',
    label: 'الأرقام التسلسلية',
    icon: SerialIcon,
    permission: ['catalog.manage'],
  },

  {
    group: 'الزبائن',
    to: '/customers',
    label: 'الزبائن',
    icon: CustomersIcon,
    permission: ['customers.view'],
  },
  {
    group: 'الزبائن',
    to: '/messages',
    label: 'رسائل للزبائن',
    icon: MessagesIcon,
    permission: ['customers.manage'],
  },
  { group: 'الزبائن', to: '/cheques', label: 'الشيكات', icon: WalletIcon, permission: ['customers.view'] },
  {
    group: 'الزبائن',
    to: '/online-store',
    label: 'المتجر الإلكتروني',
    icon: OnlineStoreIcon,
    permission: ['settings.manage', 'customers.view'],
  },

  {
    group: 'المخزون والمشتريات',
    to: '/purchases',
    label: 'المشتريات',
    icon: CartIcon,
    permission: ['purchases.manage'],
  },
  {
    group: 'المخزون والمشتريات',
    to: '/inventory',
    label: 'المخزون والأرباح',
    icon: InventoryIcon,
    permission: ['cost.view'],
  },
  {
    group: 'المخزون والمشتريات',
    to: '/transfers',
    label: 'التحويل بين الفروع',
    icon: TransferIcon,
    permission: ['inventory.adjust'],
  },
  {
    group: 'المخزون والمشتريات',
    to: '/supplier-returns',
    label: 'مرتجع إلى المورد',
    icon: SupplierReturnIcon,
    permission: ['purchases.manage'],
  },
  {
    group: 'المخزون والمشتريات',
    to: '/expiry',
    label: 'الصلاحية',
    icon: ExpiryIcon,
    permission: ['purchases.manage'],
  },

  {
    group: 'الإدارة',
    to: '/accounting',
    label: 'المحاسبة',
    icon: AccountingIcon,
    permission: ACCOUNTING_ACCESS,
    accountingMode: true,
  },
  { group: 'الإدارة', to: '/devices', label: 'الأجهزة', icon: DeviceIcon, permission: ['devices.view'] },
  {
    group: 'الإدارة',
    to: '/evidence',
    label: 'شاشة الدليل',
    icon: ShieldCheckIcon,
    permission: EVIDENCE_ACCESS,
  },
  {
    group: 'الإدارة',
    to: '/settings',
    label: 'إعدادات المتجر',
    icon: SettingsIcon,
    permission: ['settings.manage'],
  },
  {
    group: 'الإدارة',
    to: '/subscription',
    label: 'الاشتراك',
    icon: SubscriptionIcon,
    permission: ['subscription.manage'],
  },
];

export function navFor(me: Pick<MeResponse, 'user' | 'settings'>): NavEntry[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (!entry.permission || holdsAny(me, entry.permission)) &&
      (!entry.accountingMode || inAccountingMode(me)),
  );
}

/** The entries the user may open, in sections: the untitled one (home) first. */
export function navSections(
  entries: readonly NavEntry[],
): { group: NavGroupName | null; entries: NavEntry[] }[] {
  const sections: { group: NavGroupName | null; entries: NavEntry[] }[] = [
    { group: null, entries: entries.filter((e) => !e.group) },
    ...NAV_GROUPS.map((group) => ({ group, entries: entries.filter((e) => e.group === group) })),
  ];
  return sections.filter((section) => section.entries.length > 0);
}
