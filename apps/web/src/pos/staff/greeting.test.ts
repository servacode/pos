import { describe, expect, it } from 'vitest';
import { greeting } from './StaffSignIn';

const at = (hour: number) => new Date(2026, 10, 15, hour, 30).getTime();

describe('the greeting by the device clock', () => {
  it('says good morning until noon, good evening after, and a neutral welcome in the small hours', () => {
    expect(greeting(at(1))).toBe('أهلاً بك');
    expect(greeting(at(4))).toBe('صباح الخير');
    expect(greeting(at(11))).toBe('صباح الخير');
    expect(greeting(at(12))).toBe('مساء الخير');
    expect(greeting(at(22))).toBe('مساء الخير');
  });
});
