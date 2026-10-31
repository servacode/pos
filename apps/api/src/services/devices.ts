import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_SECONDS,
  type ActivateDeviceData,
  type ActivatedDevice,
  type ActivationStatusResponse,
  type CreatePairingCodeInput,
  type DeviceKind,
  type DevicePlatform,
  type DeviceStatus,
  type DeviceSummary,
  type PairingCodeResponse,
  type PendingActivation,
  type RenameDeviceInput,
} from '@serva/core';
import {
  branches,
  devicePairings,
  devices,
  tenants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { hashDeviceToken } from '../auth/device-guard';
import { inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { readServerState } from './sync-state';

/**
 * Linking devices to a store (17 › الأجهزة; 16 › زرع جهاز في المتجر). A QR or a typed code links a
 * device that then waits for the owner's «اسمح»; the owner signing in on the device links it at
 * once. Every secret (QR token, typed code, poll secret, device token) is stored only as a hash.
 */

/** How long a linked device waits for the owner's answer (product decision, see the report). */
export const ACTIVATION_TTL_MS = 30 * 60_000;
/** How often a waiting device asks again */
export const POLL_AFTER_SECONDS = 5;
/** sda_ + 43 base64url chars = 256 random bits */
export const ACTIVATION_SECRET_PATTERN = /^sda_[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const newQrToken = () => `spq_${randomBytes(16).toString('base64url')}`;
export const newDeviceToken = () => `sdt_${randomBytes(32).toString('base64url')}`;
export const newActivationSecret = () => `sda_${randomBytes(32).toString('base64url')}`;
export const hashActivationSecret = sha256;
export const hashQrToken = sha256;

/** 8 characters drawn uniformly from the alphabet (randomInt has no modulo bias). */
export function newManualCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  return code;
}

/** The typed code is short, so its hash is bound to the store. */
export const hashManualCode = (tenantId: string, code: string) => sha256(`${tenantId}:${code}`);

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

// ─── Errors ───────────────────────────────────────────────────────────────────

const wrongCode = () =>
  new AppError(400, 'otp_invalid', 'رمز الربط غير صحيح. تأكد منه أو اطلب رمزاً جديداً من لوحة الإدارة.', {
    manualCode: 'رمز الربط غير صحيح',
  });
const expiredCode = () =>
  new AppError(400, 'otp_invalid', 'انتهت صلاحية رمز الربط. اطلب رمزاً جديداً من لوحة الإدارة.');
const lockedCode = () =>
  new AppError(429, 'locked', 'محاولات خاطئة كثيرة على هذا الرمز. اطلب رمزاً جديداً من لوحة الإدارة.');
const deviceNotFound = () => new AppError(404, 'not_found', 'هذا الجهاز غير موجود.');
const branchNotFound = () =>
  new AppError(404, 'not_found', 'هذا الفرع غير موجود.', { branchId: 'هذا الفرع غير موجود' });
const tokenGone = () => new AppError(410, 'not_found', 'أُعطي هذا الجهاز رمزه من قبل. اربطه من جديد إن لزم.');
const wrongState = (message: string) => new AppError(409, 'conflict', message);

// ─── Shared pieces ────────────────────────────────────────────────────────────

/**
 * The next 3-digit code of the branch (15 › الترقيم دون اتصال): one more than the highest ever
 * given there, so a code is never reused, even after a revoke. 000 is the server's.
 */
async function reserveCode(tx: Transaction, branchId: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`devices:code:${branchId}`}, 0))`);
  const [row] = await tx
    .select({ max: sql<string | null>`max(${devices.code})` })
    .from(devices)
    .where(eq(devices.branchId, branchId));
  const next = Number(row?.max ?? '000') + 1;
  if (next > 999) throw wrongState('نفدت أرقام الأجهزة في هذا الفرع. تواصل مع الدعم.');
  return String(next).padStart(3, '0');
}

async function activeBranch(tx: Transaction, branchId: string) {
  const [branch] = await tx
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.isActive, true)));
  return branch ?? null;
}

/** A branch of this store the user may link devices to: 403 without the permission, else 404. */
async function branchToManage(tx: Transaction, auth: AccessClaims, branchId: string) {
  const scope = await requirePermission(tx, auth.userId, 'devices.manage');
  const branch = await activeBranch(tx, branchId);
  if (!branch) throw branchNotFound();
  if (!inScope(scope, branch.id)) await requirePermission(tx, auth.userId, 'devices.manage', branch.id);
  return branch;
}

async function storeName(tx: Transaction): Promise<string> {
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
  return tenant!.name;
}

type DeviceRow = typeof devices.$inferSelect;

async function activatedDevice(tx: Transaction, device: DeviceRow, token: string): Promise<ActivatedDevice> {
  const [branch] = await tx
    .select({ code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.id, device.branchId));
  const state = await readServerState(tx);
  return {
    deviceId: device.id,
    token,
    deviceCode: device.code!,
    tenantId: device.tenantId,
    storeName: await storeName(tx),
    branchId: device.branchId,
    branchCode: branch!.code,
    branchName: branch!.name,
    deviceName: device.name,
    serverEpoch: state.serverEpoch,
  };
}

const deviceFields = (data: ActivateDeviceData) => ({
  name: data.name,
  kind: data.kind,
  platform: data.platform,
  publicKey: data.publicKey,
  appVersion: data.appVersion,
});

// ─── Owner: pairing codes ─────────────────────────────────────────────────────

/** POST /v1/devices/pairing-codes: a QR and a typed code for one branch, valid 10 minutes. */
export async function createPairingCode(
  db: Database,
  auth: AccessClaims,
  input: { branchId: CreatePairingCodeInput['branchId'] },
  { now, webOrigin }: { now: Date; webOrigin: string },
  meta: RequestMeta,
): Promise<PairingCodeResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const branch = await branchToManage(tx, auth, input.branchId);
    const [tenant] = await tx.select({ storeCode: tenants.storeCode }).from(tenants).limit(1);

    const qrToken = newQrToken();
    const manualCode = newManualCode();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_SECONDS * 1000);
    const [pairing] = await tx
      .insert(devicePairings)
      .values({
        tenantId: auth.tenantId,
        branchId: branch.id,
        qrTokenHash: hashQrToken(qrToken),
        codeHash: hashManualCode(auth.tenantId, manualCode),
        createdBy: auth.userId,
        expiresAt,
      })
      .returning({ id: devicePairings.id });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'device.pairing_created',
        entity: 'device_pairing',
        entityId: pairing!.id,
        data: { branchId: branch.id, expiresAt: expiresAt.toISOString() },
      },
      meta,
    );
    return {
      pairingId: pairing!.id,
      branchId: branch.id,
      branchName: branch.name,
      qrPayload: `${webOrigin}/link#${qrToken}`,
      qrToken,
      manualCode,
      storeCode: tenant!.storeCode,
      expiresAt: expiresAt.toISOString(),
      maxAttempts: PAIRING_MAX_ATTEMPTS,
    };
  });
}

