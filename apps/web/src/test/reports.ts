import type { MeResponse, Permission } from '@serva/core';
import type {
  AccountRow,
  DayReport,
  JournalEntry,
  ShiftReport,
  ShiftSummary,
  SyncEvidence,
  TrialBalance,
} from '../admin/reports/contracts';
import type { AccessKey } from '../admin/reports/access';
import { makeMe } from './fixtures';

/** «Now» in the report tests: Saturday 31 October 2026, 12:00 in Damascus. */
export const NOW = new Date('2026-10-31T09:00:00.000Z');
export const TODAY = '2026-10-31';

export const BRANCHES = [
  { id: 'branch-1', code: '001', name: 'الفرع الرئيسي' },
  { id: 'branch-2', code: '002', name: 'دوار النعيم' },
];

/** The owner with the step-5 keys (report.view, accounting.view) as the server will grant them. */
export const OWNER_KEYS: AccessKey[] = [
  'sale.create',
  'shift.close_any',
  'shift.view_difference',
  'reports.financial',
  'devices.view',
  'devices.manage',
  'report.view',
  'accounting.view',
];

/** A branch manager without the books nor the cash difference. */
export const MANAGER_KEYS: AccessKey[] = [
  'sale.create',
  'shift.close_any',
  'reports.financial',
  'devices.view',
];

export function meWith(
  keys: readonly AccessKey[],
  options: { branchId?: string | null; accountingMode?: boolean } = {},
): MeResponse {
  const base = makeMe();
  const role =
    options.branchId === undefined || options.branchId === null
      ? { key: 'owner', name: 'المالك', branchId: null }
      : { key: 'manager', name: 'مدير الفرع', branchId: options.branchId };
  return {
    ...base,
    user: { ...base.user, roles: [role], permissions: keys as Permission[] },
    settings:
      options.accountingMode === undefined
        ? base.settings
        : ({ ...base.settings, accountingMode: options.accountingMode } as MeResponse['settings']),
    branches: BRANCHES,
  };
}

export function dayReport(overrides: Partial<DayReport> = {}): DayReport {
  return {
    date: TODAY,
    branchId: null,
    invoiceCount: 3,
    grossMinor: 1_300_000,
    discountMinor: 50_000,
    netExTaxMinor: 1_250_000,
    taxMinor: 34_500,
    totalMinor: 1_284_500,
    tipsMinor: 2_000,
    cashRoundingMinor: -500,
    byMethod: [
      { method: 'cash', currency: 'SYP', amountMinor: 914_500, baseAmountMinor: 914_500, count: 3 },
      { method: 'cash', currency: 'USD', amountMinor: 2_000, baseAmountMinor: 260_000, count: 1 },
      { method: 'wallet', currency: 'SYP', amountMinor: 110_000, baseAmountMinor: 110_000, count: 1 },
    ],
    byCashier: [
      { userId: 'u-1', fullName: 'سامر', invoiceCount: 2, totalMinor: 900_000 },
      { userId: 'u-2', fullName: 'لينا', invoiceCount: 1, totalMinor: 384_500 },
    ],
    baseCurrency: 'SYP',
    ...overrides,
  };
}

export function shiftSummary(overrides: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    id: 'shift-1',
    number: 'SFT-001-002-0000231',
    branchId: 'branch-1',
    deviceCode: '002',
    openedBy: { id: 'u-1', fullName: 'سامر' },
    openedAt: '2026-10-31T05:00:00.000Z',
    closedAt: '2026-10-31T13:05:00.000Z',
    status: 'closed',
    salesCount: 138,
    salesTotalMinor: 41_280_000,
    ...overrides,
  };
}

