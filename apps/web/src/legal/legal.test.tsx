import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { BLANK_LABELS, LEGAL, LEGAL_READY, remainingBlanks } from './config';
import { markersOf } from './fill';
import { PRIVACY } from './privacy';
import { TERMS } from './terms';
import type { LegalDocument } from './types';

const textsOf = (doc: LegalDocument): string[] => [
  doc.summary,
  ...doc.sections.flatMap((s) => [s.text ?? '', ...(s.table?.rows.flat() ?? [])]),
];

describe('the legal config', () => {
  it('lists the blanks still to fill before launch', () => {
    const blanks = remainingBlanks();
    // The owner's to-do list: each name is a key of LEGAL (apps/web/src/legal/config.ts).
    console.info(`Legal blanks still to fill (${blanks.length}): ${blanks.join(', ')}`);
    for (const key of blanks) expect(BLANK_LABELS, `${key} needs a label`).toHaveProperty(key);
    expect(LEGAL_READY).toBe(blanks.length === 0 && LEGAL.reviewedByLawyer);
  });

  it('has the same version as the one registration sends', () => {
    expect(LEGAL.version).toBe(TERMS_VERSION);
  });

  it('knows every {marker} the texts use', () => {
    for (const doc of [TERMS, PRIVACY]) {
      for (const marker of textsOf(doc).flatMap(markersOf)) expect(LEGAL).toHaveProperty(marker);
    }
  });
});

describe('the legal pages', () => {
  it('shows the terms at /terms with the version, a contents list and numbered clauses', async () => {
    mockFetch({});
    renderApp('/terms');

    expect(await screen.findByRole('heading', { level: 1, name: 'شروط الاستخدام' })).toBeInTheDocument();
    expect(screen.getByText(/^الإصدار/)).toHaveTextContent(TERMS_VERSION);
    expect(screen.getByText(/^آخر تحديث/)).toHaveTextContent(LEGAL.updatedAt);
    const contents = screen.getByRole('navigation', { name: 'المحتويات' });
    expect(within(contents).getAllByRole('link')).toHaveLength(TERMS.sections.length);
    expect(within(contents).getByRole('link', { name: 'ملكية البيانات' })).toHaveAttribute(
      'href',
      '#data-ownership',
    );
    expect(screen.getByRole('heading', { level: 2, name: /ملكية البيانات/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'سياسة الخصوصية' })).toHaveAttribute('href', '/privacy');
  });

  it('shows the privacy policy at /privacy with its retention table', async () => {
    mockFetch({});
    renderApp('/privacy');

    expect(await screen.findByRole('heading', { level: 1, name: 'سياسة الخصوصية' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('row')).toHaveLength(PRIVACY.sections[1]!.table!.rows.length + 1);
    expect(screen.getByRole('link', { name: 'شروط الاستخدام' })).toHaveAttribute('href', '/terms');
  });

  it('marks every blank with a visible placeholder and says the text is a draft', async () => {
    mockFetch({});
    renderApp('/terms');

    await screen.findByRole('heading', { level: 1, name: 'شروط الاستخدام' });
    const marks = [...document.querySelectorAll('mark[data-blank]')];
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(mark).toHaveTextContent('[يُحدَّد لاحقاً]');
    if (!LEGAL_READY) expect(screen.getByText('مسودة قيد المراجعة القانونية')).toBeInTheDocument();
  });
});

describe('the links to the legal pages', () => {
  it('opens the terms and the privacy policy in a new tab from the sign-up page', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/register');

    const terms = await screen.findByRole('link', { name: 'الشروط' });
    const privacy = screen.getByRole('link', { name: 'سياسة الخصوصية' });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(privacy).toHaveAttribute('href', '/privacy');
    for (const link of [terms, privacy]) expect(link).toHaveAttribute('target', '_blank');
  });

  it('links them from the sign-in page too', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/login');

    expect(await screen.findByRole('link', { name: 'الشروط' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'سياسة الخصوصية' })).toHaveAttribute('href', '/privacy');
  });
});