// ─── Device: activation with a QR or a typed code ─────────────────────────────

type PairingOutcome = { ok: PendingActivation } | { error: 'wrong' | 'expired' | 'locked' };

function raise(outcome: PairingOutcome): PendingActivation {
  if ('ok' in outcome) return outcome.ok;
  throw outcome.error === 'locked' ? lockedCode() : outcome.error === 'expired' ? expiredCode() : wrongCode();
}

/**
 * Uses an open pairing for one new device, which then waits for the owner's approval. A pairing
 * links one device only: the first to claim it wins.
 */
async function claimPairing(
  tx: Transaction,
  pairing: typeof devicePairings.$inferSelect,
  data: ActivateDeviceData,
  now: Date,
  meta: RequestMeta,
): Promise<PairingOutcome> {
  if (pairing.attempts >= PAIRING_MAX_ATTEMPTS) return { error: 'locked' };
  if (pairing.usedAt || pairing.expiresAt.getTime() <= now.getTime()) return { error: 'expired' };
  const branch = await activeBranch(tx, pairing.branchId);
  if (!branch) return { error: 'expired' };
  const [claimed] = await tx
    .update(devicePairings)
    .set({ usedAt: now })
    .where(and(eq(devicePairings.id, pairing.id), isNull(devicePairings.usedAt)))
    .returning({ id: devicePairings.id });
  if (!claimed) return { error: 'expired' };

  const secret = newActivationSecret();
  const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
  const [device] = await tx
    .insert(devices)
    .values({
      tenantId: pairing.tenantId,
      branchId: branch.id,
      status: 'pending_approval',
      ...deviceFields(data),
      pairingId: pairing.id,
      activationSecretHash: hashActivationSecret(secret),
      activationExpiresAt: expiresAt,
      createdAt: now,
    })
    .returning();
  await tx.update(devicePairings).set({ deviceId: device!.id }).where(eq(devicePairings.id, pairing.id));
  await audit(
    tx,
    {
      tenantId: pairing.tenantId,
      actorType: 'device',
      action: 'device.link_requested',
      entity: 'device',
      entityId: device!.id,
      data: {
        method: data.method,
        pairingId: pairing.id,
        branchId: branch.id,
        name: data.name,
        kind: data.kind,
      },
    },
    meta,
  );
  return {
    ok: {
      status: 'pending_approval',
      activationId: device!.id,
      activationSecret: secret,
      storeName: await storeName(tx),
      branchName: branch.name,
      deviceName: device!.name,
      expiresAt: expiresAt.toISOString(),
      pollAfterSeconds: POLL_AFTER_SECONDS,
    },
  };
}

