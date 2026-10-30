// Colour maths for the design-token tests: oklch → 8-bit sRGB (what the screen shows) and the
// WCAG 2 contrast ratio. Formulas from https://bottosson.github.io/posts/oklab/ and WCAG 2.2 §1.4.3.

export type Rgb = readonly [number, number, number];

function toByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

/** Parses the inside of `oklch(L C H)` (L as 0–1) into the 8-bit sRGB colour it renders as. */
export function oklchToRgb(value: string): Rgb {
  const [l = NaN, c = NaN, h = NaN] = value.trim().split(/\s+/).map(Number);
  if ([l, c, h].some(Number.isNaN)) throw new Error(`Not an oklch triple: ${value}`);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  return [
    toByte(4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2]),
    toByte(-1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2]),
    toByte(-0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2]),
  ];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
