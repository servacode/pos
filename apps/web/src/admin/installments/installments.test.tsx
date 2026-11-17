import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  InstalmentSettings,
  InstalmentSummary,
  MeResponse,
  PlanDetail,
  PlanListItem,
  WorklistRow,
} from '@serva/core';
import { DEFAULT_INSTALMENT_SETTINGS } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { reminderLink, whatsappAddress } from './whatsapp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [
        ...base.user.permissions,
        'installments.view',
        'installments.create',
        'installments.manage',
        'receipt.create',
        'settings.manage',
      ],
    },
  };
}

const item = (over: Partial<PlanListItem> = {}): PlanListItem => ({
  id: 'p-1',
  number: 'INV-001-002-0000007',
  customerId: 'c-1',
  customerName: 'مشفى الأمل',
  status: 'active',
  financedMinor: 8_400_000,
  paidMinor: 0,
  remainingMinor: 8_400_000,
  count: 3,
  createdAt: '2026-11-01T08:00:00Z',
  nextDueDate: '2026-12-01',
  nextDueMinor: 2_800_000,
  lateMinor: 0,
  lateCount: 0,
  ...over,
});

const detail = (over: Partial<PlanDetail> = {}): PlanDetail => ({
  ...item(),
  saleNumber: 'INV-001-002-0000007',
  saleId: 's-1',
  customerPhone: '0944555222',
  principalMinor: 8_000_000,
  downPaymentMinor: 2_000_000,
  markupMinor: 400_000,
  markupBp: 500,
  frequency: 'monthly',
  guarantor: { name: 'أبو سامر', phone: '0933000111' },
  borrower: { nationalId: '01010101010' },
  closeReason: null,
  storeName: 'مركز الشفاء',
  noteText: null,
  notePlace: 'حلب',
  notes: [],
  instalments: [
    { no: 1, dueDate: '2026-12-01', amountMinor: 2_800_000, paidMinor: 0, state: 'upcoming', daysLate: 0 },
    { no: 2, dueDate: '2027-01-01', amountMinor: 2_800_000, paidMinor: 0, state: 'upcoming', daysLate: 0 },
    { no: 3, dueDate: '2027-02-01', amountMinor: 2_800_000, paidMinor: 0, state: 'upcoming', daysLate: 0 },
  ],
  payments: [],
  ...over,
});

const summary: InstalmentSummary = {
  dueTodayCount: 1,
  dueTodayMinor: 2_800_000,
  lateCount: 0,
  lateMinor: 0,
  activePlans: 1,
  outstandingMinor: 8_400_000,
};

describe('the reminder', () => {
  it('writes the WhatsApp address of any common phone form, or none', () => {
    expect(whatsappAddress('0944555222')).toBe('963944555222');
    expect(whatsappAddress('+963 944 555 222')).toBe('963944555222');
    expect(whatsappAddress('12')).toBeNull();
    expect(whatsappAddress(null)).toBeNull();
  });

  it('puts the amount, the day and the number in the message, by whether it is before, on or after', () => {
    const base = {
      name: 'أبو خالد',
      amountMinor: 2_800_000,
      currency: 'SYP' as const,
      due: '2026-12-01',
      no: 2,
      of: 6,
      store: 'مركز الشفاء',
    };
    const before = decodeURIComponent(
      reminderLink('0944555222', { ...base, kind: 'before' })!.split('text=')[1]!,
    );
    expect(before).toContain('القسط رقم 2 من 6');
    expect(before).toContain('يستحق بتاريخ 1 كانون الأول 2026');
    const late = decodeURIComponent(
      reminderLink('0944555222', { ...base, kind: 'late', daysLate: 4 })!.split('text=')[1]!,
    );
    expect(late).toContain('تأخر 4 يوماً');
    expect(reminderLink('xx', { ...base, kind: 'due' })).toBeNull();
  });
});

