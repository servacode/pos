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
  'sale.credit': 'البيع بالآجل على حساب زبون',
  'sale.wholesale': 'البيع بسعر الجملة',
  'receipt.create': 'قبض دفعة من زبون',
  'customers.view': 'الزبائن وأرصدتهم وكشوفهم',
  'customers.manage': 'إضافة الزبائن وتعديلهم وحد الدين',
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
  'accounting.post': 'القيود اليدوية وعكسها',
  'expenses.manage': 'تسجيل المصاريف وإلغاؤها',
  'users.manage': 'المستخدمون والصلاحيات',
  'whatsapp.manage': 'ربط واتساب',
  'subscription.manage': 'الاشتراك والدفع للمنصة',
  'devices.view': 'رؤية الأجهزة وما لم يصل منها',
  'devices.manage': 'ربط الأجهزة وإيقافها',
  'settings.manage': 'إعدادات المتجر: الاسم والعملة وسعر الصرف',
  // 03 › المطاعم › وضع النادل: the hall's open orders and the kitchen
  'hall.order': 'أخذ طلبات الطاولات وإرسالها للمطبخ',
  'hall.cancel_approve': 'الموافقة على إلغاء بند بعد إرساله للمطبخ',
  // 03 › الصيدليات › الأدوية المراقبة: only the pharmacist sells them and reads their register
  'pharmacy.controlled': 'بيع الأدوية المراقبة وسجلها',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type SystemRoleKey =
  'owner' | 'manager' | 'cashier' | 'waiter' | 'pharmacist' | 'accountant' | 'storekeeper';

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
  // 04 › الإعدادات: the store's name, currency and dollar rate (migration 0015 adds it to owners)
  'settings.manage',
  // 29 › القيود اليدوية: a hand-written entry reaches any account, so it is the owner's alone
  'accounting.post',
  // 03 › الأدوية المراقبة: the pharmacist's role holds it, and the owner who grants it
  'pharmacy.controlled',
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
    permissions: ['sale.create', 'sale.discount', 'shift.close_own', 'receipt.create'],
    maxDiscountBp: 1000,
  },
  // 03 › وضع النادل: takes orders at the table and sends them to the kitchen; never takes payment
  { key: 'waiter', nameAr: 'نادل', permissions: ['hall.order'], maxDiscountBp: 0 },
  // 03 › الصيدليات: the only role that sells controlled medicines (the owner can grant it to others)
  {
    key: 'pharmacist',
    nameAr: 'صيدلاني',
    permissions: ['sale.create', 'sale.discount', 'shift.close_own', 'receipt.create', 'pharmacy.controlled'],
    maxDiscountBp: 1000,
  },
  // «محاسب»: reads the books and the reports, records expenses; the hand-written entries stay the owner's
  {
    key: 'accountant',
    nameAr: 'محاسب',
    permissions: [
      'customers.view',
      'report.view',
      'reports.financial',
      'accounting.view',
      'expenses.manage',
      'cost.view',
    ],
    maxDiscountBp: 0,
  },
  // «أمين مستودع»: receives purchases and counts the stock; no sales, no money reports
  {
    key: 'storekeeper',
    nameAr: 'أمين مستودع',
    permissions: ['purchases.manage', 'inventory.adjust'],
    maxDiscountBp: 0,
  },
];
