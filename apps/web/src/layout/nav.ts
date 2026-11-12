import type { MeResponse } from '@serva/core';
import type { SectorKey } from '@serva/core';
import {
  CalendarIcon,
  CartIcon,
  CategoriesIcon,
  ChequeIcon,
  ClockIcon,
  CustomersIcon,
  DeviceIcon,
  HomeIcon,
  ListIcon,
  BookIcon,
  MegaphoneIcon,
  OfferIcon,
  PackageOpenIcon,
  PercentIcon,
  PrintIcon,
  ProductsIcon,
  ReportsIcon,
  SalesIcon,
  SerialIcon,
  SettingsIcon,
  ShieldCheckIcon,
  StockIcon,
  StoreIcon,
  TransferIcon,
  UndoIcon,
  UserIcon,
  CardIcon,
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
import { CHEQUE_SECTORS, EXPIRY_SECTORS, HALL_SECTORS, SERIAL_SECTORS, storeSells } from '../lib/sectors';

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
  /**
   * Shown only to stores with one of these business types (هوية 2: a clothing store does not see
   * expiry dates). A store with no business type set sees everything.
   */
  sectors?: readonly SectorKey[];
}

export type NavGroupKey = 'home' | 'selling' | 'stock' | 'admin';

/** The menu's groups, in order; the home page stands alone at the top. */
export const NAV_GROUPS: readonly { key: NavGroupKey; label?: string }[] = [
  { key: 'home' },
  { key: 'selling', label: 'البيع والزبائن' },
  { key: 'stock', label: 'البضاعة' },
  { key: 'admin', label: 'الإدارة' },
];

export type NavSectionKey =
  | 'home'
  | 'sales'
  | 'customers'
  | 'online'
  | 'products'
  | 'promotions'
  | 'purchases'
  | 'inventory'
  | 'reports'
  | 'settings';

/**
 * One menu link each. Related pages share a section: the menu shows the section once, and the
 * section's pages are tabs above the page (a short menu instead of twenty links).
 */
export const NAV_SECTIONS: readonly { key: NavSectionKey; group: NavGroupKey; label: string; icon: Icon }[] =
  [
    { key: 'home', group: 'home', label: 'الرئيسية', icon: HomeIcon },
    { key: 'sales', group: 'selling', label: 'المبيعات', icon: SalesIcon },
    { key: 'customers', group: 'selling', label: 'الزبائن', icon: CustomersIcon },
    { key: 'online', group: 'selling', label: 'المتجر الإلكتروني', icon: StoreIcon },
    { key: 'products', group: 'stock', label: 'المنتجات', icon: ProductsIcon },
    { key: 'promotions', group: 'stock', label: 'العروض', icon: OfferIcon },
    { key: 'purchases', group: 'stock', label: 'المشتريات', icon: CartIcon },
    { key: 'inventory', group: 'stock', label: 'المخزون', icon: StockIcon },
    { key: 'reports', group: 'admin', label: 'التقارير', icon: ReportsIcon },
    { key: 'settings', group: 'admin', label: 'الإعدادات', icon: SettingsIcon },
  ];

/**
 * The admin pages (12 › خريطة الشاشات), in their order inside each section. It lists only screens
 * that exist (tab 12: no button the user cannot use), each with its glossary name.
 */