/** POST /v1/devices/activate, method qr: the token alone finds its pairing and its store. */
export async function activateWithQr(
  db: Database,
  data: Extract<ActivateDeviceData, { method: 'qr' }>,
  now: Date,
  meta: RequestMeta,
): Promise<PendingActivation> {
  const [found] = await db.execute<{ id: string; tenant_id: string; tenant_status: string }>(
    sql`select * from device_pairing_find_by_qr_hash(${hashQrToken(data.qrToken)})`,
  );
  if (!found || found.tenant_status !== 'active') throw wrongCode();
  const outcome = await withTenant(db, found.tenant_id, async (tx) => {
    const [pairing] = await tx.select().from(devicePairings).where(eq(devicePairings.id, found.id));
    return claimPairing(tx, pairing!, data, now, meta);
  });
  return raise(outcome);
}

/**
 * POST /v1/devices/activate, method code: the store code finds the store, then the typed code
 * one of its open pairings. A wrong code counts against every open pairing of that store, and a
 * pairing with 5 wrong tries is dead (16 › زرع جهاز). The count is kept even though the request
 * fails, so it is written before the error is thrown.
 */
export async function activateWithCode(
  db: Database,
  data: Extract<ActivateDeviceData, { method: 'code' }>,
  now: Date,
  meta: RequestMeta,
): Promise<PendingActivation> {
  const [store] = await db.execute<{ id: string; status: string }>(
    sql`select * from tenant_find_by_store_code(${data.storeCode})`,
  );
  if (!store || store.status !== 'active') throw wrongCode();
  const outcome = await withTenant(db, store.id, async (tx): Promise<PairingOutcome> => {
    const [pairing] = await tx
      .select()
      .from(devicePairings)
      .where(eq(devicePairings.codeHash, hashManualCode(store.id, data.manualCode)))
      .orderBy(sql`${devicePairings.createdAt} desc`)
      .limit(1);
    if (pairing) return claimPairing(tx, pairing, data, now, meta);
    const counted = await tx
      .update(devicePairings)
      .set({ attempts: sql`${devicePairings.attempts} + 1` })
      .where(
        and(
          isNull(devicePairings.usedAt),
          gt(devicePairings.expiresAt, now),
          lt(devicePairings.attempts, PAIRING_MAX_ATTEMPTS),
        ),
      )
      .returning({ id: devicePairings.id, attempts: devicePairings.attempts });
    await audit(
      tx,
      {
        tenantId: store.id,
        actorType: 'device',
        action: 'device.link_wrong_code',
        entity: 'tenant',
        entityId: store.id,
        data: { openPairings: counted.map((p) => ({ id: p.id, attempts: p.attempts })) },
      },
      meta,
    );
    return { error: 'wrong' };
  });
  return raise(outcome);
}

