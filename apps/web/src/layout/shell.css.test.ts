// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom does not run media queries, so the shell's promises about touch size, motion and logical
// properties are read from its stylesheet.
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the shell stylesheet', () => {
  it('gives every target 44 px on a phone', () => {
    expect(phone).toMatch(/\.sh-ibtn \{[^}]*width: 44px;[^}]*height: 44px/);
    expect(phone).toMatch(/\.sh-mi \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.sh-drawer \.sh-it \{[^}]*height: 44px/);
  });

  it('starts every animation inside prefers-reduced-motion: no-preference', () => {
    const guard = '@media (prefers-reduced-motion: no-preference)';
    let from = 0;
    let found = 0;
    for (let at = body.indexOf('animation:'); at !== -1; at = body.indexOf('animation:', from)) {
      from = at + 1;
      // the nearest media query before it is the guard
      const media = body.lastIndexOf('@media', at);
      const keyframes = body.lastIndexOf('@keyframes', at);
      if (keyframes > media) continue;
      found += 1;
      expect(body.startsWith(guard, media)).toBe(true);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('uses logical properties and tokens only: no left/right, no raw hex colours', () => {
    expect(body).not.toMatch(/(?:margin|padding|border)-(?:left|right)|text-align:\s*(?:left|right)/);
    expect(body).not.toMatch(/#(?!0{3,4}\b)[0-9a-fA-F]{3,8}\b/);
  });
});
