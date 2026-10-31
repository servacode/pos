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
  // Phase 1, step 6: the setup wizard, the shop's details, its sectors and feature switches (04, 17).
  'store.setup': 'معالج البداية ومعلومات المحل والأنشطة والميزات',
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
  // 17 › معالج البداية and «الإعدادات ← المتجر»: the owner's
  'store.setup',
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

// ─── Platform panel (07 › المستويات الثلاثة; 13; 17 › لوحة المنصة) ──────────────────────────────
//
// Platform users are a separate world: other accounts, another sign-in, other keys. A platform
// token never carries a store permission and a store token never carries one of these.

export const PLATFORM_ROLES = {
  super_admin: 'مدير عام',
  support: 'دعم فني',
  accountant: 'محاسب المنصة',
} as const;

export type PlatformRole = keyof typeof PLATFORM_ROLES;
export const PLATFORM_ROLE_KEYS = Object.keys(PLATFORM_ROLES) as [PlatformRole, ...PlatformRole[]];

/** Keys checked by the platform routes; who holds each is PLATFORM_ROLE_PERMISSIONS (17 «من»; 12). */
export const PLATFORM_PERMISSIONS = {
  'platform.stores.view': 'المتاجر وملف كل متجر',
  'platform.stores.notes': 'الملاحظات الداخلية على المتجر',
  'platform.stores.extend': 'تمديد التجربة أو الفترة أو المهلة',
  'platform.stores.suspend': 'إيقاف متجر وإعادته',
  'platform.payments.view': 'الدفعات وفواتير الاشتراك',
  'platform.payments.decide': 'تأكيد الدفعات ورفضها',
  'platform.payments.unconfirm': 'إلغاء تأكيد دفعة',
  'platform.plans.manage': 'الباقات وأسعارها وسعر التحويل',
  'platform.payment_accounts.manage': 'حسابات استلام الدفع ورموز QR',
  'platform.agents.view': 'الوكلاء',
  'platform.agents.manage': 'إضافة الوكلاء وتعديلهم',
  'platform.approvals.decide': 'الموافقة على العمليات الحساسة',
  'platform.team.view': 'فريق المنصة',
  'platform.audit.view': 'سجل عمليات اللوحة',
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
export const ALL_PLATFORM_PERMISSIONS = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];

/**
 * The permission matrix (13 › صلاحيات الفريق: «الدعم يعدّل مركز المساعدة لا الأسعار، والمحاسب
 * يؤكد الدفعات لا الميزات»; 07 › فصل المهام: the accountant confirms, only the general manager
 * reverses a confirmation). Fixed in code: changing team roles is itself a sensitive operation.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<Record<PlatformRole, readonly PlatformPermission[]>> = {
  super_admin: ALL_PLATFORM_PERMISSIONS,
  support: ['platform.stores.view', 'platform.stores.notes'],
  accountant: ['platform.payments.view', 'platform.payments.decide', 'platform.agents.view'],
};

export function platformCan(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
