// Mutation testing of the money engine (QA review: mutation score ≥ 85%). It is slow, so it runs nightly
// only, never on push: `pnpm --filter @serva/core test:mutation`. The HTML report lands in
// coverage/mutation/index.html (already ignored by git, Prettier and ESLint).
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/money.ts', 'src/pricing.ts', 'src/sale.ts', 'src/currencies.ts', 'src/text.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'coverage/mutation/index.html' },
  thresholds: { high: 90, low: 85, break: 85 },
  tempDirName: '.stryker-tmp',
};