// ─── Owner signing in on the device ───────────────────────────────────────────

/** POST /v1/devices/activate, method owner: the owner's own sign-in is the approval. */
export async function activateByOwner(
  db: Database,
  auth: AccessClaims,
  data: Extract<ActivateDeviceData, { method: 'owner' }>,
  now: Date,
  meta: RequestMeta,
): Promise<{ status: 'active'; device: ActivatedDevice }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const branch = await branchToManage(tx, auth, data.branchId);
    const code = await reserveCode(tx, branch.id);
    const token = newDeviceToken();
    const [device] = await tx
      .insert(devices)
      .values({
        tenantId: auth.tenantId,
        branchId: branch.id,
        status: 'active',
        code,
        ...deviceFields(data),
        tokenHash: hashDeviceToken(token),
        tokenIssuedAt: now,
        approvedBy: auth.userId,
        approvedAt: now,
        createdAt: now,
      })
      .returning();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'device.activated',
        entity: 'device',
        entityId: device!.id,
        data: { method: 'owner', branchId: branch.id, code, name: data.name, kind: data.kind },
      },
      meta,
    );
    return { status: 'active' as const, device: await activatedDevice(tx, device!, token) };
  });
}

// ─── Device: waiting for approval ─────────────────────────────────────────────

/**
 * GET /v1/devices/activations/{id} with `Authorization: Activation <secret>`. Once approved, the
 * device token is made and answered exactly once; asking again is 410.
 */
export async function activationStatus(
  db: Database,
  activationId: string,
  secret: string,
  now: Date,
  meta: RequestMeta,
): Promise<ActivationStatusResponse> {
  if (!ACTIVATION_SECRET_PATTERN.test(secret)) throw unauthorized();
  const [found] = await db.execute<{ id: string; tenant_id: string; tenant_status: string }>(
    sql`select * from device_find_by_activation_hash(${hashActivationSecret(secret)})`,
  );
  if (!found || found.tenant_status !== 'active' || !sameText(found.id, activationId)) throw unauthorized();
  return withTenant(db, found.tenant_id, async (tx): Promise<ActivationStatusResponse> => {
    const [device] = await tx.select().from(devices).where(eq(devices.id, found.id));
    if (!device) throw unauthorized();
    switch (device.status) {
      case 'pending_approval':
        if (device.activationExpiresAt!.getTime() <= now.getTime()) return { status: 'expired' };
        return {
          status: 'pending_approval',
          expiresAt: device.activationExpiresAt!.toISOString(),
          pollAfterSeconds: POLL_AFTER_SECONDS,
        };
      case 'rejected':
        return { status: 'rejected' };
      case 'active': {
        if (device.tokenHash) throw tokenGone();
        const token = newDeviceToken();
        // Only one request can set the token, even if two polls arrive together.
        const [issued] = await tx
          .update(devices)
          .set({ tokenHash: hashDeviceToken(token), tokenIssuedAt: now })
          .where(and(eq(devices.id, device.id), isNull(devices.tokenHash)))
          .returning();
        if (!issued) throw tokenGone();
        await audit(
          tx,
          {
            tenantId: device.tenantId,
            actorType: 'device',
            action: 'device.token_issued',
            entity: 'device',
            entityId: device.id,
          },
          meta,
        );
        return { status: 'active', device: await activatedDevice(tx, issued, token) };
      }
      default:
        throw tokenGone();
    }
  });
}

// ─── Owner and manager: the list ──────────────────────────────────────────────

type MissingRow = { device_id: string; missing: number };

