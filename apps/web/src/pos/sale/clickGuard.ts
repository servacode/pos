/**
 * A double-click on a button that closes a dialog or a sub-screen (hold, «استلام الجهاز», the size picker)
 * lands its second click on whatever sits under it: a tile. For a moment after any such close the
 * grid ignores picks. One shared clock, armed on every close, read by the tiles.
 */
const GUARD_MS = 350;
let until = 0;

export function armClickGuard(now: number = Date.now()): void {
  until = now + GUARD_MS;
}

export function clicksSwallowed(now: number = Date.now()): boolean {
  return now < until;
}
