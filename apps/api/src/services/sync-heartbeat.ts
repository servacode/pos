import { eq } from 'drizzle-orm';
import { devices, withTenant, type Database } from '@serva/db';
import { CONTRACT_VERSION, type heartbeatRequestSchema, type HeartbeatResponse } from '@serva/sync';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { clampInt, recordAnnounced } from './sync-push';
import { readServerState } from './sync-state';

type HeartbeatRequest = z.output<typeof heartbeatRequestSchema>;

/**
 * POST /v1/sync/heartbeat (15 › إشارة حياة): the device's last number per series goes to
 * doc_sequences, which GET /v1/devices compares with the inbox, and to the cut-off of a later
 * revocation. A revoked device is still heard (unsent count, last contact) but can no longer move
 * its cut-off, and is told to wipe.
 */
export async function recordHeartbeat(
  db: Database,
  device: DeviceClaims,
  request: HeartbeatRequest,
  now: Date,
): Promise<HeartbeatResponse> {
  return withTenant(db, device.tenantId, async (tx) => {
    const state = await readServerState(tx);
    if (!device.revokedAt) await recordAnnounced(tx, device, request.lastIssued);
    const sentAt = Date.parse(request.sentAt);
    await tx
      .update(devices)
      .set({
        lastSeenAt: now,
        lastHeartbeatAt: now,
        unsentCount: request.unsentCount,
        storageUsedBytes: request.storageUsedBytes,
        appVersion: request.appVersion,
        clockOffsetMs: clampInt(sentAt - now.getTime()),
      })
      .where(eq(devices.id, device.deviceId));
    return {
      contractVersion: CONTRACT_VERSION,
      serverEpoch: state.serverEpoch,
      serverTime: now.toISOString(),
      commands: device.revokedAt ? { wipe: true } : {},
    };
  });
}