/**
 * Per device: the numbers it announced (doc_sequences) that never reached the inbox and are not
 * in an approved loss (number_gaps). Only numbers carrying the device's own code count.
 */
async function missingDocuments(tx: Transaction, deviceId?: string): Promise<Map<string, number>> {
  const rows = await tx.execute<MissingRow>(sql`
    select ds.device_id,
           sum(greatest(0, ds.last_announced - coalesce(r.n, 0) - coalesce(g.n, 0)))::int as missing
    from doc_sequences ds
    join devices d on d.tenant_id = ds.tenant_id and d.id = ds.device_id
    left join lateral (
      select count(distinct split_part(i.number, '-', 4)::int)::int as n
      from sync_inbox i
      where i.tenant_id = ds.tenant_id and i.device_id = ds.device_id and i.number is not null
        and split_part(i.number, '-', 1) = ds.series
        and split_part(i.number, '-', 3) = d.code
        and split_part(i.number, '-', 4)::int <= ds.last_announced
    ) r on true
    left join lateral (
      select sum(least(ng.to_seq, ds.last_announced) - ng.from_seq + 1)::int as n
      from number_gaps ng
      where ng.tenant_id = ds.tenant_id and ng.device_id = ds.device_id and ng.series = ds.series
        and ng.approved_at is not null and ng.from_seq <= ds.last_announced
    ) g on true
    where ${deviceId ? sql`ds.device_id = ${deviceId}` : sql`true`}
    group by ds.device_id`);
  return new Map(rows.map((r) => [r.device_id, Number(r.missing)]));
}

async function summaries(tx: Transaction, now: Date, deviceId?: string): Promise<DeviceSummary[]> {
  const rows = await tx
    .select({ device: devices, branchName: branches.name, branchCode: branches.code })
    .from(devices)
    .innerJoin(branches, eq(branches.id, devices.branchId))
    .where(deviceId ? eq(devices.id, deviceId) : undefined)
    .orderBy(asc(branches.code), asc(devices.code), asc(devices.createdAt));
  const missing = await missingDocuments(tx, deviceId);
  const announced = new Set(missing.keys());
  return rows
    .filter(({ device }) => deviceId !== undefined || isListed(device, now))
    .map(({ device, branchName }) => ({
      id: device.id,
      name: device.name,
      kind: device.kind as DeviceKind,
      platform: device.platform as DevicePlatform,
      status: device.status as DeviceStatus,
      code: device.code,
      branchId: device.branchId,
      branchName,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
      appVersion: device.appVersion,
      clockOffsetMs: device.clockOffsetMs,
      missingDocuments:
        announced.has(device.id) || device.lastHeartbeatAt ? (missing.get(device.id) ?? 0) : null,
      unsentCount: device.unsentCount,
      createdAt: device.createdAt.toISOString(),
      revokedAt: device.revokedAt?.toISOString() ?? null,
      version: device.version,
    }));
}

/** Rejected devices and requests that waited too long are not shown. */
const isListed = (device: DeviceRow, now: Date) =>
  device.status === 'rejected'
    ? false
    : device.status !== 'pending_approval' || device.activationExpiresAt!.getTime() > now.getTime();

/** GET /v1/devices: waiting devices first, then by branch and code; a manager sees his branches. */
export async function listDevices(db: Database, auth: AccessClaims, now: Date): Promise<DeviceSummary[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'devices.view');
    const all = await summaries(tx, now);
    const visible = all.filter((d) => inScope(scope, d.branchId));
    return [
      ...visible.filter((d) => d.status === 'pending_approval'),
      ...visible.filter((d) => d.status !== 'pending_approval'),
    ];
  });
}

// ─── Owner: rename, approve, reject, revoke ───────────────────────────────────

async function deviceToManage(tx: Transaction, auth: AccessClaims, id: string): Promise<DeviceRow> {
  const [device] = await tx.select().from(devices).where(eq(devices.id, id));
  if (!device) throw deviceNotFound();
  await requirePermission(tx, auth.userId, 'devices.manage', device.branchId);
  return device;
}

