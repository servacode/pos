import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane)
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashSecret(secret: string): Promise<string> {
  return hash(secret, OPTIONS);
}

export async function verifySecret(hashed: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashed, secret);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so a missing account can't be detected by timing. */
export async function verifyAgainstDummy(secret: string): Promise<false> {
  dummyHash ??= hashSecret('dummy-password-for-timing');
  await verifySecret(await dummyHash, secret);
  return false;
}
