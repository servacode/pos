import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HallCommand,
  HallLine,
  HallLineInput,
  HallMenuResponse,
  HallOrder,
  StaffSessionResponse,
} from '@serva/core';
import type { HallAnswer, HallApi } from '../api';
import type { SignIn } from './WaiterScreen';
import { WaiterScreen } from './WaiterScreen';

const WAITER = '0192a000-0000-7000-8000-000000000011';
const MANAGER = '0192a000-0000-7000-8000-000000000012';
const COFFEE = {
  productId: '0192a000-0000-7000-8000-0000000000e1',
  variantId: '0192a000-0000-7000-8000-0000000000e2',
};
const KEBAB = {
  productId: '0192a000-0000-7000-8000-0000000000f1',
  variantId: '0192a000-0000-7000-8000-0000000000f2',
};

const MENU: HallMenuResponse = {
  currency: 'SYP',
  tables: ['1', '2', 'VIP'],
  staff: [{ id: WAITER, fullName: 'نادل أول', pinLength: 4 }],
  approvers: [{ id: MANAGER, fullName: 'المدير سامي' }],
  items: [
    {
      ...COFFEE,
      name: 'قهوة',
      category: 'مشروبات',
      section: 'مشروبات',
      priceMinor: 15_000,
      modifiers: [
        {
          name: 'الحجم',
          multiple: false,
          required: true,
          options: [
            { name: 'وسط', priceMinor: 0 },
            { name: 'كبير', priceMinor: 5_000 },
          ],
        },
      ],
    },
    { ...KEBAB, name: 'كباب', category: 'مشاوي', section: 'مشاوي', priceMinor: 90_000, modifiers: [] },
  ],
};

const ok = <T,>(body: T): HallAnswer<T> => ({ kind: 'ok', body });

function line(over: Partial<HallLine> & { id: string }): HallLine {
  return {
    ...KEBAB,
    name: 'كباب',
    qty: 1,
    choices: [],
    note: null,
    seat: null,
    section: 'مشاوي',
    status: 'sent',
    ticketId: 't',
    addedByName: 'نادل أول',
    sentAt: null,
    readyAt: null,
    servedAt: null,
    cancelReason: null,
    cancelledAfterSend: false,
    ...over,
  };
}

/** A hall in memory that applies the commands the screen sends */
function fakeHall(initial: HallOrder[] = []) {
  let orders = initial;
  const commands: HallCommand[] = [];
  let n = 0;
  const api: HallApi = {
    kitchen: vi.fn(),
    kitchenCommand: vi.fn(),
    menu: vi.fn(async () => ok(MENU)),
    hall: vi.fn(async () => ok({ orders, tables: MENU.tables, serverTime: '2026-11-12T10:00:00.000Z' })),
    command: vi.fn(async (command) => {
      commands.push(command);
      if (command.type === 'open') {
        const made: HallOrder = {
          id: `order-${++n}`,
          table: command.table,
          guests: 2,
          status: 'open',
          openedByName: 'نادل أول',
          openedAt: '2026-11-12T10:00:00.000Z',
          billRequestedAt: null,
          paidLineIds: [],
          equal: null,
          version: 1,
          lines: [],
        };
        orders = [...orders, made];
        return ok({ order: made });
      }
      if (command.type === 'move') {
        orders = orders.map((o) => (o.id === command.orderId ? { ...o, table: command.table } : o));
        return ok({ order: orders.find((o) => o.id === command.orderId) ?? null });
      }
      if (command.type === 'merge') {
        orders = orders.filter((o) => o.id !== command.fromOrderId);
        return ok({ order: orders.find((o) => o.id === command.orderId) ?? null });
      }
      orders = orders.map((o) => {
        if (!('orderId' in command) || o.id !== command.orderId) return o;
        if (command.type === 'add') {
          return {
            ...o,
            lines: [
              ...o.lines,
              ...command.lines.map((l: HallLineInput, i: number) =>
                line({ id: `new-${o.lines.length + i}`, ...l, status: 'new', section: 'مشاوي' }),
              ),
            ],
          };
        }
        if (command.type === 'send') {
          return {
            ...o,
            lines: o.lines.map((l) => (l.status === 'new' ? { ...l, status: 'sent' as const } : l)),
          };
        }
        if (command.type === 'bill') return { ...o, status: 'bill_requested' as const };
        if (command.type === 'serve') {
          return {
            ...o,
            lines: o.lines.map((l) =>
              command.lineIds.includes(l.id) ? { ...l, status: 'served' as const } : l,
            ),
          };
        }
        if (command.type === 'remove') return { ...o, lines: o.lines.filter((l) => l.id !== command.lineId) };
        if (command.type === 'cancel') {
          return {
            ...o,
            lines: o.lines.map((l) =>
              l.id === command.lineId
                ? {
                    ...l,
                    status: 'cancelled' as const,
                    cancelReason: command.reason,
                    cancelledAfterSend: true,
                  }
                : l,
            ),
          };
        }
        return o;
      });
      return ok({ order: orders.find((o) => 'orderId' in command && o.id === command.orderId) ?? null });
    }),
  };
  return { api, commands, set: (next: HallOrder[]) => (orders = next) };
}

