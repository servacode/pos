import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from './lib/api';
import { mockFetch } from './test/fetchMock';
import { makeMe, signedInRefresh, signedOutRefresh } from './test/fixtures';
import { bannedWordsIn, userFacingText } from './test/glossary';
import { renderApp } from './test/renderApp';

describe('glossary wording (tab 14 › الكتابة والرسائل)', () => {
  it('the login page says «كلمة السر» and uses no banned word', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'أهلاً بعودتك' });

    expect(screen.getByLabelText('كلمة السر')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('the home page and its menu use no banned word', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' });

    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('the API fallback messages use the glossary words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const offline = await apiFetch('/v1/anything').catch((error: Error) => error);
    mockFetch({ 'GET /v1/anything': { status: 401 } });
    const expired = await apiFetch('/v1/anything').catch((error: Error) => error);

    expect(offline).toBeInstanceOf(Error);
    expect(expired).toBeInstanceOf(Error);
    expect(bannedWordsIn(`${(offline as Error).message}\n${(expired as Error).message}`)).toEqual([]);
    expect((expired as Error).message).toBe('انتهى دخولك. سجّل الدخول مرة أخرى.');
  });
});
