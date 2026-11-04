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
  BookIcon,
  MegaphoneIcon,
  OfferIcon,
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
import { CHEQUE_SECTORS, EXPIRY_SECTORS, SERIAL_SECTORS, storeSells } from '../lib/sectors';

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

export type NavGroupKey = 'home' | 'selling' | 'stock' | 'reports' | 'settings';

/** The menu's groups, in order; the home page stands alone at the top. */
export const NAV_GROUPS: readonly { key: NavGroupKey; label?: string }[] = [
  { key: 'home' },
  { key: 'selling', label: 'البيع والزبائن' },
  { key: 'stock', label: 'البضاعة' },
  { key: 'reports', label: 'التقارير والحسابات' },
  { key: 'settings', label: 'الإعدادات' },
];

/**
 * The admin menu (12 › خريطة الشاشات), in its order. It lists only screens that exist (tab 12: no
 * button the user cannot use), each with its icon from @serva/ui and its glossary name.
 */
export const NAV_ENTRIES: readonly (NavEntry & { group: NavGroupKey })[] = [
  { group: 'home', to: '/', label: 'الرئيسية', icon: HomeIcon, end: true },

  {
    group: 'selling',
    to: '/sales/today',
    label: 'مبيعات اليوم',
    icon: SalesIcon,
    permission: DAY_REPORT_ACCESS,
  },
  { group: 'selling', to: '/shifts', label: 'الورديات', icon: ClockIcon, permission: SHIFTS_ACCESS },
  {
    group: 'selling',
    to: '/customers',
    label: 'الزبائن',
    icon: CustomersIcon,
    permission: ['customers.view'],
  },
  {
    group: 'selling',
    to: '/messages',
    label: 'رسائل للزبائن',
    icon: MegaphoneIcon,
    permission: ['customers.manage'],
  },
  {
    group: 'selling',
    to: '/online-store',
    label: 'المتجر الإلكتروني',
    icon: StoreIcon,
    permission: ['settings.manage', 'customers.view'],
  },
  {
    group: 'selling',
    to: '/cheques',
    label: 'الشيكات',
    icon: ChequeIcon,
    permission: ['customers.view'],
    sectors: CHEQUE_SECTORS,
  },

  { group: 'stock', to: '/products', label: 'المنتجات', icon: ProductsIcon, permission: ['catalog.manage'] },
  {
    group: 'stock',
    to: '/categories',
    label: 'التصنيفات',
    icon: CategoriesIcon,
    permission: ['catalog.manage'],
  },
  { group: 'stock', to: '/promotions', label: 'العروض', icon: OfferIcon, permission: ['catalog.manage'] },
  {
    group: 'stock',
    to: '/prices',
    label: 'تغيير الأسعار',
    icon: PercentIcon,
    permission: ['catalog.manage'],
  },
  { group: 'stock', to: '/labels', label: 'طباعة الملصقات', icon: PrintIcon, permission: ['catalog.manage'] },
  { group: 'stock', to: '/purchases', label: 'المشتريات', icon: CartIcon, permission: ['purchases.manage'] },
  {
    group: 'stock',
    to: '/supplier-returns',
    label: 'مرتجع إلى المورد',
    icon: UndoIcon,
    permission: ['purchases.manage'],
  },
  {
    group: 'stock',
    to: '/transfers',
    label: 'التحويل بين الفروع',
    icon: TransferIcon,
    permission: ['inventory.adjust'],
  },
  {
    group: 'stock',
    to: '/expiry',
    label: 'الصلاحية',
    icon: CalendarIcon,
    permission: ['purchases.manage'],
    sectors: EXPIRY_SECTORS,
  },
  {
    group: 'stock',
    to: '/serials',
    label: 'الأرقام التسلسلية',
    icon: SerialIcon,
    permission: ['catalog.manage'],
    sectors: SERIAL_SECTORS,
  },

  {
    group: 'reports',
    to: '/reports/merchandise',
    label: 'حركة الأصناف',
    icon: ReportsIcon,
    permission: ['report.view'],
  },
  {
    group: 'reports',
    to: '/inventory',
    label: 'المخزون والأرباح',
    icon: StockIcon,
    permission: ['cost.view'],
  },
  {
    group: 'reports',
    to: '/accounting',
    label: 'المحاسبة',
    icon: BookIcon,
    permission: ACCOUNTING_ACCESS,
    accountingMode: true,
  },
  {
    group: 'reports',
    to: '/evidence',
    label: 'شاشة الدليل',
    icon: ShieldCheckIcon,
    permission: EVIDENCE_ACCESS,
  },

  { group: 'settings', to: '/devices', label: 'الأجهزة', icon: DeviceIcon, permission: ['devices.view'] },
  {
    group: 'settings',
    to: '/settings',
    label: 'إعدادات المتجر',
    icon: SettingsIcon,
    permission: ['settings.manage'],
  },
  {
    group: 'settings',
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

/** The entries this user may open, flat and in menu order. */
export function navFor(me: NavMe): (NavEntry & { group: NavGroupKey })[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (!entry.permission || holdsAny(me, entry.permission)) &&
      (!entry.accountingMode || inAccountingMode(me)) &&
      fitsSectors(entry, me.tenant?.sectors),
  );
}

/** The same entries in their groups; a group with nothing the user may open is left out. */
export function navGroupsFor(me: NavMe): { key: NavGroupKey; label?: string; entries: NavEntry[] }[] {
  const entries = navFor(me);
  return NAV_GROUPS.map((group) => ({
    ...group,
    entries: entries.filter((entry) => entry.group === group.key),
  })).filter((group) => group.entries.length > 0);
}
