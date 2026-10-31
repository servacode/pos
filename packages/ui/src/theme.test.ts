/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, oklchToRgb, rgbToHex, type Rgb } from './test/color';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appCss = read('./theme.css');
const fontsCss = read('./fonts.css');
const kitCss = read('../../../docs/design/kit/serva-ui.css');
const kitDarkCss = read('../../../docs/design/kit/addon-dark.css');

const SEMANTIC_TOKENS = [
  'canvas',
  'surface',
  'surface-muted',
  'surface-total',
  'line',
  'line-control',
  'ink',
  'ink-muted',
  'ink-subtle',
  'brand',
  'brand-hover',
  'on-brand',
  'brand-soft',
  'brand-ink',
  'ring',
  'success',
  'success-soft',
  'success-ink',
  'warning',
  'warning-soft',
  'warning-ink',
  'danger',
  'on-danger',
  'danger-soft',
  'danger-ink',
  'info',
  'info-soft',
  'info-ink',
] as const;
type Token = (typeof SEMANTIC_TOKENS)[number];

const TEXT = 4.5;
const NON_TEXT = 3;

/**
 * The allowed pairs (tab 14 › الألوان): which foreground may sit on which background, and the WCAG
 * AA minimum it must reach in both modes. Add a pair here before a screen uses it.
 */
const ALLOWED_PAIRS: readonly (readonly [fg: Token, bg: Token, min: number])[] = [
  ...(['ink', 'ink-muted', 'ink-subtle'] as const).flatMap((fg) =>
    (['canvas', 'surface', 'surface-muted'] as const).map((bg) => [fg, bg, TEXT] as const),
  ),
  ['ink', 'surface-total', TEXT],
  ['ink-muted', 'surface-total', TEXT],
  ['on-brand', 'brand', TEXT],
  ['on-brand', 'brand-hover', TEXT],
  ['brand-ink', 'brand-soft', TEXT],
  ['brand-ink', 'surface', TEXT],
  ['brand-ink', 'canvas', TEXT],
  ['success-ink', 'success-soft', TEXT],
  ['warning-ink', 'warning-soft', TEXT],
  ['danger-ink', 'danger-soft', TEXT],
  ['danger-ink', 'surface', TEXT],
  ['danger-ink', 'canvas', TEXT],
  ['info-ink', 'info-soft', TEXT],
  ['on-danger', 'danger', TEXT],
  // The toast: light text on the ink surface (kit .toast).
  ['surface', 'ink', TEXT],
  // Field borders, focus ring and selected/error borders (WCAG 1.4.11).
  ['line-control', 'surface', NON_TEXT],
  ['line-control', 'canvas', NON_TEXT],
  ['ring', 'surface', NON_TEXT],
  ['ring', 'canvas', NON_TEXT],
  ['brand', 'surface', NON_TEXT],
  ['danger', 'surface', NON_TEXT],
];

function section(css: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(css);
  if (!match?.[1]) throw new Error(`Could not find ${label}`);
  return match[1];
}

function appTokens(block: string): Map<string, Rgb> {
  return new Map(
    [...block.matchAll(/--color-([a-z-]+):\s*oklch\(([^)]*)\)/g)].map((m) => [m[1]!, oklchToRgb(m[2]!)]),
  );
}

function tokenOf(tokens: Map<string, Rgb>, name: Token): Rgb {
  const rgb = tokens.get(name);
  if (!rgb) throw new Error(`theme.css does not define --color-${name}`);
  return rgb;
}

function kitTokens(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toUpperCase()]),
  );
}

const MODES = {
  light: {
    app: appTokens(section(appCss, /@theme static \{([\s\S]*?)\n\}/, 'the light @theme block')),
    kit: kitTokens(section(kitCss, /\.sv\{(--canvas[^}]*)\}/, 'the kit .sv tokens')),
  },
  dark: {
    app: appTokens(section(appCss, /:root\s*\{\s*@variant dark\s*\{([\s\S]*?)\}/, 'the dark :root block')),
    kit: kitTokens(section(kitDarkCss, /\.sv\.dark\{([^}]*)\}/, 'the kit .sv.dark tokens')),
  },
};

describe.each(Object.entries(MODES))('design tokens (%s)', (_mode, { app, kit }) => {
  it.each(SEMANTIC_TOKENS)('--color-%s is the exact kit value', (token) => {
    const kitHex = kit.get(token);
    expect(kitHex, `kit defines --${token}`).toBeDefined();
    const appRgb = app.get(token);
    expect(appRgb, `theme.css defines --color-${token}`).toBeDefined();
    expect(rgbToHex(appRgb!)).toBe(kitHex);
  });

  it.each(ALLOWED_PAIRS.map(([fg, bg, min]) => ({ fg, bg, min })))(
    '$fg on $bg reaches $min:1',
    ({ fg, bg, min }) => {
      expect(contrastRatio(tokenOf(app, fg), tokenOf(app, bg))).toBeGreaterThanOrEqual(min);
    },
  );
});

describe('dark mode switch (tab 14 › الوضع الداكن)', () => {
  const variant = section(appCss, /@custom-variant dark \{([\s\S]*?)\n\}/, 'the dark variant');

  it('follows the device unless the root says data-theme="light"', () => {
    expect(variant).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme='light'\]\)/,
    );
  });

  it('is forced on by data-theme="dark", whatever the device says', () => {
    expect(variant).toContain("&:where([data-theme='dark'], [data-theme='dark'] *)");
  });
});

describe('fonts (tab 14 › الخط)', () => {
  const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);

  it('loads IBM Plex Sans Arabic from woff2 files only', () => {
    expect(fontsCss).not.toMatch(/@import ['"]@fontsource/);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/font-family: 'IBM Plex Sans Arabic'/);
      const urls = [...face.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url).toMatch(/\.woff2['"]?$/);
    }
  });

  it('ships exactly three weights, 400, 600 and 700, each with Arabic and Latin', () => {
    const weights = new Set(faces.map((face) => /font-weight: (\d+)/.exec(face)?.[1]));
    expect([...weights].sort()).toEqual(['400', '600', '700']);
    for (const weight of weights) {
      for (const subset of ['arabic', 'latin']) {
        expect(fontsCss).toContain(`ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
      }
    }
  });

  it('is the sans family of the theme', () => {
    expect(appCss).toMatch(/--font-sans: 'IBM Plex Sans Arabic'/);
  });
});
