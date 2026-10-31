import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The tab-14 glossary («نقول ولا نقول», apps/web/src/test/glossary.ts) for the messages the API
 * sends: every string literal with Arabic in it under src/, and the core contracts' messages.
 */
const BANNED = [
  'عميل',
  'عملاء',
  'مستهلك',
  'PIN',
  'مزامنة',
  'متزامن',
  'جلسة',
  'جلست',
  'كلمة المرور',
  'تعذّر الاتصال بالخادم',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const STRING = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`]*)`/g;
const ARABIC = /[؀-ۿ]/;

describe('API messages follow the glossary', () => {
  it('no Arabic string literal uses a banned word', () => {
    const roots = [join(__dirname, '../src'), join(__dirname, '../../../packages/core/src/contracts')];
    const offenders: string[] = [];
    for (const file of roots.flatMap(files)) {
      if (file.endsWith('.test.ts')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(STRING)) {
        const text = match[1] ?? match[2] ?? '';
        if (!ARABIC.test(text)) continue;
        const banned = BANNED.filter((word) => text.includes(word));
        if (banned.length > 0) offenders.push(`${file}: ${text} (${banned.join(', ')})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
