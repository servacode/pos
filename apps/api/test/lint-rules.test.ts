/* eslint-disable no-restricted-syntax -- this file holds the forbidden patterns as lint input */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function messagesFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}/${filePath}` });
  return (result?.messages ?? []).map((m) => m.message);
}

describe('lint rules guarding the store context (row-level security)', () => {
  it('refuses sql.raw in the API', async () => {
    const messages = await messagesFor(
      "import { sql } from 'drizzle-orm';\nexport const q = sql.raw('select 1');\n",
      'apps/api/src/probe.ts',
    );
    expect(messages.some((m) => m.includes('sql.raw is only allowed inside packages/db.'))).toBe(true);
  });

  it('refuses set_config and app.tenant_id in the API', async () => {
    const messages = await messagesFor(
      "import { sql } from 'drizzle-orm';\nexport const a = sql`select set_config('app.tenant_id', ${'x'}, true)`;\nexport const b = 'app.tenant_id';\n",
      'apps/api/src/probe.ts',
    );
    expect(messages.filter((m) => m.includes('withTenant()'))).toHaveLength(2);
  });

  it('allows them inside packages/db, where withTenant() lives', async () => {
    const messages = await messagesFor(
      "import { sql } from 'drizzle-orm';\nexport const a = sql`select set_config('app.tenant_id', ${'x'}, true)`;\nexport const q = sql.raw('select 1');\n",
      'packages/db/src/probe.ts',
    );
    expect(messages).toEqual([]);
  });
});
