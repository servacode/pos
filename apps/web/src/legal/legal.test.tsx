import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import type { PublicLegal } from '@serva/core';
import { BLANK_LABELS, LEGAL, legalReady, mergeLegal, remainingBlanks } from './config';
import { CLAUSE_NAMES, markersOf } from './fill';
import { PRIVACY } from './privacy';
import { TERMS } from './terms';
import type { LegalDocument } from './types';

const textsOf = (doc: LegalDocument): string[] => [
  doc.summary,
  ...doc.sections.flatMap((s) => [s.text ?? '', ...(s.table?.rows.flat() ?? [])]),
];

const SAVED: PublicLegal = {
  companyName: 'شركة المثال المحدودة',
  ownerName: 'أحمد المثال',
  commercialRegister: '',
  address: 'دمشق، المزة',
  email: 'legal@example.com',
  supportWhatsapp: '+963912345678',
  phone: '',
  governingCity: 'دمشق',
  financialRetention: 'عشر سنوات',
  paymentTolerance: '1%',
  hostingProvider: 'مزوّد',
  hostingCountry: 'ألمانيا',
  backupProvider: 'نسخ',
  smsProvider: 'رسائل',
  aiProvider: 'ذكاء',
  reviewedByLawyer: true,
  updatedAt: '2026-11-13',
  version: TERMS_VERSION,
};

describe('the legal config', () => {
  it('lists the blanks still to fill before launch', () => {
    const blanks = remainingBlanks();
    // The owner's to-do list: each name is a key of LEGAL (apps/web/src/legal/config.ts).
    console.info(`Legal blanks still to fill (${blanks.length}): ${blanks.join(', ')}`);
    for (const key of blanks) expect(BLANK_LABELS, `${key} needs a label`).toHaveProperty(key);
    expect(legalReady()).toBe(blanks.length === 0 && LEGAL.reviewedByLawyer);
    expect(blanks).not.toContain('commercialRegister');
    expect(blanks).not.toContain('phone');
  });

  it('has the same version as the one registration sends', () => {
    expect(LEGAL.version).toBe(TERMS_VERSION);
  });

  it('turns an empty saved text back into a blank, and ignores a missing answer', () => {
    expect(mergeLegal(null)).toBe(LEGAL);
    const merged = mergeLegal({ ...SAVED, address: '' });
    expect(merged.address).toBeNull();
    expect(merged.companyName).toBe('شركة المثال المحدودة');
    expect(legalReady(merged)).toBe(false);
    expect(legalReady(mergeLegal(SAVED))).toBe(true);
  });

  it('knows every {marker} the texts use', () => {
    for (const doc of [TERMS, PRIVACY]) {
      for (const marker of textsOf(doc).flatMap(markersOf))
        expect(CLAUSE_NAMES.includes(marker) || marker in LEGAL, marker).toBe(true);
    }
  });
});

describe('the legal pages', () => {
  it('shows the terms at /terms with the version, a contents list and numbered clauses', async () => {
    mockFetch({ 'GET /v1/legal': { status: 200, body: SAVED } });
    renderApp('/terms');

    expect(await screen.findByRole('heading', { level: 1, name: 'شروط الاستخدام' })).toBeInTheDocument();
    await screen.findByLabelText('المحتويات');
    expect(screen.getByText(/^الإصدار/)).toHaveTextContent(TERMS_VERSION);
    expect(screen.getByText(/^آخر تحديث/)).toHaveTextContent(SAVED.updatedAt);
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
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('row')).toHaveLength(PRIVACY.sections[1]!.table!.rows.length + 1);
    expect(screen.getByRole('link', { name: 'شروط الاستخدام' })).toHaveAttribute('href', '/terms');
  });

  it('marks every blank with a visible placeholder when the details never load', async () => {
    mockFetch({ 'GET /v1/legal': { status: 500, body: { code: 'internal', message: 'x' } } });
    renderApp('/terms');

    expect(await screen.findByText('مسودة قيد المراجعة القانونية')).toBeInTheDocument();
    const marks = [...document.querySelectorAll('mark[data-blank]')];
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(mark).toHaveTextContent('[يُحدَّد لاحقاً]');
    expect(document.querySelector('mark[data-blank="ownerName"]')).not.toBeNull();
    expect(document.querySelector('mark[data-blank="commercialRegister"]')).toBeNull();
  });

  it('does not crash when the request fails outright', async () => {
    mockFetch({});
    renderApp('/privacy');
    expect(await screen.findByText('مسودة قيد المراجعة القانونية')).toBeInTheDocument();
  });

  it('does not crash when the answer is not the details', async () => {
    mockFetch({ 'GET /v1/legal': { status: 200, body: { companyName: 5 } } });
    renderApp('/privacy');
    expect(await screen.findByText('مسودة قيد المراجعة القانونية')).toBeInTheDocument();
  });

  it('shows a loading note first, then the platform’s details in the texts', async () => {
    mockFetch({ 'GET /v1/legal': { status: 200, body: SAVED } });
    renderApp('/terms');

    expect(screen.getByRole('status')).toHaveTextContent('جارٍ تحميل');
    const parties = await screen.findByRole('heading', { level: 2, name: /الأطراف/ });
    const text = parties.closest('section')!.textContent;
    expect(text).toContain('المملوكة لـشركة المثال المحدودة، وصاحب المشروع أحمد المثال.');
    // No commercial register: the sentence ends without it and shows no placeholder.
    expect(text).not.toContain('برقم');
    expect(document.querySelector('mark[data-blank="commercialRegister"]')).toBeNull();
    const contact = document.querySelector('#contact')!.textContent;
    expect(contact).toContain('legal@example.com');
    expect(contact).toContain('+963912345678');
    expect(contact).not.toContain('الهاتف');
    // Every blank is filled and the lawyer reviewed it: no draft notice.
    expect(screen.queryByText('مسودة قيد المراجعة القانونية')).toBeNull();
  });

  it('names the commercial register and the phone when they are filled', async () => {
    mockFetch({
      'GET /v1/legal': {
        status: 200,
        body: { ...SAVED, commercialRegister: '12345', phone: '+963933111222' },
      },
    });
    renderApp('/terms');

    const parties = await screen.findByRole('heading', { level: 2, name: /الأطراف/ });
    expect(parties.closest('section')!.textContent).toContain(
      'المملوكة لـشركة المثال المحدودة، المسجّلة في سوريا برقم 12345، وصاحب المشروع أحمد المثال.',
    );
    expect(document.querySelector('#contact')!.textContent).toContain('، الهاتف +963933111222');
  });

  it('keeps the draft notice for a blank that was cleared, or a text the lawyer has not reviewed', async () => {
    mockFetch({
      'GET /v1/legal': { status: 200, body: { ...SAVED, hostingProvider: '', reviewedByLawyer: false } },
    });
    renderApp('/privacy');
    expect(await screen.findByText(/بقيت 1 خانات فارغة/)).toBeInTheDocument();
    expect(document.querySelector('mark[data-blank="hostingProvider"]')).not.toBeNull();
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
