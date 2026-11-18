import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeviceStore } from '../offline/database';
import { renderApp } from '../test/renderApp';
import './RepApp';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
});
afterEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();
  await resetDeviceStore();
});

describe('the rep’s phone (/rep)', () => {
  it('asks to link the phone to its van when it is not linked yet', async () => {
    renderApp('/rep');
    expect(await screen.findByRole('heading', { name: 'هل هذا جوال المندوب؟' })).toBeInTheDocument();
  });

  it('opens the same linking from the link a rep_phone pairing carries', async () => {
    renderApp('/link?kind=rep_phone');
    expect(await screen.findByRole('heading', { name: 'هل هذا جوال المندوب؟' })).toBeInTheDocument();
  });
});
