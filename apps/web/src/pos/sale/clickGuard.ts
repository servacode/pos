/**
 * A double-click on a button that closes a dialog or a sub-screen (hold, «استلام الجهاز», the size picker)
 * lands its second click on whatever sits under it: a tile. For a moment after such a close the grid
 * ignores taps. Keyboard picks (Enter on a search result, a scan) never consult it, and it is armed only
 * when a dialog or a sub-screen actually closes back to the grid.
 *
 * Tests switch it off (vitest.setup.ts) because a scripted click lands within the window on a fast
 * runner; the guard's own tests switch it back on.
 */
const GUARD_MS = 350;
let until = 0;
let enabled = true;

export function setClickGuardEnabled(on: boolean): void {
  enabled = on;
  if (!on) until = 0;
}

export function armClickGuard(now: number = Date.now()): void {
  if (enabled) until = now + GUARD_MS;
}

export function clicksSwallowed(now: number = Date.now()): boolean {
  return enabled && now < until;
}
