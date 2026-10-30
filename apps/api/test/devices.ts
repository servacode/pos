import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createFetchTransport, type SyncTransport } from '@serva/sync/client';
import { hashDeviceToken } from '../src/auth/device-guard';
import { ownerDb } from './helpers';

export interface TestDevice {
  deviceId: string;
  tenantId: string;
  branchId: string;
  code: string;
  token: string;
  authorization: string;
}

/**
 * Pairs a device the way activation will (17 › POST /v1/devices/activate, not built yet): a row
 * with the next free 3-digit code in the store's first branch, and its token stored only as a hash.
 */
export async function createDevice(
  tenantId: string,
  options: { code?: string; revoked?: boolean } = {},
): Promise<TestDevice> {
  const token = `sdt_${randomBytes(32).toString('base64url')}`;
  const [branch] = await ownerDb()<{ id: string }[]>`
    select id from branches where tenant_id = ${tenantId} order by created_at limit 1`;
  const [taken] = await ownerDb()<{ n: number }[]>`
    select count(*)::int as n from devices where tenant_id = ${tenantId}`;
  const code = options.code ?? String(taken!.n + 2).padStart(3, '0');
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into devices (tenant_id, branch_id, code, name, token_hash, revoked_at)
    values (${tenantId}, ${branch!.id}, ${code}, ${`كاشير ${code}`}, ${hashDeviceToken(token)},
            ${options.revoked ? new Date() : null})
    returning id`;
  return {
    deviceId: row!.id,
    tenantId,
    branchId: branch!.id,
    code,
    token,
    authorization: `Device ${token}`,
  };
}

export type Fault = 'lose_request' | 'lose_response';

/**
 * The real client transport (fetch, gzip, status mapping) over app.inject, with faults on demand:
 * a request lost before the server, or an answer lost after the server did the work.
 */
export function injectTransport(
  app: FastifyInstance,
  device: Pick<TestDevice, 'token'>,
  faults: Fault[] = [],
): SyncTransport {
  return createFetchTransport({
    getToken: () => device.token,
    appVersion: '1.0.0',
    gzipAbove: 2_000,
    fetch: async (input, init) => {
      const fault = faults.shift();
      if (fault === 'lose_request') throw new TypeError('Failed to fetch');
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
      const body = init?.body;
      const res = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url,
        headers: init?.headers as Record<string, string>,
        ...(body === undefined || body === null
          ? {}
          : { payload: typeof body === 'string' ? body : Buffer.from(body as Uint8Array) }),
      });
      if (fault === 'lose_response') throw new TypeError('Failed to fetch');
      return new Response(res.body, {
        status: res.statusCode,
        headers: Object.fromEntries(
          Object.entries(res.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
        ),
      });
    },
  });
}
