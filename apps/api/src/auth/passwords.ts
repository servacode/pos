import { hash, verify } from '@node-rs/argon2';
import { AppError } from '../errors';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane)
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Hashes outside the request path (seed script). Requests go through PasswordHasher. */
export function hashSecret(secret: string): Promise<string> {
  return hash(secret, OPTIONS);
}

async function verifySecret(hashed: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashed, secret);
  } catch {
    return false;
  }
}

export const busy = () => new AppError(503, 'unavailable', 'الخادم مشغول حالياً. حاول بعد قليل.');

/**
 * Runs at most `concurrency` tasks at once and lets at most `queue` more wait; anything beyond is
 * refused at once. A flood of sign-in requests then gets 503 instead of filling the thread pool
 * and slowing every other request.
 */
export class BoundedQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly queue: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) {
      this.active++;
    } else {
      if (this.waiting.length >= this.queue) throw busy();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** argon2id hashing and checks for request handlers, through a bounded queue. */
export class PasswordHasher {
  private readonly queue: BoundedQueue;
  private dummyHash: Promise<string> | undefined;

  constructor(limits: { concurrency: number; queue: number }) {
    this.queue = new BoundedQueue(limits.concurrency, limits.queue);
  }

  hash(secret: string): Promise<string> {
    return this.queue.run(() => hashSecret(secret));
  }

  verify(hashed: string, secret: string): Promise<boolean> {
    return this.queue.run(() => verifySecret(hashed, secret));
  }

  /** Spends the same time as a real check, so a missing account can't be detected by timing. */
  async verifyAgainstDummy(secret: string): Promise<false> {
    this.dummyHash ??= hashSecret('dummy-password-for-timing');
    const dummy = await this.dummyHash;
    await this.queue.run(() => verifySecret(dummy, secret));
    return false;
  }
}
