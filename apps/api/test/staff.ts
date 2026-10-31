import type { FastifyInstance } from 'fastify';
import { normalizePhone } from '@serva/core';
import { hashSecret } from '../src/auth/passwords';
import { firstBranch } from './devices';
import { ownerDb, registerStore } from './helpers';

export interface TestStore {
  tenantId: string;
  userId: string;
  accessToken: string;
  branchId: string;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function testStore(app: FastifyInstance, phone = '0911111111'): Promise<TestStore> {
  const { body } = await registerStore(app, { phone });
  return {
    tenantId: body.tenant.id,
    userId: body.user.id,
    accessToken: body.accessToken,
    branchId: await firstBranch(body.tenant.id),
  };
}

export const STAFF_PASSWORD = 'secret-pass-2';

/** Another person of the store with one role (optionally for one branch), signed in on the web. */
export async function staffUser(
  app: FastifyInstance,
  store: TestStore,
  role: string,
  phone: string,
  options: { branchId?: string | null; fullName?: string } = {},
): Promise<{ userId: string; accessToken: string }> {
  const e164 = normalizePhone(phone)!;
  const [user] = await ownerDb()<{ id: string }[]>`
    insert into users (tenant_id, full_name, phone, password_hash)
    values (${store.tenantId}, ${options.fullName ?? 'موظف'}, ${e164}, ${await hashSecret(STAFF_PASSWORD)})
    returning id`;
  await ownerDb()`
    insert into user_roles (tenant_id, user_id, role_id, branch_id)
    select ${store.tenantId}, ${user!.id}, id, ${options.branchId ?? null}
    from roles where tenant_id = ${store.tenantId} and key = ${role}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { phone, password: STAFF_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return { userId: user!.id, accessToken: res.json<{ accessToken: string }>().accessToken };
}
