/**
 * The scan sound: one short high tone when an item is found, a lower double tone when the code is
 * unknown. Web Audio only, made on first use (a browser starts audio after a tap, and a till has had
 * many); any failure (no audio, jsdom, blocked) is silent.
 */
let context: AudioContext | null = null;

function tone(ctx: AudioContext, at: number, hz: number, seconds: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** Plays the scan sound; `on` false (the store muted it) does nothing. */
export function scanBeep(kind: 'ok' | 'error', on = true): void {
  if (!on) return;
  try {
    const Audio = typeof window === 'undefined' ? undefined : window.AudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    if (kind === 'ok') {
      tone(context, now, 1320, 0.09);
    } else {
      tone(context, now, 330, 0.14);
      tone(context, now + 0.18, 260, 0.2);
    }
  } catch {
    // No sound is not a failure of the sale
  }
}
