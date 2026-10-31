import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ActivateDeviceInput, ActivatedDevice } from '@serva/core';
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
 * A device row inserted directly, for tests where only a working device matters (fast): the next
 * free 3-digit code in the store's first branch, its token stored only as a hash. Tests of linking
 * itself go through the real routes with activateDevice() and linkDevice().
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
    insert into devices (tenant_id, branch_id, code, name, status, token_hash, revoked_at)
    values (${tenantId}, ${branch!.id}, ${code}, ${`كاشير ${code}`}, ${options.revoked ? 'revoked' : 'active'},
            ${hashDeviceToken(token)}, ${options.revoked ? new Date() : null})
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

/** A real device public key: ECDSA P-256, SPKI, base64url. */
export function devicePublicKey(): string {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
}

export const deviceFields = (name = 'كاشير 1') => ({
  name,
  kind: 'cashier' as const,
  platform: 'browser' as const,
  publicKey: devicePublicKey(),
  appVersion: '1.0.0',
});

export async function firstBranch(tenantId: string): Promise<string> {
  const [branch] = await ownerDb()<{ id: string }[]>`
    select id from branches where tenant_id = ${tenantId} order by created_at limit 1`;
  return branch!.id;
}

const asTestDevice = (device: ActivatedDevice): TestDevice => ({
  deviceId: device.deviceId,
  tenantId: device.tenantId,
  branchId: device.branchId,
  code: device.deviceCode,
  token: device.token,
  authorization: `Device ${device.token}`,
});

/** The owner signs in on the device (method owner): active at once, through the real route. */
export async function activateDevice(
  app: FastifyInstance,
  accessToken: string,
  branchId: string,
  name = 'كاشير 1',
): Promise<TestDevice & { activated: ActivatedDevice }> {
  const payload: ActivateDeviceInput = { method: 'owner', branchId, ...deviceFields(name) };
  const res = await app.inject({
    method: 'POST',
    url: '/v1/devices/activate',
    headers: { authorization: `Bearer ${accessToken}` },
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`activate failed: ${res.statusCode} ${res.body}`);
  const activated = res.json<{ device: ActivatedDevice }>().device;
  return { ...asTestDevice(activated), activated };
}

/**
 * The whole linking flow through the real routes: a pairing code from the owner, the device types
 * it, the owner approves, the device collects its token.
 */
export async function linkDevice(
  app: FastifyInstance,
  accessToken: string,
  branchId: string,
  name = 'كاشير 1',
): Promise<TestDevice & { activated: ActivatedDevice }> {
  const owner = { authorization: `Bearer ${accessToken}` };
  const pairing = await app.inject({
    method: 'POST',
    url: '/v1/devices/pairing-codes',
    headers: owner,
    payload: { branchId },
  });
  if (pairing.statusCode !== 201) throw new Error(`pairing failed: ${pairing.statusCode} ${pairing.body}`);
  const { manualCode, storeCode } = pairing.json<{ manualCode: string; storeCode: string }>();
  const pending = await app.inject({
    method: 'POST',
    url: '/v1/devices/activate',
    payload: { method: 'code', storeCode, manualCode, ...deviceFields(name) },
  });
  if (pending.statusCode !== 202) throw new Error(`activate failed: ${pending.statusCode} ${pending.body}`);
  const { activationId, activationSecret } = pending.json<{
    activationId: string;
    activationSecret: string;
  }>();
  const approve = await app.inject({
    method: 'POST',
    url: `/v1/devices/${activationId}/approve`,
    headers: owner,
  });
  if (approve.statusCode !== 200) throw new Error(`approve failed: ${approve.statusCode} ${approve.body}`);
  const poll = await app.inject({
    method: 'GET',
    url: `/v1/devices/activations/${activationId}`,
    headers: { authorization: `Activation ${activationSecret}` },
  });
  if (poll.statusCode !== 200) throw new Error(`poll failed: ${poll.statusCode} ${poll.body}`);
  const activated = poll.json<{ device: ActivatedDevice }>().device;
  return { ...asTestDevice(activated), activated };
}

/** 'none' lets one request through, to reach a fault meant for a later one */
export type Fault = 'none' | 'lose_request' | 'lose_response' | 'cut_body';

/**
 * The real client transport (fetch, gzip, status mapping) over app.inject, with faults on demand:
 * a request lost before the server, an answer lost after the server did the work, or an answer
 * whose body stops half way (a download cut by the network).
 */
export function injectTransport(
  app: FastifyInstance,
  device: Pick<TestDevice, 'token'>,
  faults: Fault[] = [],
): SyncTransport & { requests: Array<{ url: string; headers: Record<string, string> }> } {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const transport = createFetchTransport({
    getToken: () => device.token,
    appVersion: '1.0.0',
    gzipAbove: 2_000,
    fetch: async (input, init) => {
      const fault = faults.shift();
      if (fault === 'lose_request') throw new TypeError('Failed to fetch');
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
      const headers = init?.headers as Record<string, string>;
      requests.push({ url, headers });
      const body = init?.body;
      const res = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url,
        headers,
        ...(body === undefined || body === null
          ? {}
          : { payload: typeof body === 'string' ? body : Buffer.from(body as Uint8Array) }),
      });
      if (fault === 'lose_response') throw new TypeError('Failed to fetch');
      const raw = new Uint8Array(res.rawPayload);
      const half = Math.floor(raw.length / 2);
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(fault === 'cut_body' ? raw.slice(0, half) : raw);
          } else if (fault === 'cut_body') {
            controller.error(new TypeError('network'));
          } else {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        status: res.statusCode,
        headers: Object.fromEntries(
          Object.entries(res.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
        ),
      });
    },
  });
  return Object.assign(transport, { requests });
}
