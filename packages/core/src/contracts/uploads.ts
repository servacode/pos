import { z } from 'zod';
import type { Permission } from '../permissions';

/**
 * Files a store sends (17 › الإعدادات والملفات: `POST /v1/uploads`, «رفع شعار أو صورة صنف أو إيصال
 * دفع… ويُرجع معرّف الملف»). Phase 1 takes two kinds: the shop logo (wizard step 3) and the receipt
 * image of a subscription payment. Store token (`Authorization: Bearer`), tenant from the token.
 *
 *   POST /v1/uploads        per purpose (UPLOAD_PURPOSES)   uploadInput (JSON, base64) → UploadedFile (201)
 *   GET  /v1/uploads/{id}   owner, manager                  → the bytes, with their content type
 *
 * The body is JSON with the file in base64, so the route needs no multipart parser; its own body
 * limit is UPLOAD_BODY_LIMIT_BYTES (the 1 MB API default stays everywhere else). The web shrinks a
 * photo before sending (longest side 1600 px, JPEG ≈ 0.8), so a phone photo of a receipt fits.
 *
 * The server:
 * - decodes the base64 and refuses more than the purpose's `maxBytes` (413 payload_too_large);
 * - reads the first bytes with sniffImageType() and refuses anything that is not one of the
 *   purpose's types, whatever `contentType` claims (415 unsupported_media_type). No SVG, ever:
 *   it can carry script;
 * - stores the bytes on local disk under UPLOAD_DIR/<tenantId>/<uploadId> (like SNAPSHOT_DIR; no
 *   cloud yet). The path never contains anything the client sent; `fileName` is kept as a label;
 * - records id, tenant, purpose, type, size, sha256, uploader and time. An upload is used once: a
 *   receipt attached to a payment, a logo saved in the store step; one not used within 24 hours
 *   may be deleted. A receipt, once attached, is a financial record and is never deleted (24).
 * - serves GET with its stored content type, `Content-Disposition: inline`,
 *   `X-Content-Type-Options: nosniff` and `Cache-Control: private, max-age=300`. The platform reads
 *   a receipt through its own route (contracts/platform.ts), never this one.
 */

export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadImageType = (typeof UPLOAD_IMAGE_TYPES)[number];

export const UPLOAD_PURPOSES = {
  /** Wizard step 3 and «الإعدادات ← المتجر» */
  store_logo: {
    permission: 'store.setup',
    maxBytes: 512 * 1024,
    types: UPLOAD_IMAGE_TYPES,
  },
  /** The receipt of a subscription payment (contracts/billing.ts) */
  payment_receipt: {
    permission: 'subscription.manage',
    maxBytes: 2 * 1024 * 1024,
    types: UPLOAD_IMAGE_TYPES,
  },
} as const satisfies Record<
  string,
  { permission: Permission; maxBytes: number; types: readonly UploadImageType[] }
>;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;
export const UPLOAD_PURPOSE_KEYS = Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]];

/** The route's own body limit: the largest file in base64 (4/3) plus room for the JSON around it. */
export const UPLOAD_BODY_LIMIT_BYTES = 3 * 1024 * 1024;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Bytes a standard base64 text decodes to, or null when it is not base64 (wrong length, a
 * character outside the alphabet, padding anywhere but the end). Checked character by character.
 */
export function base64DecodedLength(text: string): number | null {
  if (text.length === 0 || text.length % 4 !== 0) return null;
  let padding = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '=') {
      if (i < text.length - 2) return null;
      padding++;
    } else if (padding > 0 || !BASE64_ALPHABET.includes(ch)) {
      return null;
    }
  }
  return (text.length / 4) * 3 - padding;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);

/** The image type of a file from its first bytes (the server trusts this, not the client's label). */
export function sniffImageType(bytes: Uint8Array): UploadImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

/** POST /v1/uploads */
export const uploadInput = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSE_KEYS, 'نوع الملف غير معروف'),
    contentType: z.enum(UPLOAD_IMAGE_TYPES, 'ارفع صورة JPG أو PNG أو WebP'),
    /** The name on the user's device, a label only */
    fileName: z.string().trim().max(120).optional(),
    dataBase64: z.string('اختر صورة'),
  })
  .superRefine((value, ctx) => {
    const size = base64DecodedLength(value.dataBase64);
    if (size === null || size === 0) {
      ctx.addIssue({ code: 'custom', path: ['dataBase64'], message: 'الملف غير صالح. اختر الصورة من جديد' });
      return;
    }
    const limit = UPLOAD_PURPOSES[value.purpose].maxBytes;
    if (size > limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['dataBase64'],
        message: `الصورة أكبر من ${Math.round(limit / 1024)} كيلوبايت. صغّرها وأعد المحاولة`,
      });
    }
  });
export type UploadInput = z.input<typeof uploadInput>;
export type UploadData = z.output<typeof uploadInput>;

/** The answer to POST /v1/uploads. */
export interface UploadedFile {
  id: string;
  purpose: UploadPurpose;
  /** As sniffed by the server */
  contentType: UploadImageType;
  sizeBytes: number;
  /** Hex SHA-256 of the bytes: the platform flags one receipt image sent for two payments */
  sha256: string;
  fileName: string | null;
  /** GET path of the file for the store (`/v1/uploads/{id}`), fetched with the Bearer token */
  url: string;
  createdAt: string;
}
