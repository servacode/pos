import type { LocalStore } from '../../offline/local';

/**
 * Offline sign-in (docs/contracts/step4.md, Q1; 16 › تخمين رمز PIN). The server never sends a PIN
 * hash to a device. After a successful online sign-in the device keeps
 * HMAC(deviceHmacKey, userId:pinVersion:pin), where deviceHmacKey is a WebCrypto key that cannot be
 * extracted: what is read from a stolen device's files cannot be checked anywhere else. A new
 * pinVersion makes the device forget the stored value.
 */

const KEY = 'staffKey';
const verifierKey = (userId: string) => `staffVerifier:${userId}`;
const lockoutKey = (userId: string) => `staffLockout:${userId}`;

interface StoredVerifier {
  pinVersion: number;
  mac: ArrayBuffer;
  /** What the last online sign-in answered, used to name the person offline */
  profile: StaffProfileSnapshot;
}

/** The part of an online sign-in answer kept for offline sign-in. */
export interface StaffProfileSnapshot {
  fullName: string;
  permissions: string[];
  roles: { key: string; name: string; branchId: string | null }[];
  pinLength: 4 | 6;
}

const encoder = new TextEncoder();
const message = (userId: string, pinVersion: number, pin: string) =>
  encoder.encode(`${userId}:${pinVersion}:${pin}`);

/** The device's HMAC key, made once and kept in the device database (not extractable). */
export async function deviceHmacKey(local: LocalStore): Promise<CryptoKey> {
  const existing = await local.get<CryptoKey>(KEY);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  await local.set(KEY, key);
  return key;
}

export async function rememberPin(
  local: LocalStore,
  userId: string,
  pinVersion: number,
  pin: string,
  profile: StaffProfileSnapshot,
): Promise<void> {
  const key = await deviceHmacKey(local);
  const mac = await crypto.subtle.sign('HMAC', key, message(userId, pinVersion, pin));
  const stored: StoredVerifier = { pinVersion, mac, profile };
  await local.set(verifierKey(userId), stored);
}

/** The kept verifier for this user, if it belongs to their current PIN version. */
export async function knownProfile(
  local: LocalStore,
  userId: string,
  pinVersion: number,
): Promise<StaffProfileSnapshot | null> {
  const stored = await local.get<StoredVerifier>(verifierKey(userId));
  return stored && stored.pinVersion === pinVersion ? stored.profile : null;
}

/**
 * Checks a PIN against the kept verifier. crypto.subtle.verify compares in constant time. Answers
 * `unknown` when this user never signed in online here with their current PIN version.
 */
export async function checkPin(
  local: LocalStore,
  userId: string,
  pinVersion: number,
  pin: string,
): Promise<'ok' | 'wrong' | 'unknown'> {
  const stored = await local.get<StoredVerifier>(verifierKey(userId));
  if (!stored || stored.pinVersion !== pinVersion) return 'unknown';
  const key = await deviceHmacKey(local);
  const ok = await crypto.subtle.verify('HMAC', key, stored.mac, message(userId, pinVersion, pin));
  return ok ? 'ok' : 'wrong';
}

// ── Local lockout (16: after 5 wrong codes, 1 minute, doubling on each failure after that) ──────

export const FREE_ATTEMPTS = 5;
export const FIRST_LOCK_MS = 60_000;

export interface Lockout {
  failures: number;
  /** Epoch ms; 0 when not locked */
  lockedUntil: number;
}

/** How long a lock lasts after this many failures in a row (0 while attempts remain). */
export function lockDuration(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return FIRST_LOCK_MS * 2 ** Math.min(failures - FREE_ATTEMPTS, 10);
}

export async function readLockout(local: LocalStore, userId: string): Promise<Lockout> {
  return (await local.get<Lockout>(lockoutKey(userId))) ?? { failures: 0, lockedUntil: 0 };
}

export async function recordFailure(local: LocalStore, userId: string, now: number): Promise<Lockout> {
  const current = await readLockout(local, userId);
  const failures = current.failures + 1;
  const duration = lockDuration(failures);
  const next = { failures, lockedUntil: duration > 0 ? now + duration : 0 };
  await local.set(lockoutKey(userId), next);
  return next;
}

/** A server lockout (429 with retryAfter) is mirrored locally so the countdown survives a reload. */
export async function recordServerLock(local: LocalStore, userId: string, until: number): Promise<Lockout> {
  const current = await readLockout(local, userId);
  const next = { failures: Math.max(current.failures, FREE_ATTEMPTS), lockedUntil: until };
  await local.set(lockoutKey(userId), next);
  return next;
}

export async function clearLockout(local: LocalStore, userId: string): Promise<void> {
  await local.remove(lockoutKey(userId));
}