const session: StaffSessionResponse = {
  userId: WAITER,
  fullName: 'نادل أول',
  roles: [{ key: 'waiter', name: 'نادل', branchId: null }],
  permissions: ['hall.order'],
  pinVersion: 1,
  pinLength: 4,
};

const goodSignIn: SignIn = async (_user, pin) =>
  pin === '4829' ? { kind: 'ok', body: session } : { kind: 'invalid' };

async function signIn(user: ReturnType<typeof userEvent.setup>, pin = '4829') {
  await user.click(await screen.findByRole('button', { name: /نادل أول/ }));
  await user.keyboard(pin);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signing in', () => {
  it('lists the waiters, takes a PIN, and refuses a wrong one, a locked one and no connection', async () => {
    const user = userEvent.setup();
    const { api } = fakeHall();
    const answers = [
      { kind: 'invalid' as const },
      { kind: 'locked' as const, retryAfterSeconds: 60 },
      { kind: 'network' as const },
      { kind: 'refused' as const, code: 'forbidden' },
    ];
    let i = 0;
    render(<WaiterScreen api={api} signIn={async () => answers[i++]!} />);
    await user.click(await screen.findByRole('button', { name: /نادل أول/ }));
    await user.keyboard('1111');
    expect((await screen.findAllByText(/رمز غير صحيح/)).length).toBeGreaterThan(0);
    await user.keyboard('1111');
    expect((await screen.findAllByText(/توقف الدخول مؤقتاً/)).length).toBeGreaterThan(0);
  });

  it('says plainly when there is no connection or the name may not sign in here', async () => {
    const user = userEvent.setup();
    const { api } = fakeHall();
    const answers = [{ kind: 'network' as const }, { kind: 'refused' as const, code: 'forbidden' }];
    let i = 0;
    render(<WaiterScreen api={api} signIn={async () => answers[i++]!} />);
    await user.click(await screen.findByRole('button', { name: /نادل أول/ }));
    await user.keyboard('1111');
    expect(await screen.findByText(/دخول النادل يحتاج الإنترنت/)).toBeInTheDocument();
    await user.keyboard('1111');
    expect(await screen.findByText(/لا يدخل على هذا الجهاز/)).toBeInTheDocument();
  });

  it('refuses a person without the permission to take orders', async () => {
    const user = userEvent.setup();
    const { api } = fakeHall();
    render(
      <WaiterScreen
        api={api}
        signIn={async () => ({ kind: 'ok', body: { ...session, permissions: ['report.view'] } })}
      />,
    );
    await signIn(user);
    expect(await screen.findByText(/لا يملك صلاحية أخذ الطلبات/)).toBeInTheDocument();
  });

  it('shows a refusal of the menu and an empty staff list', async () => {
    const { api } = fakeHall();
    vi.mocked(api.menu).mockResolvedValueOnce({
      kind: 'refused',
      message: 'أُوقف هذا الجهاز.',
      code: null,
      status: 403,
    });
    const view = render(<WaiterScreen api={api} signIn={goodSignIn} />);
    expect(await screen.findByText('أُوقف هذا الجهاز.')).toBeInTheDocument();
    view.unmount();
    vi.mocked(api.menu).mockResolvedValueOnce({ kind: 'network' });
    render(<WaiterScreen api={api} signIn={goodSignIn} />);
    expect(await screen.findByText(/أعد تحميل الصفحة/)).toBeInTheDocument();
  });

  it('warns when nobody has a PIN yet', async () => {
    const { api } = fakeHall();
    vi.mocked(api.menu).mockResolvedValueOnce(ok({ ...MENU, staff: [] }));
    render(<WaiterScreen api={api} signIn={goodSignIn} />);
    expect(await screen.findByText(/لا نُدُل لهم رمز دخول/)).toBeInTheDocument();
  });
});

