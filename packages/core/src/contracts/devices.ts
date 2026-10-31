import { z } from 'zod';
import { toLatinDigits } from '../text';

/**
 * Linking a device to a store (12 §ربط الجهاز, 15 §التثبيت خطوة بخطوة, 16 §زرع جهاز, 17 §الأجهزة).
 *
 * Three ways in:
 * - a QR code from the admin panel or the owner's phone (128 random bits);
 * - an 8-character code typed with the store code;
 * - the owner signs in on the device.
 *
 * QR and code links wait for the owner's «اسمح». An owner signing in on the device is active at once.
 * Codes last 10 minutes and die after 5 wrong tries.
 */

export const DEVICE_KINDS = [
  'cashier',
  'android_pos',
  'rep_phone',
  'price_checker',
  'kitchen_screen',
  'waiter',
  'call_screen',
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const DEVICE_PLATFORMS = ['browser', 'windows', 'android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export type DeviceStatus = 'pending_approval' | 'active' | 'revoked' | 'rejected';

export const PAIRING_TTL_SECONDS = 600;
export const PAIRING_MAX_ATTEMPTS = 5;

/** No 0/O, 1/I/L: the code is read off a screen and typed by hand. */
export const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** spq_ + 22 base64url chars = 128 random bits. */
export const PAIRING_QR_TOKEN_PATTERN = /^spq_[A-Za-z0-9_-]{22}$/;

const cleanCode = (value: string) => toLatinDigits(value).toUpperCase().replace(/[\s-]/g, '');

/** 8 characters from PAIRING_CODE_ALPHABET; spaces, dashes, Arabic digits and lower case are accepted. */
export const manualPairingCodeSchema = z
  .string('رمز الربط مطلوب')
  .transform(cleanCode)
  .refine(
    (v) => v.length === 8 && [...v].every((c) => PAIRING_CODE_ALPHABET.includes(c)),
    'رمز الربط 8 حروف وأرقام كما يظهر في لوحة الإدارة',
  );

/** The store's public 6-digit code, shown next to the pairing code (tenants.store_code). */
export const storeCodeSchema = z
  .string('رمز المتجر مطلوب')
  .transform(cleanCode)
  .refine((v) => /^[0-9]{6}$/.test(v), 'رمز المتجر 6 أرقام');

/**
 * Takes a scanned QR (the full link or the bare token) and returns the token, or null.
 * The QR holds `<web origin>/link#spq_…`, so a phone camera opens the link page directly.
 */
export function parsePairingQr(scanned: string): string | null {
  const text = scanned.trim();
  const token = text.includes('#') ? text.slice(text.lastIndexOf('#') + 1) : text;
  return PAIRING_QR_TOKEN_PATTERN.test(token) ? token : null;
}

export const deviceNameSchema = z
  .string('اسم الجهاز مطلوب')
  .trim()
  .min(1, 'اسم الجهاز مطلوب')
  .max(40, 'اسم الجهاز طويل جداً');

/** ECDSA P-256 public key exported as SPKI, base64url. The private key never leaves the device. */
export const devicePublicKeySchema = z
  .string('مفتاح الجهاز مطلوب')
  .regex(/^[A-Za-z0-9_-]{80,200}$/, 'مفتاح الجهاز غير صالح');

// ─── Owner: pairing codes ─────────────────────────────────────────────────────

/** POST /v1/devices/pairing-codes (owner) */
export const createPairingCodeInput = z.object({ branchId: z.uuid('اختر الفرع') });
export type CreatePairingCodeInput = z.input<typeof createPairingCodeInput>;

export interface PairingCodeResponse {
  pairingId: string;
  branchId: string;
  branchName: string;
  /** What the QR encodes: `<web origin>/link#<qrToken>` */
  qrPayload: string;
  qrToken: string;
  /** 8 characters, shown as two groups of 4 */
  manualCode: string;
  storeCode: string;
  expiresAt: string;
  maxAttempts: number;
}

// ─── Device: activation ───────────────────────────────────────────────────────

const deviceFields = {
  name: deviceNameSchema,
  kind: z.enum(DEVICE_KINDS),
  platform: z.enum(DEVICE_PLATFORMS),
  publicKey: devicePublicKeySchema,
  appVersion: z.string().trim().min(1).max(32),
};

/**
 * POST /v1/devices/activate. No auth for `qr` and `code` (the code is the proof).
 * `owner` needs the owner's access token (Bearer), and the device is active at once.
 */
export const activateDeviceInput = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('qr'),
    qrToken: z.string().regex(PAIRING_QR_TOKEN_PATTERN, 'رمز QR غير صالح'),
    ...deviceFields,
  }),
  z.object({
    method: z.literal('code'),
    storeCode: storeCodeSchema,
    manualCode: manualPairingCodeSchema,
    ...deviceFields,
  }),
  z.object({ method: z.literal('owner'), branchId: z.uuid('اختر الفرع'), ...deviceFields }),
]);
export type ActivateDeviceInput = z.input<typeof activateDeviceInput>;
export type ActivateDeviceData = z.output<typeof activateDeviceInput>;

/** Everything the device keeps once it is active. The token is shown exactly once. */
export interface ActivatedDevice {
  deviceId: string;
  /** sdt_… ; the device sends `Authorization: Device <token>` */
  token: string;
  /** 3 digits, part of every document number (INV-<branch>-<device>-<seq>) */
  deviceCode: string;
  tenantId: string;
  storeName: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  deviceName: string;
  serverEpoch: number;
}

export interface PendingActivation {
  status: 'pending_approval';
  activationId: string;
  /** sda_… ; the device polls with `Authorization: Activation <secret>` */
  activationSecret: string;
  storeName: string;
  branchName: string;
  deviceName: string;
  expiresAt: string;
  pollAfterSeconds: number;
}

export type ActivateDeviceResponse = PendingActivation | { status: 'active'; device: ActivatedDevice };

/**
 * GET /v1/devices/activations/{activationId} with `Authorization: Activation <secret>`.
 * `active` is answered once; asking again after that is 410.
 */
export type ActivationStatusResponse =
  | { status: 'pending_approval'; expiresAt: string; pollAfterSeconds: number }
  | { status: 'rejected' }
  | { status: 'expired' }
  | { status: 'active'; device: ActivatedDevice };

// ─── Owner and manager: the device list ───────────────────────────────────────

export interface DeviceSummary {
  id: string;
  name: string;
  kind: DeviceKind;
  platform: DevicePlatform;
  status: DeviceStatus;
  /** null until approved */
  code: string | null;
  branchId: string;
  branchName: string;
  /** From the last heartbeat; null when never seen */
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  appVersion: string | null;
  clockOffsetMs: number | null;
  /** Documents the device announced that have not reached the server; null before the first heartbeat */
  missingDocuments: number | null;
  /** Documents waiting on the device, as it last reported */
  unsentCount: number | null;
  createdAt: string;
  revokedAt: string | null;
  version: number;
}

/** GET /v1/devices (owner, manager) */
export interface DeviceListResponse {
  devices: DeviceSummary[];
}

/** PATCH /v1/devices/{id} (owner) */
export const renameDeviceInput = z.object({ name: deviceNameSchema, version: z.int().nonnegative() });
export type RenameDeviceInput = z.input<typeof renameDeviceInput>;

// POST /v1/devices/{id}/approve · /reject · /revoke (owner): no body, answer DeviceSummary.
