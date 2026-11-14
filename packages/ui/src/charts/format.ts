import type { Digits } from '../context';
import { displayNumber } from '../NumberField';

/** Bidi controls (formatMoney wraps an amount in isolates): invisible, so never counted in a width. */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A real number to draw: not null, not NaN, not infinite. */
export function isValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const LRI = '\u2066';
const PDI = '\u2069';

/**
 * A minus with its digits, kept left to right: alone in an Arabic line a leading «−» would jump to
 * the far side («300−»). formatMoney isolates its amounts the same way.
 */
function negative(text: string): string {
  return `${LRI}−${text}${PDI}`;
}

/** A number in the store's digits, grouped, up to two decimals: «1,250», «2.5», «−300». */
export function formatNumber(value: number, digits: Digits): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  const text = displayNumber(String(Math.abs(rounded)), digits);
  return rounded < 0 ? negative(text) : text;
}

const compactFormats = new Map<Digits, Intl.NumberFormat>();

/**
 * An axis number (marks-and-anatomy › ticks): in full under a thousand, then short in Arabic words
 * with their plural («5 آلاف», «12.5 ألف», «1.25 مليون»), so one axis keeps one style; in the
 * store's digits.
 */
export function compactNumber(value: number, digits: Digits): string {
  if (Math.abs(value) < 1000) return formatNumber(value, digits);
  let format = compactFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(digits === 'arab' ? 'ar-u-nu-arab' : 'ar-u-nu-latn', {
      notation: 'compact',
      maximumFractionDigits: 2,
    });
    compactFormats.set(digits, format);
  }
  const text = format.format(Math.abs(value));
  // «−5 آلاف»: the minus joins the number, the word follows in the Arabic line.
  return value < 0 ? text.replace(/^[^\s]+/, negative) : text;
}

/** A share of a whole: «62%», one decimal under ten («4.5%»), «٦٢٪» in Arabic-Indic digits. */
export function formatShare(fraction: number, digits: Digits): string {
  const percent = Number.isFinite(fraction) ? fraction * 100 : 0;
  const shown = percent > 0 && percent < 10 ? Math.round(percent * 10) / 10 : Math.round(percent);
  return `${displayNumber(String(shown), digits)}${digits === 'arab' ? '٪' : '%'}`;
}

const DIGIT = /[0-9٠-٩]/;
const NARROW = /[\s.,:/٫٬،%٪−-]/;

/** Without a canvas (tests): a digit 0.54 em, an Arabic letter 0.45–0.55, a separator 0.3, rounded up. */
function estimate(text: string, size: number): number {
  let em = 0;
  for (const char of text) em += DIGIT.test(char) ? 0.57 : NARROW.test(char) ? 0.32 : 0.54;
  return em * size;
}

let pen: CanvasRenderingContext2D | null | undefined;
let family = 'sans-serif';
const widths = new Map<string, number>();

function canvasPen(): CanvasRenderingContext2D | null {
  if (pen !== undefined) return pen;
  pen = null;
  // jsdom (the tests) has no canvas; asking for one only logs «not implemented».
  if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)) return pen;
  try {
    pen = document.createElement('canvas').getContext('2d');
    family = getComputedStyle(document.body).fontFamily || family;
  } catch {
    pen = null;
  }
  return pen;
}

/**
 * How wide a short label is at `size` px in the page's font (IBM Plex Sans Arabic), with a little to
 * spare: Arabic ligatures make letter counts useless («الثلاثاء» is narrower than «الخميس»). Used to
 * space axis labels and to decide whether a value fits on its bar, never to clip one.
 */
export function textWidth(text: string, size = 12, weight = 400): number {
  const clean = text.replace(BIDI_CONTROLS, '');
  const context = canvasPen();
  if (!context) return estimate(clean, size);
  const key = `${weight} ${size} ${clean}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  context.font = `${weight} ${size}px ${family}`;
  const width = context.measureText(clean).width * 1.05 + 1;
  // Widths in a fallback font (before the web font loads) are not kept.
  if (document.fonts?.status === 'loaded') {
    if (widths.size > 2000) widths.clear();
    widths.set(key, width);
  }
  return width;
}
