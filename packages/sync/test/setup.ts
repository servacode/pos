import fc from 'fast-check';

/**
 * Property tests draw a fresh random seed on every run; a failure prints the seed and the shrunk
 * counterexample. Reproduce it with FC_SEED=<seed>, and run longer (e.g. nightly) with FC_NUM_RUNS.
 */
const seed = process.env.FC_SEED;
const numRuns = process.env.FC_NUM_RUNS;
fc.configureGlobal({
  numRuns: numRuns ? Number(numRuns) : 100,
  ...(seed ? { seed: Number(seed) } : {}),
});
