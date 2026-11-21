import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setAccessToken } from './src/lib/api';
import { setTestMode } from './src/lib/testMode';
import { setClickGuardEnabled } from './src/pos/sale/clickGuard';

// The till's tap guard swallows taps for 350 ms after a panel closes; scripted clicks land inside it
setClickGuardEnabled(false);

// How long findBy* waits for a render. The default is one second, which is enough on a
// developer's machine and not on a loaded CI runner: the suite failed four times in one
// afternoon, always a findBy* giving up on a screen that does appear, and always green on
// a re-run. Waiting longer does not make a broken screen pass — a render that never comes
// still fails, only later — so this costs nothing but patience on the failing path.
configure({ asyncUtilTimeout: 5000 });

// A test starts like a browser that has signed in before (the session note says «in»), so the first
// load asks the server about its session as it does for a real user; a fresh-device test removes it.
beforeEach(() => {
  globalThis.localStorage?.setItem('serva.session', 'in');
});

afterEach(() => {
  cleanup();
  globalThis.sessionStorage?.clear();
  globalThis.localStorage?.removeItem('serva.session');
  vi.unstubAllGlobals();
  setAccessToken(null);
  setTestMode(false);
});
