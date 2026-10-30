import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/ids';

describe('uuidv7', () => {
  it('is a valid version-7 UUID', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('starts with the creation time in milliseconds, so ids sort by time', () => {
    const at = Date.UTC(2026, 9, 30, 9, 0, 0, 123);
    const id = uuidv7(at);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(at);
    expect(uuidv7(at + 1) > id).toBe(true);
  });

  it('is unique within the same millisecond', () => {
    const at = Date.now();
    const ids = new Set(Array.from({ length: 1_000 }, () => uuidv7(at)));
    expect(ids.size).toBe(1_000);
  });
});
