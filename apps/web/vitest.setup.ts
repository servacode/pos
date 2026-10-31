import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setAccessToken } from './src/lib/api';
import { setTestMode } from './src/lib/testMode';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setTestMode(false);
});
