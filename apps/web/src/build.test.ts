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

describe('one source for the design (tab 14 › مصدر واحد)', () => {
  const styles = read('./styles.css');

  it('takes its theme from @serva/ui and defines no token of its own', () => {
    expect(styles).toMatch(/@import 'tailwindcss';\s*@import '@serva\/ui\/theme\.css';/);
    expect(styles).not.toMatch(/@theme|--color-|--font-|@font-face/);
  });

  it('loads the fonts of @serva/ui', () => {
    expect(read('./main.tsx')).toContain("import '@serva/ui/fonts.css';");
  });
});
