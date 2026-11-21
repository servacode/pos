import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitchenResponse, KitchenTicket } from '@serva/core';
import type { HallAnswer, HallApi } from '../api';
import { KitchenScreen } from './KitchenScreen';

const NOW = Date.parse('2026-11-12T10:12:00.000Z');

function ticket(over: Partial<KitchenTicket> & { id: string }): KitchenTicket {
  return {
    seq: 1,
    section: 'مشاوي',
    table: '5',
    kind: 'new',
    createdAt: '2026-11-12T10:10:00.000Z',
    lines: [
      {
        id: `${over.id}-l1`,
        name: 'كباب',
        qty: 2,
        choices: ['حار'],
        note: 'بدون بصل',
        seat: 3,
        status: 'sent',
        readyAt: null,
        cancelReason: null,
      },
    ],
    ...over,
  };
}

function board(tickets: KitchenTicket[], sections = ['مشاوي', 'مشروبات']): KitchenResponse {
  return { tickets, sections, serverTime: new Date(NOW).toISOString() };
}

const ok = <T,>(body: T): HallAnswer<T> => ({ kind: 'ok', body });

/** A kitchen API that applies status commands to its own tickets */
function fakeApi(initial: KitchenTicket[]) {
  let tickets = initial;
  const commands: unknown[] = [];
  const api: HallApi = {
    hall: vi.fn(),
    command: vi.fn(),
    menu: vi.fn(),
    kitchen: vi.fn(async () => ok(board(tickets))),
    kitchenCommand: vi.fn(async (command) => {
      commands.push(command);
      if (command.type === 'status') {
        tickets = tickets.map((t) => ({
          ...t,
          lines: t.lines.map((l) => (command.lineIds.includes(l.id) ? { ...l, status: command.status } : l)),
        }));
      } else {
        tickets = tickets
          .map((t) => ({ ...t, lines: t.lines.filter((l) => !command.lineIds.includes(l.id)) }))
          .filter((t) => t.lines.length > 0);
      }
      return ok(board(tickets));
    }),
  };
  return { api, commands, set: (next: KitchenTicket[]) => (tickets = next) };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the kitchen screen', () => {
  it('lists tickets with the table, section, choices, note, seat and the time since they were sent', async () => {
    const { api } = fakeApi([
      ticket({ id: 't1' }),
      ticket({ id: 't2', table: 'VIP', kind: 'add', section: 'مشروبات' }),
    ]);
    render(<KitchenScreen api={api} deviceName="شاشة المطبخ" now={() => NOW} />);
    const first = await screen.findByRole('region', { name: 'تذكرة طاولة 5 مشاوي' });
    expect(within(first).getByText('كباب')).toBeInTheDocument();
    expect(within(first).getByText('حار')).toBeInTheDocument();
    expect(within(first).getByText('بدون بصل')).toBeInTheDocument();
    expect(within(first).getByText('مقعد 3')).toBeInTheDocument();
    expect(within(first).getByLabelText('مضى على الطلب')).toHaveTextContent('2:00');
    expect(within(first).getByText('جديد')).toBeInTheDocument();
    const second = screen.getByRole('region', { name: 'تذكرة طاولة VIP مشروبات' });
    expect(within(second).getByText('إضافة')).toBeInTheDocument();
  });

  it('walks a line from new to قيد التحضير to جاهز with big buttons', async () => {
    const user = userEvent.setup();
    const { api, commands } = fakeApi([ticket({ id: 't1' })]);
    render(<KitchenScreen api={api} now={() => NOW} />);
    await user.click(await screen.findByRole('button', { name: 'ابدأ التحضير: كباب' }));
    await screen.findByText('قيد التحضير');
    await user.click(screen.getByRole('button', { name: 'جاهز: كباب' }));
    await waitFor(() => expect(screen.getAllByText('جاهز').length).toBeGreaterThan(0));
    expect(commands).toEqual([
      { type: 'status', lineIds: ['t1-l1'], status: 'preparing' },
      { type: 'status', lineIds: ['t1-l1'], status: 'ready' },
    ]);
    // A ready line can be taken back
    await user.click(screen.getByRole('button', { name: 'تراجع: كباب' }));
    await screen.findByText('قيد التحضير');
  });

  it('marks every open line of a ticket ready at once', async () => {
    const user = userEvent.setup();
    const two = ticket({ id: 't1' });
    two.lines.push({ ...two.lines[0]!, id: 't1-l2', name: 'شيش طاووق' });
    const { api, commands } = fakeApi([two]);
    render(<KitchenScreen api={api} now={() => NOW} />);
    await user.click(await screen.findByRole('button', { name: 'الكل جاهز' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toEqual({ type: 'status', lineIds: ['t1-l1', 't1-l2'], status: 'ready' });
  });

  it('filters by section and remembers the choice on this device', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([ticket({ id: 't1' }), ticket({ id: 't2', table: '9', section: 'مشروبات' })]);
    const view = render(<KitchenScreen api={api} now={() => NOW} />);
    await screen.findByRole('region', { name: 'تذكرة طاولة 9 مشروبات' });
    const nav = screen.getByRole('navigation', { name: 'الأقسام' });
    await user.click(within(nav).getByRole('button', { name: 'مشروبات' }));
    expect(screen.queryByRole('region', { name: 'تذكرة طاولة 5 مشاوي' })).toBeNull();
    expect(screen.getByRole('region', { name: 'تذكرة طاولة 9 مشروبات' })).toBeInTheDocument();
    view.unmount();
    render(<KitchenScreen api={api} now={() => NOW} />);
    await screen.findByRole('region', { name: 'تذكرة طاولة 9 مشروبات' });
    expect(screen.queryByRole('region', { name: 'تذكرة طاولة 5 مشاوي' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'كل الأقسام' }));
    expect(await screen.findByRole('region', { name: 'تذكرة طاولة 5 مشاوي' })).toBeInTheDocument();
  });

  it('shows a cancelled line with its reason until the section says «علمت»', async () => {
    const user = userEvent.setup();
    const t = ticket({ id: 't1' });
    t.lines[0] = { ...t.lines[0]!, status: 'cancelled', cancelReason: 'غيّر الزبون رأيه' };
    const { api, commands } = fakeApi([t]);
    render(<KitchenScreen api={api} now={() => NOW} />);
    expect(await screen.findByText(/غيّر الزبون رأيه/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'علمت' }));
    expect(commands).toEqual([{ type: 'ack', lineIds: ['t1-l1'] }]);
    expect(await screen.findByText('لا طلبات الآن')).toBeInTheDocument();
  });

  it('flashes the bar for a ticket that arrives after the first load, polling by itself', async () => {
    const fake = fakeApi([ticket({ id: 't1' })]);
    render(<KitchenScreen api={fake.api} pollMs={30} now={() => NOW} />);
    await screen.findByRole('region', { name: 'تذكرة طاولة 5 مشاوي' });
    expect(screen.queryByText('تذكرة جديدة')).toBeNull();
    fake.set([ticket({ id: 't1' }), ticket({ id: 't2', table: '8' })]);
    expect(await screen.findByText('تذكرة جديدة')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'تذكرة طاولة 8 مشاوي' })).toBeInTheDocument();
  });

  it('says so when the server cannot be reached, keeps the last tickets, and shows a refusal', async () => {
    const fake = fakeApi([ticket({ id: 't1' })]);
    render(<KitchenScreen api={fake.api} pollMs={30} now={() => NOW} />);
    await screen.findByRole('region', { name: 'تذكرة طاولة 5 مشاوي' });
    vi.mocked(fake.api.kitchen).mockResolvedValue({ kind: 'network' });
    expect(await screen.findByText(/لا يوجد اتصال بالخادم/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'تذكرة طاولة 5 مشاوي' })).toBeInTheDocument();
    vi.mocked(fake.api.kitchen).mockResolvedValue({
      kind: 'refused',
      message: 'أُوقف هذا الجهاز من حساب المالك.',
      code: 'device_revoked',
      status: 403,
    });
    expect(await screen.findByText('أُوقف هذا الجهاز من حساب المالك.')).toBeInTheDocument();
  });

  it('shows a refused or lost command and reloads', async () => {
    const user = userEvent.setup();
    const fake = fakeApi([ticket({ id: 't1' })]);
    vi.mocked(fake.api.kitchenCommand).mockResolvedValueOnce({
      kind: 'refused',
      message: 'تغيّرت حالة هذا البند. حدّث الشاشة.',
      code: 'conflict',
      status: 409,
    });
    render(<KitchenScreen api={fake.api} now={() => NOW} />);
    await user.click(await screen.findByRole('button', { name: 'ابدأ التحضير: كباب' }));
    expect(await screen.findByText('تغيّرت حالة هذا البند. حدّث الشاشة.')).toBeInTheDocument();
    vi.mocked(fake.api.kitchenCommand).mockResolvedValueOnce({ kind: 'network' });
    await user.click(screen.getByRole('button', { name: 'ابدأ التحضير: كباب' }));
    expect(await screen.findByText(/لا يوجد اتصال بالخادم. أعد المحاولة/)).toBeInTheDocument();
  });

  it('turns the ticket amber after ten minutes and red after twenty, and toggles the sound', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([
      ticket({ id: 'late', table: '1', createdAt: '2026-11-12T10:00:00.000Z' }),
      ticket({ id: 'very', table: '2', createdAt: '2026-11-12T09:40:00.000Z' }),
    ]);
    render(<KitchenScreen api={api} now={() => NOW} />);
    expect(await screen.findByRole('region', { name: 'تذكرة طاولة 1 مشاوي' })).toHaveClass('border-warning');
    expect(screen.getByRole('region', { name: 'تذكرة طاولة 2 مشاوي' })).toHaveClass('border-danger');
    await user.click(screen.getByRole('button', { name: 'الصوت متوقف' }));
    expect(screen.getByRole('button', { name: 'الصوت يعمل' })).toBeInTheDocument();
  });
});
