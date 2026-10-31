import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, unauthorized } from '../errors';
import { enforceLimits } from '../http/rate-limit';

/** Device tokens look like sdt_<43 base64url chars>: 256 random bits (17 › الجهاز). */
export const DEVICE_TOKEN_PATTERN = /^sdt_[A-Za-z0-9_-]{43}$/;

/** What a device request is allowed to act as, taken from its token alone. */
export interface DeviceClaims {
  deviceId: string;
  tenantId: string;
  branchId: string;
  code: string;
  revokedAt: Date | null;
}

/** Only this hash of a device token is stored (devices.token_hash). */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export const deviceRevoked = () =>
  new AppError(403, 'device_revoked', 'أُوقف هذا الجهاز من حساب المالك. لا يمكنه البيع أو المزامنة.');

/**
 * preHandler for device routes: `Authorization: Device <token>`. The store comes from the device
 * record, never from the request. A revoked device may still send what it holds (its later
 * documents are quarantined) when `allowRevoked` is set; every other route refuses it.
 */
export function requireDevice(
  options: { allowRevoked?: boolean; extraLimits?: (d: DeviceClaims) => { key: string; max: number }[] } = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Device ')) throw unauthorized();
    const token = header.slice('Device '.length);
    if (!DEVICE_TOKEN_PATTERN.test(token)) throw unauthorized();
    const { db, env } = request.server;
    const [row] = await db.execute<{
      id: string;
      tenant_id: string;
      branch_id: string;
      code: string | null;
      revoked_at: string | null;
      tenant_status: string;
    }>(sql`select * from device_find_by_token_hash(${hashDeviceToken(token)})`);
    // A token exists only once the device is approved, so it always has its code.
    if (!row?.code || row.tenant_status !== 'active') throw unauthorized();
    const device: DeviceClaims = {
      deviceId: row.id,
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      code: row.code,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    };
    if (device.revokedAt && !options.allowRevoked) throw deviceRevoked();
    await enforceLimits(request, reply, 60_000, [
      { key: `device:${device.deviceId}`, max: env.DEVICE_RATE_LIMIT_PER_MINUTE },
      { key: `store:${device.tenantId}`, max: env.STORE_RATE_LIMIT_PER_MINUTE },
      ...(options.extraLimits?.(device) ?? []),
    ]);
    request.device = device;
  };
}
