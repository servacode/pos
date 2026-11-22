import type { MeResponse } from '@serva/core';
import type { SectorKey } from '@serva/core';
import {
  CalendarIcon,
  CartIcon,
  CategoriesIcon,
  ChequeIcon,
  ClockIcon,
  CustomersIcon,
  DeleteIcon,
  DeviceIcon,
  HomeIcon,
  InboxIcon,
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
  KeyIcon,
  SerialIcon,
  SettingsIcon,
  ShieldCheckIcon,
  StockIcon,
  StoreIcon,
  TransferIcon,
  UndoIcon,
  UserIcon,
  WrenchIcon,
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
import {
  CHEQUE_SECTORS,
  CONTRACT_PRICE_SECTORS,
  EXPIRY_SECTORS,
  HALL_SECTORS,
  MEDICINAL_SECTORS,
  MODIFIER_SECTORS,
  RENTAL_SECTORS,
  SERIAL_SECTORS,
  storeSells,
  WARRANTY_SECTORS,
} from '../lib/sectors';

export interface NavEntry {
  to: string;
  label: string;
  /** The shorter words the page's tab shows on a phone strip (the link keeps `label` as its name); defaults to `label` */
  tab?: string;
  icon: Icon;
  /**
   * Shown only to whoever holds one of these keys in `me.user.permissions`; the server checks each
   * request again.
   */
  permission?: AccessRule;
  /** Shown only in accounting mode (12 › المحاسبة: hidden until it is turned on). */
  accountingMode?: boolean;
  /** Other addresses this page owns: its modes, which have no tab of their own */
  also?: readonly string[];
  /** Active only on this exact address (the home page) */
  end?: boolean;
  /**
   * Shown only to stores with one of these business types (هوية 2: a clothing store does not see
   * expiry dates). A store with no business type set sees everything.
   */
  sectors?: readonly SectorKey[];
  /** Shown only on a plan that has the reps and distribution module */
  reps?: boolean;
}

export type NavGroupKey = 'home' | 'selling' | 'stock' | 'buying' | 'money' | 'admin';

/** The menu's groups, in order; the home page stands alone at the top. */
export const NAV_GROUPS: readonly { key: NavGroupKey; label?: string }[] = [
  { key: 'home' },
  { key: 'selling', label: 'البيع والزبائن' },
  { key: 'stock', label: 'المنتجات والمخزون' },
  { key: 'buying', label: 'الشراء والموردون' },
  { key: 'money', label: 'المال والخدمات' },
  { key: 'admin', label: 'التقارير والإعدادات' },
];

export type NavSectionKey =
  | 'home'
  | 'sales'
  | 'customers'
  | 'online'
  | 'products'
  | 'promotions'
  | 'purchases'
  | 'money'
  | 'services'
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
    { key: 'purchases', group: 'buying', label: 'المشتريات', icon: CartIcon },
    { key: 'inventory', group: 'stock', label: 'المخزون', icon: StockIcon },
    { key: 'money', group: 'money', label: 'المال', icon: ChequeIcon },
    { key: 'services', group: 'money', label: 'الخدمات', icon: WrenchIcon },
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
  {
    section: 'sales',
    to: '/quotations',
    label: 'عروض الأسعار',
    icon: ListIcon,
    permission: ['customers.manage'],
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
    section: 'money',
    to: '/installments',
    label: 'الأقساط',
    icon: CalendarIcon,
    permission: ['installments.view'],
  },
  {
    section: 'money',
    to: '/cheques',
    label: 'الشيكات',
    icon: ChequeIcon,
    permission: ['customers.view'],
    sectors: CHEQUE_SECTORS,
  },
  {
    section: 'services',
    to: '/rentals',
    label: 'التأجير',
    icon: KeyIcon,
    permission: ['customers.view'],
    sectors: RENTAL_SECTORS,
  },
  {
    section: 'services',
    to: '/maintenance',
    label: 'عقود الصيانة',
    icon: ShieldCheckIcon,
    permission: ['catalog.manage'],
    sectors: RENTAL_SECTORS,
  },
  {
    section: 'customers',
    to: '/contract-prices',
    label: 'أسعار العقود',
    icon: OfferIcon,
    permission: ['catalog.manage'],
    sectors: CONTRACT_PRICE_SECTORS,
  },
  {
    section: 'customers',
    to: '/messages',
    label: 'رسائل للزبائن',
    icon: MegaphoneIcon,
    permission: ['customers.manage'],
  },
  {
    section: 'sales',
    to: '/distribution',
    label: 'التوزيع',
    icon: TransferIcon,
    permission: ['routes.manage'],
    reps: true,
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
    label: 'الأسعار',
    // «تغيير بنسبة», «تحديث من ملف» and «السجل» are modes of one page (a switch at its top), one tab here
    also: ['/price-list', '/price-history'],
    icon: PercentIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/labels',
    label: 'طباعة الملصقات',
    tab: 'الملصقات',
    icon: PrintIcon,
    permission: ['catalog.manage'],
  },
  {
    section: 'products',
    to: '/import',
    label: 'استيراد البيانات',
    tab: 'الاستيراد',
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
    to: '/purchase-orders',
    label: 'طلبيات الشراء',
    tab: 'الطلبيات',
    icon: ListIcon,
    permission: ['purchases.manage'],
  },
  {
    section: 'purchases',
    to: '/suppliers',
    label: 'الموردون',
    icon: UserIcon,
    permission: ['purchases.manage'],
  },
  {
    section: 'purchases',
    to: '/supplier-returns',
    label: 'مرتجع إلى المورد',
    tab: 'المرتجعات',
    icon: UndoIcon,
    permission: ['purchases.manage'],
  },
  {
    section: 'money',
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
    to: '/damaged-stock',
    label: 'البضاعة التالفة',
    icon: PackageOpenIcon,
    permission: ['inventory.adjust'],
  },
  {
    section: 'inventory',
    to: '/reports/waste',
    label: 'التالف والهدر',
    icon: DeleteIcon,
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
    to: '/recall',
    label: 'استدعاء دفعة',
    icon: ShieldCheckIcon,
    permission: ['purchases.manage'],
    sectors: EXPIRY_SECTORS,
  },
  {
    section: 'inventory',
    to: '/expiring-soon',
    label: 'بينتهي قريباً',
    icon: CalendarIcon,
    permission: ['purchases.manage'],
    sectors: MEDICINAL_SECTORS,
  },
  {
    section: 'inventory',
    to: '/shortages',
    label: 'النواقص',
    icon: InboxIcon,
    permission: ['purchases.manage'],
    sectors: MEDICINAL_SECTORS,
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
    section: 'services',
    to: '/warranty',
    label: 'طلبات الكفالة',
    icon: ShieldCheckIcon,
    permission: ['catalog.manage'],
    sectors: WARRANTY_SECTORS,
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
    to: '/reports',
    label: 'كل التقارير',
    icon: ReportsIcon,
    end: true,
    permission: ['report.view', 'reports.financial', 'accounting.view', 'devices.view'],
  },
  {
    section: 'money',
    to: '/reports/debt-ageing',
    label: 'أعمار الديون',
    icon: CustomersIcon,
    permission: ['customers.view'],
  },
  {
    section: 'reports',
    to: '/reports/sales',
    label: 'تقرير المبيعات',
    icon: ReportsIcon,
    permission: ['report.view'],
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
    to: '/reports/food-cost',
    label: 'كلفة الوجبات',
    icon: ReportsIcon,
    permission: ['report.view'],
    sectors: MODIFIER_SECTORS,
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
    to: '/branches',
    label: 'الفروع',
    icon: StoreIcon,
    permission: ['settings.manage'],
  },
  {
    section: 'settings',
    to: '/staff',
    label: 'الموظفون',
    icon: UserIcon,
    permission: ['users.manage'],
  },
  {
    section: 'settings',
    to: '/tax-rates',
    label: 'الضرائب',
    icon: PercentIcon,
    permission: ['settings.manage'],
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

type NavMe = Pick<MeResponse, 'user' | 'settings'> & {
  tenant?: { sectors?: readonly SectorKey[] };
  subscription?: { repsEnabled?: boolean };
};

/** The pages this user may open, flat and in menu order. */
export function navFor(me: NavMe): (NavEntry & { section: NavSectionKey })[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (!entry.permission || holdsAny(me, entry.permission)) &&
      (!entry.accountingMode || inAccountingMode(me)) &&
      (!entry.reps || me.subscription?.repsEnabled) &&
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
export function pageOwns(page: Pick<NavEntry, 'to' | 'end' | 'also'>, pathname: string): boolean {
  if (page.end || page.to === '/') return pathname === page.to;
  return [page.to, ...(page.also ?? [])].some((to) => pathname === to || pathname.startsWith(`${to}/`));
}

/** The section the address belongs to, among those this user may open. */
export function sectionAt<S extends Pick<NavSection, 'pages'>>(
  sections: readonly S[],
  pathname: string,
): S | undefined {
  return sections.find((section) => section.pages.some((page) => pageOwns(page, pathname)));
}

/**
 * Pages the menu does not list, or whose rule is not the menu page that owns their address: the
 * address is checked against this first (the longest start wins).
 */
const ACCESS_OF_ADDRESS: readonly { start: string; rule: AccessRule | null }[] = [
  // The phone count needs the right to adjust stock, not the cost view the inventory page asks for
  { start: '/inventory/count', rule: ['inventory.adjust'] },
  // The reps module decides each of its pages itself
  { start: '/distribution', rule: null },
  // The settings page says in its own words that only the owner changes them
  { start: '/settings', rule: null },
  { start: '/reports/distribution', rule: null },
  // The accountant reads the list and the card (stock, price, cost); the server refuses every write
  // Whoever reads the reports or the purchases opens a product from their links; the page is read-only for them
  { start: '/products', rule: ['catalog.manage', 'accounting.view', 'report.view', 'purchases.manage'] },
  // Labels are printed from a purchase invoice too (the storekeeper's way); the page only reads products
  { start: '/labels', rule: ['catalog.manage', 'purchases.manage'] },
  // The import offers each type to whoever holds its own right (products, customers, suppliers)
  { start: '/import', rule: ['catalog.manage', 'customers.manage', 'purchases.manage'] },
  // The owner edits the rates; whoever reads the catalog sees them
  { start: '/tax-rates', rule: ['settings.manage', 'catalog.manage'] },
];

/**
 * Whether this user may open the address (a clean «no permission» page instead of a failed page).
 * Only the menu's own pages are checked, by the permission the menu asks for; an address no menu page
 * owns is left to its page, and the server still checks every request.
 */
export function mayOpen(me: NavMe, pathname: string): boolean {
  const special = ACCESS_OF_ADDRESS.filter(
    (a) => pathname === a.start || pathname.startsWith(`${a.start}/`),
  ).sort((a, b) => b.start.length - a.start.length)[0];
  if (special) return special.rule === null || holdsAny(me, special.rule);
  const owners = NAV_ENTRIES.filter((entry) => pageOwns(entry, pathname));
  if (owners.length === 0) return true;
  return owners.some((entry) => !entry.permission || holdsAny(me, entry.permission));
}
