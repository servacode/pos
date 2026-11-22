import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import type { ContractState } from '../rentals';
import { phoneSchema } from './auth';
import { isoDateSchema, nonNegativeMinorSchema, uuidSchema, versionSchema } from './common';

/**
 * Maintenance contracts (03 › الأدوات الطبية: عقود الصيانة): a customer's devices serviced every N
 * months over a period for a price. Each visit is logged with its day, technician and notes. The
 * price is sold at the till as a «عقد صيانة» service line, and the contract remembers the day it was
 * billed. A contract posts nothing.
 *
 *   GET  /v1/maintenance?view=all|upcoming     → { items: MaintenanceContract[] }  (catalog.manage)
 *   POST /v1/maintenance                       maintenanceInput → MaintenanceContract (201)
 *   POST /v1/maintenance/{id}/visits           maintenanceVisitInput → MaintenanceContract
 *   POST /v1/maintenance/{id}/renew            versionInput → MaintenanceContract (a new one from the day after the end)
 *   GET  /v1/device/maintenance                → { items: MaintenanceContract[] } contracts not yet billed
 *   POST /v1/device/maintenance/{id}/billed    versionInput → MaintenanceContract
 */

export const maintenanceInput = z
  .object({
    customerId: uuidSchema.nullable().optional(),
    customerName: z.string().trim().min(1, 'اكتب اسم الزبون').max(80),
    customerPhone: phoneSchema.nullable().optional(),
    /** The serial numbers of the devices; the name is read from the store when it knows the piece */
    devices: z
      .array(
        z.object({
          serial: z.string().trim().min(1, 'اكتب الرقم التسلسلي').max(40),
          item: z.string().trim().max(120).optional(),
        }),
      )
      .min(1, 'أضف جهازاً واحداً على الأقل')
      .max(50),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    visitEveryMonths: z.int().min(1, 'الزيارة كل شهر على الأقل').max(60),
    priceMinor: nonNegativeMinorSchema,
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine((t) => t.endDate >= t.startDate, {
    path: ['endDate'],
    message: 'تاريخ النهاية قبل البداية',
  });
export type MaintenanceInput = z.input<typeof maintenanceInput>;

export const maintenanceVisitInput = z.object({
  /** Today when left out */
  on: isoDateSchema.optional(),
  technician: z.string().trim().min(1, 'اكتب اسم الفني').max(80),
  note: z.string().trim().max(300).nullable().optional(),
  version: versionSchema,
});

export const versionInput = z.object({ version: versionSchema });

export const maintenanceListQuery = z.object({
  view: z.enum(['all', 'upcoming']).default('all'),
});

export interface MaintenanceVisit {
  on: string;
  technician: string;
  note: string | null;
}

export interface MaintenanceContract {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  devices: { serial: string; item: string }[];
  startDate: string;
  endDate: string;
  visitEveryMonths: number;
  currency: CurrencyCode;
  priceMinor: number;
  visits: MaintenanceVisit[];
  /** The next visit's day; null when none is left */
  nextVisit: string | null;
  visitOverdue: boolean;
  state: ContractState;
  billedOn: string | null;
  note: string | null;
  version: number;
  createdAt: string;
}
