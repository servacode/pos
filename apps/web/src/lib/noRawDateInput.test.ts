import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every source file under a folder, tests left out */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("the product's day fields", () => {
  it("use the shared day-first DateField everywhere (the browser's own date input shows mm/dd/yyyy)", () => {
    const raw = sources(join(__dirname, '..'))
      .filter((file) => !file.endsWith('DateField.tsx'))
      .filter((file) => readFileSync(file, 'utf8').includes('type="date"'));
    expect(raw).toEqual([]);
  });
});
