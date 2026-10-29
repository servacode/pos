import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setAccessToken } from './src/lib/api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAccessToken(null);
});
