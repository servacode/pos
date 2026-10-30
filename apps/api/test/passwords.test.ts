import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BoundedQueue, PasswordHasher } from '../src/auth/passwords';
import { closeAppDb, makeApp, registerStore, resetDatabase } from './helpers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('BoundedQueue', () => {
  it('runs up to the concurrency, queues up to the limit, and refuses the rest with 503', async () => {
    const queue = new BoundedQueue(1, 1);
    const gate = deferred();
    const order: string[] = [];

    const first = queue.run(async () => {
      order.push('first');
      await gate.promise;
    });
    const second = queue.run(async () => {
      order.push('second');
    });
    await expect(queue.run(async () => order.push('third'))).rejects.toMatchObject({
      statusCode: 503,
      code: 'unavailable',
    });

    expect(order).toEqual(['first']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('frees its slot when a task fails', async () => {
    const queue = new BoundedQueue(1, 0);
    await expect(queue.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('PasswordHasher', () => {
  it('hashes with argon2id and verifies', async () => {
    const hasher = new PasswordHasher({ concurrency: 2, queue: 2 });
    const hashed = await hasher.hash('secret-pass-1');
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await hasher.verify(hashed, 'secret-pass-1')).toBe(true);
    expect(await hasher.verify(hashed, 'other')).toBe(false);
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
  });
});

describe('sign-in under a flood', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp({ PASSWORD_HASH_CONCURRENCY: '1', PASSWORD_HASH_QUEUE: '0' });
  });
  afterAll(async () => {
    await app.close();
    await closeAppDb();
  });
  beforeEach(resetDatabase);

  it('answers 503 instead of queueing password checks without bound', async () => {
    await registerStore(app);
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { phone: '0912345678', password: 'not-the-password' },
        }),
      ),
    );
    const codes = attempts.map((r) => r.statusCode);
    expect(codes).toContain(401);
    expect(codes).toContain(503);
    const busy = attempts.find((r) => r.statusCode === 503)!;
    expect(busy.json().error.code).toBe('unavailable');
  });
});
