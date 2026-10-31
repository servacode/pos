import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setAccessToken } from './src/lib/api';
import { setTestMode } from './src/lib/testMode';

// How long findBy* waits for a render. The default is one second, which is enough on a
// developer's machine and not on a loaded CI runner: the suite failed four times in one
// afternoon, always a findBy* giving up on a screen that does appear, and always green on
// a re-run. Waiting longer does not make a broken screen pass — a render that never comes
// still fails, only later — so this costs nothing but patience on the failing path.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setTestMode(false);
});
