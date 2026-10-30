// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('build target', () => {
  it('matches the support matrix of tab 15: Chrome/Edge/WebView 111+, Safari 16.4', () => {
    expect(viteConfig.build?.target).toEqual(['chrome111', 'edge111', 'safari16.4']);
  });
});

describe('fonts (tab 14 › الخط)', () => {
  const css = `${read('./styles.css')}\n${read('./fonts.css')}`;
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);

  it('loads IBM Plex Sans Arabic from woff2 files only', () => {
    expect(css).not.toMatch(/@import ['"]@fontsource/);
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
        expect(css).toContain(`ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
      }
    }
  });
});