export const NAV_ENTRIES: readonly (NavEntry & { section: NavSectionKey })[] = [
  { section: 'home', to: '/', label: 'الرئيسية', icon: HomeIcon, end: true },
  {
    section: 'sales',
    to: '/sales/today',
    label: 'مبيعات اليوم',
    icon: SalesIcon,
    permission: DAY_REPORT_ACCESS,
  },
  {
    section: 'sales',
    to: '/sales/invoices',
    label: 'الفواتير',
    icon: ListIcon,
    permission: ['report.view'],
  },
  { section: 'sales', to: '/shifts', label: 'الورديات', icon: ClockIcon, permission: SHIFTS_ACCESS },
  {
    section: 'customers',
    to: '/customers',
    label: 'الزبائن',
    icon: CustomersIcon,
    permission: ['customers.view'],
  },
  {
    section: 'customers',
    to: '/cheques',
    label: 'الشيكات',
    icon: ChequeIcon,
    permission: ['customers.view'],
    sectors: CHEQUE_SECTORS,
  },
  {
    section: 'customers',
    to: '/messages',
    label: 'رسائل للزبائن',
    icon: MegaphoneIcon,
    permission: ['customers.manage'],
  },
  {
    section: 'online',
    to: '/online-store',
    label: 'المتجر الإلكتروني',
    icon: StoreIcon,
    permission: ['settings.manage', 'customers.view'],
  },
  {
    section: 'products',
    to: '/products',
    label: 'المنتجات',
    icon: ProductsIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/categories',
    label: 'التصنيفات',
    icon: CategoriesIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/prices',
    label: 'تغيير الأسعار',
    icon: PercentIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/price-list',
    label: 'تحديث الأسعار من ملف',
    icon: PercentIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/labels',
    label: 'طباعة الملصقات',
    icon: PrintIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/import',
    label: 'استيراد البيانات',
    icon: PackageOpenIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'promotions',
    to: '/promotions',
    label: 'العروض',
    icon: OfferIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'purchases',
    to: '/purchases',
    label: 'المشتريات',
    icon: CartIcon,
    permission: ['purchases.manage'],
  },
  {
    section: 'purchases',
    to: '/supplier-returns',
    label: 'مرتجع إلى المورد',
    icon: UndoIcon,
    permission: ['purchases.manage'],
  },
  {
    section: 'purchases',
    to: '/expenses',
    label: 'المصاريف',
    icon: CardIcon,
    permission: ['expenses.manage'],
  },
  {
    section: 'inventory',
    to: '/inventory',
    label: 'المخزون والأرباح',
    icon: StockIcon,
    permission: ['cost.view'],
  },
  {
    section: 'inventory',
    to: '/transfers',
    label: 'التحويل بين الفروع',
    icon: TransferIcon,
    permission: ['inventory.adjust'],
  },
  {
    section: 'inventory',
    to: '/expiry',
    label: 'الصلاحية',
    icon: CalendarIcon,
    permission: ['purchases.manage'],
    sectors: EXPIRY_SECTORS,
  },
  {
    section: 'inventory',
    to: '/controlled-register',
    label: 'سجل الأدوية المراقبة',
    icon: ShieldCheckIcon,
    permission: ['pharmacy.controlled'],
    sectors: ['pharmacy'],
  },
  {
    section: 'inventory',
    to: '/serials',
    label: 'الأرقام التسلسلية',
    icon: SerialIcon,
    permission: ['catalog.manage'],
    sectors: SERIAL_SECTORS,
  },
  {
    section: 'reports',
    to: '/reports/merchandise',
    label: 'حركة الأصناف',
    icon: ReportsIcon,
    permission: ['report.view'],
  },
  {
    section: 'reports',
    to: '/reports/cancellations',
    label: 'الإلغاءات بعد المطبخ',
    icon: ReportsIcon,
    permission: ['report.view'],
    sectors: HALL_SECTORS,
  },
  {
    section: 'reports',
    to: '/accounting',
    label: 'المحاسبة',
    icon: BookIcon,
    permission: ACCOUNTING_ACCESS,
    accountingMode: true,
  },
  {
    section: 'reports',
    to: '/evidence',
    label: 'شاشة الدليل',
    icon: ShieldCheckIcon,
    permission: EVIDENCE_ACCESS,
  },
  {
    section: 'settings',
    to: '/settings',
    label: 'إعدادات المتجر',
    icon: SettingsIcon,
    permission: ['settings.manage'],
  },
  {
    section: 'settings',
    to: '/staff',
    label: 'الموظفون',
    icon: UserIcon,
    permission: ['users.manage'],
  },
  { section: 'settings', to: '/devices', label: 'الأجهزة', icon: DeviceIcon, permission: ['devices.view'] },
  {
    section: 'settings',
    to: '/subscription',
    label: 'الاشتراك',
    icon: CardIcon,
    permission: ['subscription.manage'],
  },
];

function fitsSectors(entry: NavEntry, sectors: readonly SectorKey[] | undefined): boolean {
  return !entry.sectors || storeSells(sectors, entry.sectors);
}

type NavMe = Pick<MeResponse, 'user' | 'settings'> & { tenant?: { sectors?: readonly SectorKey[] } };

/** The pages this user may open, flat and in menu order. */
export function navFor(me: NavMe): (NavEntry & { section: NavSectionKey })[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (!entry.permission || holdsAny(me, entry.permission)) &&
      (!entry.accountingMode || inAccountingMode(me)) &&
      fitsSectors(entry, me.tenant?.sectors),
  );
}

export interface NavSection {
  key: NavSectionKey;
  label: string;
  icon: Icon;
  /** The pages of the section this user may open; the first is where its menu link goes */
  pages: NavEntry[];
}

/** The sections this user may open; a section with no page they may open is left out. */
export function navSectionsFor(me: NavMe): (NavSection & { group: NavGroupKey })[] {
  const pages = navFor(me);
  return NAV_SECTIONS.map((section) => ({
    ...section,
    pages: pages.filter((page) => page.section === section.key),
  })).filter((section) => section.pages.length > 0);
}

/** The sections in their groups; a group with nothing the user may open is left out. */
export function navGroupsFor(me: NavMe): { key: NavGroupKey; label?: string; sections: NavSection[] }[] {
  const sections = navSectionsFor(me);
  return NAV_GROUPS.map((group) => ({
    ...group,
    sections: sections.filter((section) => section.group === group.key),
  })).filter((group) => group.sections.length > 0);
}

/** Whether a page owns this address: its own, or one under it (/products/123). */
export function pageOwns(page: Pick<NavEntry, 'to' | 'end'>, pathname: string): boolean {
  if (page.end || page.to === '/') return pathname === page.to;
  return pathname === page.to || pathname.startsWith(`${page.to}/`);
}

/** The section the address belongs to, among those this user may open. */
export function sectionAt<S extends Pick<NavSection, 'pages'>>(
  sections: readonly S[],
  pathname: string,
): S | undefined {
  return sections.find((section) => section.pages.some((page) => pageOwns(page, pathname)));
}
