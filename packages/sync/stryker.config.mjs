// Mutation testing of the sync kernel: document numbering, the payload hash that makes a
// replayed push a no-op, and the protocol that validates what a device sends (ADR-0001).
// Slow, so it never runs on push: nightly in CI, or `pnpm --filter @serva/sync test:mutation`.
// The HTML report lands in coverage/mutation/index.html (ignored by git, Prettier and ESLint).
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/numbering.ts', 'src/hash.ts', 'src/protocol.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  jsonReporter: { fileName: 'coverage/mutation/report.json' },
  htmlReporter: { fileName: 'coverage/mutation/index.html' },
  thresholds: { high: 90, low: 85, break: 100 },
  tempDirName: '.stryker-tmp',
};
