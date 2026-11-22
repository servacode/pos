/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { THEME_STORAGE_KEY } from '@serva/ui';
import { describe, expect, it } from 'vitest';

// The page's first script (index.html) paints the theme saved on this device before any style or
// script loads, so a dark choice never flashes light. It must read the key the app writes.
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');

function boot(saved: string | null) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    beforeParse(window) {
      if (saved !== null) window.localStorage.setItem(THEME_STORAGE_KEY, saved);
    },
  });
  const { document } = dom.window;
  const media = (scheme: string) =>
    document.querySelector(`meta[name="theme-color"][data-scheme="${scheme}"]`)?.getAttribute('media');
  return { dom, root: document.documentElement, media };
}

describe('the theme before the app loads (index.html)', () => {
  it('reads the same key as the app', () => {
    expect(THEME_STORAGE_KEY).toBe('serva.theme');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it.each(['light', 'dark'] as const)('paints a saved «%s» on the root and the browser bar', (theme) => {
    const { root, media } = boot(theme);
    expect(root.dataset.theme).toBe(theme);
    expect(media(theme)).toBe('all');
    expect(media(theme === 'light' ? 'dark' : 'light')).toBe('not all');
  });

  it.each([null, 'system', 'blue'])('follows the device when the saved choice is %s', (saved) => {
    const { root, media } = boot(saved);
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(media('light')).toBe('(prefers-color-scheme: light)');
    expect(media('dark')).toBe('(prefers-color-scheme: dark)');
  });

  it('leaves nothing on window', () => {
    // The same page without its inline script (the element ids are on window either way).
    const withoutScript = html.replace(/<script>[\s\S]*?<\/script>/, '');
    expect(withoutScript).not.toBe(html);
    const before = Object.keys(new JSDOM(withoutScript, { runScripts: 'dangerously' }).window);
    const { dom } = boot('dark');
    const added = Object.keys(dom.window).filter((key) => !before.includes(key));
    expect(added).toEqual([]);
  });
});