describe('«الأقساط»', () => {
  it('lists the plans with what is left and what falls due today, and opens one', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/installments/summary': () => ({ status: 200, body: summary }),
      'GET /v1/installment-plans?status=active': () => ({
        status: 200,
        body: {
          items: [item(), item({ id: 'p-2', customerName: 'عيادة النور', lateCount: 1, lateMinor: 100_000 })],
          baseCurrency: 'SYP',
          today: '2026-11-17',
        },
      }),
    });
    renderApp('/installments');
    expect(await screen.findByRole('heading', { name: 'الأقساط', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'خطط الأقساط' });
    expect(await within(table).findByText('مشفى الأمل')).toBeInTheDocument();
    expect(within(table).getByText('عيادة النور').closest('tr')).toHaveTextContent('متأخرة');
    expect(within(table).getByRole('link', { name: /مشفى الأمل/ })).toHaveAttribute(
      'href',
      '/installments/p-1',
    );
    expect(document.body).toHaveTextContent('84,000');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('collects on a plan: the amount starts at the next instalment, and the payment goes to the plan', async () => {
    let current = detail();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/installment-plans/p-1': () => ({ status: 200, body: current }),
      'POST /v1/installment-plans/p-1/collect': (r: MockRequest) => {
        const body = r.body as { amountMinor: number };
        current = detail({
          paidMinor: body.amountMinor,
          remainingMinor: 8_400_000 - body.amountMinor,
          instalments: current.instalments.map((i, n) =>
            n === 0 ? { ...i, paidMinor: body.amountMinor, state: 'paid' as const } : i,
          ),
          payments: [{ receiptNumber: 'RCA-1', date: '2026-11-17', no: 1, amountMinor: body.amountMinor }],
        });
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/installments/p-1');
    expect(await screen.findByRole('heading', { name: 'خطة مشفى الأمل', level: 1 })).toBeInTheDocument();
    const schedule = await screen.findByRole('table', { name: 'الأقساط' });
    expect(within(schedule).getAllByRole('row')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'قبض قسط' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/المبلغ/)).toHaveValue('28000');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل القبض' }));
    expect(await screen.findByText('RCA-1')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/installment-plans/p-1/collect').at(-1)?.body).toMatchObject({
      amountMinor: 2_800_000,
      method: 'cash',
    });
  });

  it('cancels a plan only with a reason', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/installment-plans/p-1': () => ({ status: 200, body: detail() }),
      'POST /v1/installment-plans/p-1/cancel': () => ({
        status: 200,
        body: detail({ status: 'cancelled', closeReason: 'ألغاها الزبون', remainingMinor: 0 }),
      }),
    });
    const { user } = renderApp('/installments/p-1');
    await screen.findByRole('table', { name: 'الأقساط' });
    await user.click(screen.getByRole('button', { name: 'ألغِ الخطة' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'ألغِ الخطة' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('السبب'), 'ألغاها الزبون');
    await user.click(within(dialog).getByRole('button', { name: 'ألغِ الخطة' }));
    expect(await screen.findByText(/سبب الإغلاق: ألغاها الزبون/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/installment-plans/p-1/cancel').at(-1)?.body).toEqual({
      reason: 'ألغاها الزبون',
    });
  });

  it('shows who is late with a ready WhatsApp message and logs the click', async () => {
    const row: WorklistRow = {
      planId: 'p-1',
      planNumber: 'INV-001-002-0000007',
      customerId: 'c-1',
      customerName: 'مشفى الأمل',
      phone: '0944555222',
      no: 2,
      of: 6,
      dueDate: '2026-11-12',
      remainingMinor: 7_333_333,
      daysLate: 5,
      lastReminderAt: null,
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/installments/worklist?bucket=remind': () => ({
        status: 200,
        body: { items: [], today: '2026-11-17', baseCurrency: 'SYP' },
      }),
      'GET /v1/installments/worklist?bucket=late': () => ({
        status: 200,
        body: { items: [row], today: '2026-11-17', baseCurrency: 'SYP' },
      }),
      'POST /v1/installments/p-1/2/reminders': () => ({ status: 200, body: { ok: true } }),
    });
    const { user } = renderApp('/installments/due');
    expect(await screen.findByText('لا تذكير مطلوب اليوم.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'متأخرة' }));
    const link = await screen.findByRole('link', { name: /واتساب/ });
    expect(link.getAttribute('href')).toContain('https://wa.me/963944555222?text=');
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('تأخر 5 يوماً');
    expect(screen.getByRole('link', { name: /اتصال/ })).toHaveAttribute('href', 'tel:0944555222');
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(requestsTo('POST', '/v1/installments/p-1/2/reminders').at(-1)?.body).toEqual({ kind: 'late' });
  });

  it('saves the store’s rules: off by default, the owner turns it on', async () => {
    let saved: InstalmentSettings = DEFAULT_INSTALMENT_SETTINGS;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store/installments-settings': () => ({ status: 200, body: saved }),
      'PUT /v1/store/installments-settings': (r: MockRequest) => {
        saved = r.body as InstalmentSettings;
        return { status: 200, body: saved };
      },
    });
    const { user } = renderApp('/installments/settings');
    expect(await screen.findByRole('heading', { name: 'إعدادات التقسيط', level: 1 })).toBeInTheDocument();
    const sw = await screen.findByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText(/حُفظت الإعدادات/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/installments-settings').at(-1)?.body).toMatchObject({
      enabled: true,
      minDownBp: 2000,
      maxCount: 12,
      markupBands: [
        { upToCount: 3, bp: 500 },
        { upToCount: 6, bp: 1000 },
        { upToCount: 12, bp: 2000 },
      ],
    });
  });

  it('puts a wrong value next to its field and sends nothing', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store/installments-settings': () => ({ status: 200, body: DEFAULT_INSTALMENT_SETTINGS }),
      'PUT /v1/store/installments-settings': () => ({ status: 200, body: DEFAULT_INSTALMENT_SETTINGS }),
    });
    const { user } = renderApp('/installments/settings');
    const down = await screen.findByLabelText(/أقل دفعة أولى/);
    await user.clear(down);
    await user.type(down, '150');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اكتب نسبة من 0 إلى 100.')).toBeInTheDocument();
    expect(down).toHaveAttribute('aria-invalid', 'true');
    expect(requestsTo('PUT', '/v1/store/installments-settings')).toHaveLength(0);
  });
});

describe('collecting more than is due', () => {
  it('asks before the rest becomes customer credit, and records only after the yes', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/installment-plans/p-1': () => ({ status: 200, body: detail() }),
      'POST /v1/installment-plans/p-1/collect': () => ({ status: 200, body: detail() }),
    });
    const { user } = renderApp('/installments/p-1');
    await screen.findByRole('table', { name: 'الأقساط' });
    await user.click(screen.getByRole('button', { name: 'قبض قسط' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(/المبلغ/);
    await user.clear(amount);
    await user.type(amount, '100000');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل القبض' }));
    expect(await within(dialog).findByText(/المبلغ أكبر من المستحق/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/installment-plans/p-1/collect')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'نعم، سجّل والباقي رصيد' }));
    await vi.waitFor(() => expect(requestsTo('POST', '/v1/installment-plans/p-1/collect')).toHaveLength(1));
  });
});