describe('the waiter’s table', () => {
  it('opens a table, adds an item with a choice, a note and a seat, sends it, and asks for the bill', async () => {
    const user = userEvent.setup();
    const { api, commands } = fakeHall();
    render(<WaiterScreen api={api} signIn={goodSignIn} deviceName="هاتف النادل" />);
    await signIn(user);
    const map = await screen.findByRole('region', { name: 'الطاولات' });
    await user.click(within(map).getByRole('button', { name: 'طاولة 2 فارغة' }));
    await user.click(await screen.findByRole('button', { name: 'افتح الطاولة' }));
    expect(commands[0]).toEqual({ type: 'open', userId: WAITER, table: '2', guests: 2 });

    await user.click(await screen.findByRole('button', { name: 'إضافة صنف' }));
    await user.click(await screen.findByRole('button', { name: /قهوة/ }));
    const form = await screen.findByRole('region', { name: 'خيارات قهوة' });
    // The size is required
    await user.click(within(form).getByRole('button', { name: /^أضف/ }));
    expect(within(form).getByText('اختر من «الحجم».')).toBeInTheDocument();
    await user.click(within(form).getByRole('radio', { name: /كبير/ }));
    await user.type(within(form).getByLabelText('ملاحظة للمطبخ'), 'بدون سكر');
    await user.type(within(form).getByLabelText('رقم المقعد'), '2');
    await user.click(within(form).getByRole('button', { name: 'زِد' }));
    await user.click(within(form).getByRole('button', { name: /^أضف/ }));
    // Back on the list, the pick waits in the draft
    expect(screen.getByRole('list', { name: 'الأصناف المختارة' })).toHaveTextContent(
      'قهوة · كبير · بدون سكر',
    );
    await user.click(screen.getByRole('button', { name: 'أضف للطلب (1)' }));

    expect(commands[1]).toMatchObject({
      type: 'add',
      userId: WAITER,
      orderId: 'order-1',
      lines: [
        {
          productId: COFFEE.productId,
          variantId: COFFEE.variantId,
          qty: 2,
          choices: [{ group: 'الحجم', name: 'كبير', priceMinor: 5_000 }],
          note: 'بدون سكر',
          seat: 2,
        },
      ],
    });
    const list = await screen.findByRole('list', { name: 'أصناف الطلب' });
    expect(within(list).getByText('لم يُرسل')).toBeInTheDocument();
    // 2 × (150 + 50)
    expect(screen.getByText('الإجمالي التقريبي').parentElement).toHaveTextContent('400');

    await user.click(screen.getByRole('button', { name: /أرسل للمطبخ/ }));
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ type: 'send', orderId: 'order-1' }));
    await within(await screen.findByRole('list', { name: 'أصناف الطلب' })).findByText('جديد');
    await user.click(screen.getByRole('button', { name: 'كشف حساب' }));
    expect(commands.at(-1)).toMatchObject({ type: 'bill', orderId: 'order-1' });
    expect(await screen.findByText('بانتظار الحساب')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'كشف حساب' })).toBeDisabled();
    // No payment on this screen
    expect(screen.queryByRole('button', { name: /ادفع|قبض|دفع/ })).toBeNull();
  });

  it('removes a line before it is sent and searches the menu by section and by name', async () => {
    const user = userEvent.setup();
    const { api, commands } = fakeHall([
      {
        id: 'o1',
        table: '1',
        guests: 2,
        status: 'open',
        openedByName: null,
        openedAt: '2026-11-12T10:00:00.000Z',
        billRequestedAt: null,
        paidLineIds: [],
        equal: null,
        version: 1,
        lines: [line({ id: 'l1', status: 'new' })],
      },
    ]);
    render(<WaiterScreen api={api} signIn={goodSignIn} />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: /طاولة 1 مشغولة/ }));
    await user.click(await screen.findByRole('button', { name: 'احذف كباب' }));
    expect(commands.at(-1)).toEqual({ type: 'remove', userId: WAITER, orderId: 'o1', lineId: 'l1' });
    await screen.findByText(/لا أصناف بعد/);

    await user.click(screen.getByRole('button', { name: 'إضافة صنف' }));
    await user.click(await screen.findByRole('button', { name: 'مشاوي' }));
    expect(screen.queryByRole('button', { name: /قهوة/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'الكل' }));
    await user.type(screen.getByRole('searchbox', { name: 'ابحث عن صنف' }), 'قهو');
    expect(screen.queryByRole('button', { name: /كباب/ })).toBeNull();
    // An item without choices goes into the draft at once, and the draft can drop it
    await user.clear(screen.getByRole('searchbox', { name: 'ابحث عن صنف' }));
    await user.click(screen.getByRole('button', { name: /كباب/ }));
    await user.click(await screen.findByRole('button', { name: /^أضف/ }));
    await user.click(screen.getByRole('button', { name: 'احذف كباب' }));
    expect(screen.queryByRole('list', { name: 'الأصناف المختارة' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'رجوع إلى الطاولة' }));
    expect(await screen.findByRole('region', { name: 'طلب الطاولة 1' })).toBeInTheDocument();
  });

  it('alerts when a line turns جاهز, marks the table, and serves it', async () => {
    const user = userEvent.setup();
    const order: HallOrder = {
      id: 'o1',
      table: 'VIP',
      guests: 4,
      status: 'open',
      openedByName: null,
      openedAt: '2026-11-12T10:00:00.000Z',
      billRequestedAt: null,
      paidLineIds: [],
      equal: null,
      version: 1,
      lines: [line({ id: 'l1', status: 'preparing' })],
    };
    const fake = fakeHall([order]);
    render(<WaiterScreen api={fake.api} signIn={goodSignIn} pollMs={30} />);
    await signIn(user);
    await screen.findByRole('button', { name: /طاولة VIP مشغولة/ });
    fake.set([{ ...order, lines: [line({ id: 'l1', status: 'ready' })] }]);
    expect(await screen.findByText('جاهز: كباب · طاولة VIP')).toBeInTheDocument();
    const tile = screen.getByRole('button', { name: 'طاولة VIP مشغولة، 1 جاهز' });
    await user.click(tile);
    await user.click(await screen.findByRole('button', { name: 'قدّم الجاهز (1)' }));
    expect(fake.commands.at(-1)).toEqual({ type: 'serve', userId: WAITER, orderId: 'o1', lineIds: ['l1'] });
  });

  it('cancels a sent line only with a reason and a manager’s code', async () => {
    const user = userEvent.setup();
    const fake = fakeHall([
      {
        id: 'o1',
        table: '1',
        guests: 2,
        status: 'open',
        openedByName: null,
        openedAt: '2026-11-12T10:00:00.000Z',
        billRequestedAt: null,
        paidLineIds: [],
        equal: null,
        version: 1,
        lines: [line({ id: 'l1', status: 'sent' })],
      },
    ]);
    render(<WaiterScreen api={fake.api} signIn={goodSignIn} />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: /طاولة 1 مشغولة/ }));
    await user.click(await screen.findByRole('button', { name: 'ألغِ كباب' }));
    const view = await screen.findByRole('region', { name: 'إلغاء بند بعد المطبخ' });
    // The code is tapped on the pad (the keyboard belongs to the reason field)
    const tap = async (digits: string) => {
      for (const d of digits) await user.click(within(view).getByRole('button', { name: d }));
    };
    // The reason comes first
    await tap('285713');
    expect(await within(view).findByText('اكتب سبب الإلغاء.')).toBeInTheDocument();
    expect(fake.commands.filter((c) => c.type === 'cancel')).toHaveLength(0);

    await user.type(within(view).getByLabelText('سبب الإلغاء'), 'غيّر الزبون رأيه');
    vi.mocked(fake.api.command).mockResolvedValueOnce({
      kind: 'refused',
      message: 'رمز الدخول غير صحيح.',
      code: 'pin_invalid',
      status: 401,
    });
    await tap('111111');
    expect((await within(view).findAllByText(/رمز غير صحيح/)).length).toBeGreaterThan(0);
    await tap('285713');
    await waitFor(() =>
      expect(fake.commands.at(-1)).toEqual({
        type: 'cancel',
        userId: WAITER,
        orderId: 'o1',
        lineId: 'l1',
        reason: 'غيّر الزبون رأيه',
        approverId: MANAGER,
        approverPin: '285713',
      }),
    );
    // Back on the table, the line shows cancelled with its reason
    expect(await screen.findByText('غيّر الزبون رأيه')).toBeInTheDocument();
  });

  it('shows what the server refused and that the connection is gone', async () => {
    const user = userEvent.setup();
    const fake = fakeHall();
    render(<WaiterScreen api={fake.api} signIn={goodSignIn} pollMs={30} />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'طاولة 1 فارغة' }));
    vi.mocked(fake.api.command).mockResolvedValueOnce({
      kind: 'refused',
      message: 'هذه الطاولة غير موجودة في الصالة.',
      code: 'validation_failed',
      status: 400,
    });
    await user.click(await screen.findByRole('button', { name: 'افتح الطاولة' }));
    expect(await screen.findByText('هذه الطاولة غير موجودة في الصالة.')).toBeInTheDocument();
    vi.mocked(fake.api.command).mockResolvedValueOnce({ kind: 'network' });
    await user.click(screen.getByRole('button', { name: 'افتح الطاولة' }));
    expect(await screen.findByText(/لا يوجد اتصال بالخادم. أعد المحاولة/)).toBeInTheDocument();
    vi.mocked(fake.api.hall).mockResolvedValue({ kind: 'network' });
    expect(await screen.findByText('بلا اتصال')).toBeInTheDocument();
    vi.mocked(fake.api.hall).mockResolvedValue({
      kind: 'refused',
      message: 'أُوقف المتجر.',
      code: null,
      status: 402,
    });
    expect(await screen.findByText('أُوقف المتجر.')).toBeInTheDocument();
  });

  it('signs out back to the PIN pad', async () => {
    const user = userEvent.setup();
    const { api } = fakeHall();
    render(<WaiterScreen api={api} signIn={goodSignIn} />);
    await signIn(user);
    await screen.findByRole('region', { name: 'الطاولات' });
    await user.click(screen.getByRole('button', { name: 'خروج' }));
    expect(await screen.findByText('من يعمل الآن؟')).toBeInTheDocument();
  });
});

