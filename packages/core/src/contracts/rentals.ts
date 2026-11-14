import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { RENTAL_RATE_UNITS, type RentalRateUnit } from '../rentals';
import { phoneSchema } from './auth';
import {
  isoDateSchema,
  nonNegativeMinorSchema,
  positiveMinorSchema,
  uuidSchema,
  versionSchema,
} from './common';

/**
 * Device rentals (03 › الأدوات الطبية: التأجير): a serial-tracked piece of a «قابل للتأجير» product
 * lent to a customer for a rate per day, week or month. While it is out the serial's status is
 * «rented» and a sale of it is flagged. The return closes the rental and computes the charge, which
 * the till sells as a «إيجار» service line less the deposit (taken as a gift voucher). A rental
 * itself posts nothing.
 *
 *   GET  /v1/device/rentals?status=out|all     → { items: Rental[] }       (Authorization: Device)
 *   GET  /v1/device/rentals/units?q=           → { items: RentableUnit[] } pieces free to rent
 *   POST /v1/device/rentals                    rentalInput → Rental (201)
 *   POST /v1/device/rentals/{id}/return        rentalReturnInput → Rental
 *   GET  /v1/rentals?status=out|all            → { items: Rental[] }       (customers.view)
 */

export const rentalInput = z
  .object({
    serial: z.string().trim().min(1, 'اكتب الرقم التسلسلي').max(40),
    customerId: uuidSchema.nullable().optional(),
    customerName: z.string().trim().min(1, 'اكتب اسم المستأجر').max(80),
    phone: phoneSchema,
    /** Today when left out */
    startDate: isoDateSchema.optional(),
    expectedReturn: isoDateSchema,
    rateUnit: z.enum(RENTAL_RATE_UNITS),
    rateMinor: positiveMinorSchema,
    depositMinor: nonNegativeMinorSchema.default(0),
    /** The gift voucher the deposit was taken on */
    depositVoucher: z.string().trim().min(1).max(40).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine((t) => t.startDate === undefined || t.expectedReturn >= t.startDate, {
    path: ['expectedReturn'],
    message: 'يوم الإرجاع قبل يوم البداية',
  })
  .refine((t) => t.depositMinor === 0 || Boolean(t.depositVoucher), {
    path: ['depositVoucher'],
    message: 'العربون يحتاج قسيمته',
  });
export type RentalInput = z.input<typeof rentalInput>;

export const rentalReturnInput = z.object({ version: versionSchema });

export const rentalListQuery = z.object({
  status: z.enum(['out', 'all']).default('out'),
});

export const rentableUnitQuery = z.object({
  q: z.string().trim().max(40).optional(),
});

export interface Rental {
  id: string;
  number: string;
  status: 'out' | 'returned';
  /** Out and past the day it was due */
  overdue: boolean;
  serial: string;
  item: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  startDate: string;
  expectedReturn: string;
  rateUnit: RentalRateUnit;
  rateMinor: number;
  currency: CurrencyCode;
  depositMinor: number;
  depositVoucher: string | null;
  note: string | null;
  returnedOn: string | null;
  /** What it cost: fixed at the return; while out, what it would cost if returned today */
  chargeMinor: number;
  version: number;
  createdAt: string;
}

/** A piece of a rentable product that is in the store and can go out */
export interface RentableUnit {
  serial: string;
  variantId: string;
  item: string;
}
