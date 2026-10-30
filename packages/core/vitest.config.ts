import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Contracts are zod schemas owned and tested with the API; the barrel only re-exports.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/contracts/**'],
      reporter: ['text-summary', 'text', 'html'],
      // The money engine must stay fully exercised (QA review: ≥ 98% of branches).
      thresholds: { branches: 98, functions: 98, lines: 98, statements: 98 },
    },
  },
});
