/**
 * Permission keys checked by the server (the UI only hides buttons).
 * Matches the roles & permissions table in the spec (الدورة التشغيلية → الأدوار والصلاحيات).
 */
export const PERMISSIONS = {
  'sale.create': 'البيع وطباعة الإيصال',
  'sale.discount': 'خصم ضمن الحد المسموح',
  'sale.discount_over_limit': 'خصم فوق الحد',
  'sale.refund': 'المرتجعات',
  'sale.void': 'إلغاء فاتورة في نفس الوردية',
  'drawer.open_no_sale': 'فتح الدرج دون بيع',
  'cash.move': 'إيداع أو سحب نقد من الدرج',
  'shift.close_own': 'إغلاق ورديته',
  'shift.close_any': 'إغلاق أي وردية',
  'shift.view_difference': 'رؤية فرق الصندوق',
  'catalog.manage': 'المنتجات والأسعار',
  'cost.view': 'التكلفة وأسعار الشراء',
  'purchases.manage': 'المشتريات والموردون',
  'inventory.adjust': 'اعتماد الجرد والتسويات',
  'reports.financial': 'التقارير المالية والأرباح',
  // Phase 1, step 3: «مبيعات اليوم» and the shift reports; the journal, trial balance and chart.
  'report.view': 'مبيعات اليوم وتقارير الورديات',
  'accounting.view': 'الدفاتر والقيود وميزان المراجعة',
  'users.manage': 'المستخدمون والصلاحيات',
  'whatsapp.manage': 'ربط واتساب',
  'subscription.manage': 'الاشتراك والدفع للمنصة',
  'devices.view': 'رؤية الأجهزة وما لم يصل منها',
  'devices.manage': 'ربط الأجهزة وإيقافها',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type SystemRoleKey = 'owner' | 'manager' | 'cashier';

export interface RoleTemplate {
  key: SystemRoleKey;
  nameAr: string;
  permissions: readonly Permission[];
  /** Maximum discount without manager approval, in basis points (1000 = 10%). */
  maxDiscountBp: number;
}

const OWNER_ONLY: readonly Permission[] = [
  'users.manage',
  'whatsapp.manage',
  'subscription.manage',
  // 09 › devices.manage: linking and revoking devices is the owner's alone
  'devices.manage',
];

/** Roles created automatically for every new store. The owner can edit them or add more. */
export const DEFAULT_ROLES: readonly RoleTemplate[] = [
  { key: 'owner', nameAr: 'المالك', permissions: ALL_PERMISSIONS, maxDiscountBp: 10000 },
  {
    key: 'manager',
    nameAr: 'مدير الفرع',
    permissions: ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)),
    maxDiscountBp: 10000,
  },
  {
    key: 'cashier',
    nameAr: 'كاشير',
    permissions: ['sale.create', 'sale.discount', 'shift.close_own'],
    maxDiscountBp: 1000,
  },
];