describe('moving and merging a table', () => {
  const orderAt = (id: string, table: string, extra: Partial<HallOrder> = {}): HallOrder => ({
    id,
    table,
    guests: 2,
    status: 'open',
    openedByName: null,
    openedAt: '2026-11-12T10:00:00.000Z',
    billRequestedAt: null,
    paidLineIds: [],
    equal: null,
    version: 1,
    lines: [line({ id: `${id}-l` })],
    ...extra,
  });

  it('sends «move» to a free table and «merge» into a busy one, and hides it once a part was paid', async () => {
    const user = userEvent.setup();
    const { api, commands } = fakeHall([orderAt('o1', '1'), orderAt('o2', '2')]);
    render(<WaiterScreen api={api} signIn={goodSignIn} />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: /طاولة 1 مشغولة/ }));
    await user.click(await screen.findByRole('button', { name: 'انقل أو ادمج الطاولة' }));
    await user.click(await screen.findByRole('button', { name: 'انقل إلى الطاولة VIP' }));
    expect(commands.at(-1)).toEqual({ type: 'move', userId: WAITER, orderId: 'o1', table: 'VIP' });

    await user.click(await screen.findByRole('button', { name: 'انقل أو ادمج الطاولة' }));
    await user.click(await screen.findByRole('button', { name: 'ادمج مع الطاولة 2' }));
    // The order of the table being left joins the one picked
    expect(commands.at(-1)).toEqual({ type: 'merge', userId: WAITER, orderId: 'o2', fromOrderId: 'o1' });
  });

  it('does not offer it for a table whose bill is already being paid in parts', async () => {
    const user = userEvent.setup();
    const { api } = fakeHall([orderAt('o1', '1', { paidLineIds: ['x'] })]);
    render(<WaiterScreen api={api} signIn={goodSignIn} />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: /طاولة 1 مشغولة/ }));
    await screen.findByRole('region', { name: 'طلب الطاولة 1' });
    expect(screen.queryByRole('button', { name: 'انقل أو ادمج الطاولة' })).toBeNull();
  });
});
