/** «5:07»: minutes and seconds since `since`, never negative (a clock a little behind the server's). */
export function elapsedText(since: string | number, now: number): string {
  const seconds = Math.max(
    0,
    Math.floor((now - (typeof since === 'number' ? since : Date.parse(since))) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** How late a ticket is: it turns amber after 10 minutes and red after 20 */
export function lateness(since: string, now: number): 'ok' | 'late' | 'very_late' {
  const minutes = (now - Date.parse(since)) / 60_000;
  return minutes >= 20 ? 'very_late' : minutes >= 10 ? 'late' : 'ok';
}

/** A line's price with its choices, for the waiter's totals */
export function lineTotalMinor(
  priceMinor: number,
  choices: readonly { priceMinor: number }[],
  qty: number,
): number {
  return (priceMinor + choices.reduce((sum, c) => sum + c.priceMinor, 0)) * qty;
}