export function shiftReport(overrides: Partial<ShiftReport> = {}): ShiftReport {
  return {
    ...shiftSummary(),
    byCurrency: [
      {
        currency: 'SYP',
        openingMinor: 2_500_000,
        cashSalesMinor: 26_840_000,
        changeGivenMinor: 120_000,
        payInMinor: 1_200_000,
        payOutMinor: 150_000,
        dropsMinor: 15_000_000,
        expectedMinor: 15_270_000,
        countedMinor: 15_120_000,
        differenceMinor: -150_000,
      },
      {
        currency: 'USD',
        openingMinor: 5_000,
        cashSalesMinor: 41_000,
        changeGivenMinor: 0,
        payInMinor: 0,
        payOutMinor: 0,
        dropsMinor: 0,
        expectedMinor: 46_000,
        countedMinor: 46_000,
        differenceMinor: 0,
      },
    ],
    byMethod: [
      { method: 'cash', currency: 'SYP', amountMinor: 26_840_000, count: 120 },
      { method: 'cash', currency: 'USD', amountMinor: 41_000, count: 9 },
      { method: 'card', currency: 'SYP', amountMinor: 4_620_000, count: 9 },
    ],
    movements: [
      {
        id: 'mv-1',
        kind: 'pay_in',
        currency: 'SYP',
        amountMinor: 1_200_000,
        reason: 'فكّة من الخزنة',
        approvedBy: { id: 'u-9', fullName: 'خالد العلي' },
        at: '2026-10-31T07:15:00.000Z',
      },
      {
        id: 'mv-2',
        kind: 'pay_out',
        currency: 'SYP',
        amountMinor: 150_000,
        reason: 'ثلج ومواد تنظيف',
        approvedBy: null,
        at: '2026-10-31T09:40:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** A small chart (10 › دليل الحسابات الافتراضي): two groups and their accounts. */
export const ACCOUNTS: AccountRow[] = [
  {
    id: 'a-1',
    code: '1',
    name: 'الأصول',
    nameEn: 'Assets',
    type: 'asset',
    parentCode: null,
    isGroup: true,
    isSystem: true,
    currency: null,
  },
  {
    id: 'a-1110',
    code: '1110',
    name: 'الصندوق (أدراج الكاشير)',
    nameEn: 'Cash drawers',
    type: 'asset',
    parentCode: '1',
    isGroup: false,
    isSystem: true,
    currency: 'SYP',
  },
  {
    id: 'a-1111',
    code: '1111',
    name: 'الصندوق بالدولار',
    nameEn: 'Cash USD',
    type: 'asset',
    parentCode: '1',
    isGroup: false,
    isSystem: true,
    currency: 'USD',
  },
  {
    id: 'a-4',
    code: '4',
    name: 'الإيرادات',
    nameEn: 'Revenue',
    type: 'revenue',
    parentCode: null,
    isGroup: true,
    isSystem: true,
    currency: null,
  },
  {
    id: 'a-4100',
    code: '4100',
    name: 'المبيعات',
    nameEn: 'Sales',
    type: 'revenue',
    parentCode: '4',
    isGroup: false,
    isSystem: true,
    currency: null,
  },
];

export function journalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'je-1',
    number: 'JRN-2026-0000001',
    date: TODAY,
    source: { type: 'sale', id: 'doc-1', number: 'INV-001-002-0000001' },
    memo: 'فاتورة بيع',
    lines: [
      {
        accountCode: '1110',
        accountName: 'الصندوق (أدراج الكاشير)',
        debitMinor: 3_000,
        creditMinor: 0,
        currency: 'SYP',
        amountMinor: 3_000,
        rate: null,
      },
      {
        accountCode: '1111',
        accountName: 'الصندوق بالدولار',
        debitMinor: 117_000,
        creditMinor: 0,
        currency: 'USD',
        amountMinor: 900,
        rate: { unit: 'USD', quote: 'SYP', rate: '130' },
      },
      {
        accountCode: '4100',
        accountName: 'المبيعات',
        debitMinor: 0,
        creditMinor: 120_000,
        currency: 'SYP',
        amountMinor: 120_000,
        rate: null,
      },
    ],
    totalMinor: 120_000,
    ...overrides,
  };
}

export function trialBalance(overrides: Partial<TrialBalance> = {}): TrialBalance {
  return {
    from: '2026-10-01',
    to: TODAY,
    rows: [
      {
        accountCode: '1110',
        accountName: 'الصندوق (أدراج الكاشير)',
        type: 'asset',
        openingMinor: 0,
        debitMinor: 120_000,
        creditMinor: 0,
        closingMinor: 120_000,
      },
      {
        accountCode: '4100',
        accountName: 'المبيعات',
        type: 'revenue',
        openingMinor: 0,
        debitMinor: 0,
        creditMinor: 120_000,
        closingMinor: 120_000,
      },
    ],
    totals: { debitMinor: 120_000, creditMinor: 120_000 },
    balanced: true,
    ...overrides,
  };
}

export function evidence(overrides: Partial<SyncEvidence> = {}): SyncEvidence {
  return {
    deviceId: 'dev-1',
    deviceName: 'كاشير 1',
    sent: 5,
    accepted: 5,
    duplicate: 5,
    rejected: 0,
    quarantined: 0,
    lastAnnouncedNumber: { INV: 'INV-001-001-0000005', SFT: 'SFT-001-001-0000001' },
    lastReceivedNumber: { INV: 'INV-001-001-0000005', SFT: 'SFT-001-001-0000001' },
    ...overrides,
  };
}