async function summaryOf(tx: Transaction, id: string, now: Date): Promise<DeviceSummary> {
  return (await summaries(tx, now, id))[0]!;
}

export interface ManageContext {
  now: Date;
  meta: RequestMeta;
}

/** PATCH /v1/devices/{id}: a new name, refused when someone else changed the device meanwhile. */
export async function renameDevice(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: RenameDeviceInput,
  { now, meta }: ManageContext,
): Promise<DeviceSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const device = await deviceToManage(tx, auth, id);
    const [renamed] = await tx
      .update(devices)
      .set({ name: input.name })
      .where(and(eq(devices.id, id), eq(devices.version, input.version)))
      .returning({ id: devices.id });
    if (!renamed) throw wrongState('عُدّل هذا الجهاز من مكان آخر. حدّث الصفحة وأعد المحاولة.');
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'device.renamed',
        entity: 'device',
        entityId: id,
        changes: { name: [device.name, input.name] },
      },
      meta,
    );
    return summaryOf(tx, id, now);
  });
}

/** POST /v1/devices/{id}/approve: the waiting device takes its code; it collects its token itself. */
export async function approveDevice(
  db: Database,
  auth: AccessClaims,
  id: string,
  { now, meta }: ManageContext,
): Promise<DeviceSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const device = await deviceToManage(tx, auth, id);
    if (device.status !== 'pending_approval') throw wrongState('هذا الجهاز ليس بانتظار الموافقة.');
    if (device.activationExpiresAt!.getTime() <= now.getTime()) {
      throw wrongState('انتهت مهلة طلب الربط. اربط الجهاز من جديد.');
    }
    const code = await reserveCode(tx, device.branchId);
    await tx
      .update(devices)
      .set({ status: 'active', code, approvedBy: auth.userId, approvedAt: now })
      .where(eq(devices.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'device.approved',
        entity: 'device',
        entityId: id,
        changes: { status: ['pending_approval', 'active'], code: [null, code] },
      },
      meta,
    );
    return summaryOf(tx, id, now);
  });
}

/** POST /v1/devices/{id}/reject */
export async function rejectDevice(
  db: Database,
  auth: AccessClaims,
  id: string,
  { now, meta }: ManageContext,
): Promise<DeviceSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const device = await deviceToManage(tx, auth, id);
    if (device.status !== 'pending_approval') throw wrongState('هذا الجهاز ليس بانتظار الموافقة.');
    await tx.update(devices).set({ status: 'rejected' }).where(eq(devices.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'device.rejected',
        entity: 'device',
        entityId: id,
        changes: { status: ['pending_approval', 'rejected'] },
      },
      meta,
    );
    return summaryOf(tx, id, now);
  });
}

/**
 * POST /v1/devices/{id}/revoke (lost or stolen): it can no longer pull or sell. What it numbered up
 * to its last announced number is still accepted; the rest is quarantined for the owner, then
 * the device is told to wipe (17 › الجهاز الموقوف).
 */
export async function revokeDevice(
  db: Database,
  auth: AccessClaims,
  id: string,
  { now, meta }: ManageContext,
): Promise<DeviceSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const device = await deviceToManage(tx, auth, id);
    if (device.status !== 'active') throw wrongState('هذا الجهاز ليس فعّالاً.');
    await tx.update(devices).set({ status: 'revoked', revokedAt: now }).where(eq(devices.id, id));
    const announced = await tx.execute<{ series: string; last_announced: number }>(
      sql`select series, last_announced from doc_sequences where device_id = ${id} order by series`,
    );
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'device.revoked',
        entity: 'device',
        entityId: id,
        changes: { status: ['active', 'revoked'] },
        // The cut-off: numbers up to these are accepted, later ones quarantined.
        data: { lastAnnounced: Object.fromEntries(announced.map((r) => [r.series, r.last_announced])) },
      },
      meta,
    );
    return summaryOf(tx, id, now);
  });
}
