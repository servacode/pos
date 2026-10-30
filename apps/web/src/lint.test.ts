// @vitest-environment node
/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Runs the repository's ESLint config on small snippets, as if they were files in apps/web/src.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(code: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}apps/web/src/Snippet.tsx` });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe('ESLint config for the web app', () => {
  it.each([
    'bg-brand-900 p-12',
    'text-white',
    'hover:bg-red-500/40',
    'bg-white/15',
    'fill-brand-600',
    'bg-[#0b8a62]',
    'text-[oklch(0.5_0.1_160)]',
  ])('rejects the palette or raw colour class %s', async (className) => {
    expect(await ruleIds(`export const A = () => <div className="${className}" />;\n`)).toContain(
      'no-restricted-syntax',
    );
  });

  it.each([
    "export const style = { color: '#fff' };\n",
    "export const style = { color: 'rgb(0 0 0 / 0.5)' };\n",
    'export const c = (on: boolean) => `ring-1 ${on ? "" : ""} stroke-white`;\n',
  ])('rejects raw colours in strings and templates: %s', async (code) => {
    expect(await ruleIds(code)).toContain('no-restricted-syntax');
  });

  it.each([
    ['jsx-a11y/alt-text', 'export const A = () => <img src="/logo.png" />;\n'],
    [
      'jsx-a11y/click-events-have-key-events',
      'export const A = (p: { go: () => void }) => <div onClick={p.go}>افتح</div>;\n',
    ],
    ['jsx-a11y/no-autofocus', 'export const A = () => <input aria-label="بحث" autoFocus />;\n'],
    ['jsx-a11y/anchor-is-valid', 'export const A = () => <a href="#">الشروط</a>;\n'],
  ])('runs jsx-a11y: %s', async (rule, code) => {
    expect(await ruleIds(code)).toContain(rule);
  });

  it('accepts colour tokens', async () => {
    const tokens = [
      'bg-surface text-ink-muted border-line-control',
      'hover:bg-brand-hover bg-success-soft text-success-ink',
      'focus-within:ring-ring bg-surface/90 border-danger/25 fill-brand stroke-on-brand',
      'text-2xl size-8 rounded-control',
    ].join(' ');
    expect(await ruleIds(`export const A = () => <div className="${tokens}" />;\n`)).toEqual([]);
  });
});
