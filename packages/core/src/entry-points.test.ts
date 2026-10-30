import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from './index';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
  sideEffects?: boolean;
  exports: Record<string, string>;
};
const subpaths = Object.entries(pkg.exports).filter(([path]) => path !== '.' && !path.includes('*'));

/** Relative imports of a module, resolved to files, followed transitively; bare imports are collected. */
function importGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    const specifiers = source.matchAll(/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g);
    for (const [, specifier = ''] of specifiers) {
      if (specifier.startsWith('.')) visit(resolve(dirname(file), `${specifier}.ts`));
      else packages.add(specifier);
    }
  };
  visit(entry);
  return { files, packages };
}

describe('@serva/core entry points', () => {
  it('is marked free of side effects so bundlers can drop unused modules', () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it('maps every subpath to an existing module the root re-exports unchanged', async () => {
    expect(subpaths.map(([path]) => path)).toEqual(
      expect.arrayContaining(['./money', './pricing', './currencies', './text']),
    );
    for (const [path, target] of subpaths) {
      const file = resolve(packageDir, target);
      expect(existsSync(file), path).toBe(true);
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        expect(root[name as keyof typeof root], `${path} → ${name}`).toBe(value);
      }
    }
  });

  it('keeps zod out of the money, pricing, currency and text entries used on the client', () => {
    // The scan does see imports: the contracts pull zod, and money pulls currencies and text.
    expect([...importGraph(resolve(packageDir, 'src/contracts/auth.ts')).packages]).toContain('zod');
    const money = [...importGraph(resolve(packageDir, 'src/money.ts')).files].map((f) => basename(f));
    expect(money).toEqual(expect.arrayContaining(['currencies.ts', 'text.ts']));
    for (const path of ['./money', './pricing', './currencies', './text', './phone']) {
      const target = pkg.exports[path] ?? '';
      const { files, packages } = importGraph(resolve(packageDir, target));
      expect([...packages], path).toEqual([]);
      expect(
        [...files].some((file) => file.includes('/contracts/')),
        path,
      ).toBe(false);
    }
  });
});
