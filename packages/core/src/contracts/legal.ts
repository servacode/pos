import { z } from 'zod';
import { normalizePhone } from '../phone';

/**
 * The company and contact details the public terms and privacy pages (and every place that shows
 * the platform's contact details) read. The platform team edits them; nobody else does.
 *
 *   GET /v1/legal            PublicLegal (no sign-in, short cache)
 *   GET /v1/platform/legal   LegalDetails
 *   PUT /v1/platform/legal   legalInput → 204 (super admin; audited as legal.save)
 *
 * An empty string is a blank: the page marks it, except the commercial register and the phone,
 * which are optional and read naturally without them.
 */

const text = (max: number) => z.string().trim().max(max).default('');

/** Empty, or a phone number kept in its international form (+9639…). */
const phone = z
  .string()
  .trim()
  .max(30)
  .default('')
  .transform((value, ctx) => {
    if (value === '') return '';
    const normal = normalizePhone(value);
    if (normal === null) ctx.addIssue({ code: 'custom', message: 'رقم هاتف غير صالح' });
    return normal ?? value;
  });

const isoDay = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)), {
    message: 'تاريخ غير صالح',
  });

export const legalInput = z.object({
  companyName: text(120),
  ownerName: text(120),
  /** Optional: a text that names it reads naturally when it is empty */
  commercialRegister: text(60),
  address: text(240),
  email: z
    .string()
    .trim()
    .max(120)
    .default('')
    .refine((value) => value === '' || z.email().safeParse(value).success, {
      message: 'بريد إلكتروني غير صالح',
    }),
  supportWhatsapp: phone,
  /** Optional: only when it differs from the support WhatsApp */
  phone,
  governingCity: text(60),
  financialRetention: text(60),
  paymentTolerance: text(30),
  hostingProvider: text(120),
  hostingCountry: text(60),
  backupProvider: text(120),
  smsProvider: text(120),
  aiProvider: text(160),
  reviewedByLawyer: z.boolean().default(false),
  /** The day the texts were last changed (YYYY-MM-DD) */
  updatedAt: isoDay,
});
export type LegalDetails = z.output<typeof legalInput>;

/** The keys the pages read (apps/web/src/legal), in the order the panel lists them */
export const LEGAL_TEXT_KEYS = [
  'companyName',
  'ownerName',
  'commercialRegister',
  'address',
  'email',
  'supportWhatsapp',
  'phone',
  'governingCity',
  'financialRetention',
  'paymentTolerance',
  'hostingProvider',
  'hostingCountry',
  'backupProvider',
  'smsProvider',
  'aiProvider',
] as const satisfies readonly (keyof LegalDetails)[];

/** Blanks that are fine to leave empty: they never count against «ready» */
export const LEGAL_OPTIONAL_KEYS: readonly (typeof LEGAL_TEXT_KEYS)[number][] = [
  'commercialRegister',
  'phone',
];

/** What the public GET returns: the details and the version of the texts the app records at sign-up */
export type PublicLegal = LegalDetails & { version: string };
