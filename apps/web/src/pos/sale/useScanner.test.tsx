import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SCAN_GAP_MS, useScanner } from './useScanner';

/** Round 39: a real scanner sends the same code twice on purpose, and a stalled key must not lose the scan */
function harness() {
  const scans: string[] = [];
  let clock = 1000;
  renderHook(() => useScanner({ enabled: true, onScan: (c) => scans.push(c), now: () => clock }));
  const key = (k: string, after: number) => {
    clock += after;
    fireEvent.keyDown(window, { key: k });
  };
  const send = (code: string, stallAt = -1, stall = 0) => {
    [...code].forEach((ch, i) => key(ch, i === 0 ? 300 : i === stallAt ? stall : 5));
    key('Enter', 5);
  };
  return { scans, send };
}

describe('the scanner listener (round 39)', () => {
  it('counts the same code scanned again and again, 40 times', () => {
    const { scans, send } = harness();
    for (let i = 0; i < 40; i += 1) send('6210000000175');
    expect(scans).toHaveLength(40);
    expect(new Set(scans)).toEqual(new Set(['6210000000175']));
  });

  it('keeps a scan whose one key was stalled past the gap, and still treats slow typing as typing', () => {
    const { scans, send } = harness();
    send('6210000000175', 8, SCAN_GAP_MS + 40);
    expect(scans).toEqual(['6210000000175']);
    // three keys typed by hand, each slowly, are no scan
    const slow = harness();
    slow.send('123', 1, SCAN_GAP_MS + 40);
    expect(slow.scans).toEqual([]);
  });
});
