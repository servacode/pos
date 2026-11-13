import { screen, within } from '@testing-library/react';
import { formatMoney, stripBidiControls } from '@serva/core';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, initialsOf } from './Avatar';
import { Balance } from './Balance';
import { Badge, STATUSES, StatusChip, type Status } from './Badge';
import { Banner } from './Banner';
import { Card, StatTile } from './Card';
import { DataTable, type DataColumn } from './DataTable';
import { EmptyState } from './EmptyState';
import { CheckCircleIcon, CustomersIcon, ProductsIcon } from './icons';
import { AppIcon, Logo, LOGO_S_PATH, LogoMark, LogoStacked } from './Logo';
import { Money } from './Money';
import { PageHeader } from './PageHeader';
import { ProgressBar } from './ProgressBar';
import { SegmentedControl } from './SegmentedControl';
import { Skeleton } from './Skeleton';
import { Tabs } from './Tabs';
import { renderUi } from './test/render';

describe('Money', () => {
  it('prints exactly what @serva/core formatMoney gives, isolated, in equal-width digits', () => {
    renderUi(<Money minor={125000} currency="SYP" />);

    const amount = screen.getByText((_, element) => element?.tagName === 'BDI');
    expect(amount.textContent).toBe(formatMoney(125000, 'SYP'));
    expect(stripBidiControls(amount.textContent!)).toBe('1,250 ل.س');
    expect(amount).toHaveClass('num');
  });

  it('follows the store digits and keeps «−» for a negative report amount, in the danger colour', () => {
    renderUi(<Money minor={-300000} currency="SYP" negativeTone />, { digits: 'arab' });

    const amount = screen.getByText((_, element) => element?.tagName === 'BDI');
    expect(amount.textContent).toBe(formatMoney(-300000, 'SYP', { digits: 'arab' }));
    expect(stripBidiControls(amount.textContent!)).toBe('−٣٬٠٠٠ ل.س');
    expect(amount).toHaveClass('text-danger-ink');
  });

  it('shows a balance without a sign when asked', () => {
    renderUi(<Money minor={-4850000} currency="SYP" signDisplay="never" />);
    expect(screen.getByText((_, element) => element?.tagName === 'BDI').textContent).not.toContain('−');
  });

  it('puts the symbol in its own span, styled only when asked, without changing the text', () => {
    renderUi(
      <>
        <Money minor={125000} currency="SYP" />
        <Money minor={125000} currency="SYP_OLD" unitClassName="text-ink-subtle" />
        <Money minor={1250} currency="USD" symbol={false} />
      </>,
    );
    const [plain, old, bare] = screen.getAllByText((_, element) => element?.tagName === 'BDI');

    expect(plain!.textContent).toBe(formatMoney(125000, 'SYP'));
    expect(plain!.querySelector('[data-money-unit]')).toHaveTextContent('ل.س');
    expect(plain!.querySelector('[data-money-unit]')).not.toHaveAttribute('class');
    // A symbol with a space in it («ل.س قديمة») stays whole.
    expect(old!.textContent).toBe(formatMoney(125000, 'SYP_OLD'));
    expect(old!.querySelector('[data-money-unit]')).toHaveTextContent('ل.س قديمة');
    expect(old!.querySelector('[data-money-unit]')).toHaveClass('text-ink-subtle');
    expect(bare!.textContent).toBe(formatMoney(1250, 'USD', { symbol: false }));
    expect(bare!.querySelector('[data-money-unit]')).toBeNull();
  });

  it('keeps the name of a button that shows an amount', () => {
    renderUi(
      <button type="button">
        ادفع <Money minor={125000} currency="SYP" />
      </button>,
    );
    expect(screen.getByRole('button', { name: `ادفع ${formatMoney(125000, 'SYP')}` })).toBeInTheDocument();
  });
});

describe('Balance', () => {
  it('writes «عليه» for a debit balance and «له» for a credit one, never a minus sign or red', () => {
    renderUi(
      <>
        <p data-testid="owes">
          <Balance minor={4850000} currency="SYP" />
        </p>
        <p data-testid="owed">
          <Balance minor={-1250} currency="USD" />
        </p>
        <p data-testid="zero">
          <Balance minor={0} currency="SYP" />
        </p>
      </>,
    );

    expect(stripBidiControls(screen.getByTestId('owes').textContent!)).toBe('عليه 48,500 ل.س');
    expect(stripBidiControls(screen.getByTestId('owed').textContent!)).toBe('له 12.50 $');
    expect(stripBidiControls(screen.getByTestId('zero').textContent!)).toBe('0 ل.س');
    for (const id of ['owes', 'owed']) {
      expect(screen.getByTestId(id).textContent).not.toContain('−');
      expect(screen.getByTestId(id).querySelector('.text-danger-ink')).toBeNull();
      expect(screen.getByTestId(id).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('StatusChip', () => {
  it.each([
    ['awaitingPayment', 'بانتظار الدفع', 'bg-warning-soft'],
    ['paid', 'مدفوعة', 'bg-success-soft'],
    ['credit', 'آجلة', 'bg-surface-muted'],
    ['debt', 'دين', 'bg-surface-muted'],
    ['overdueDebt', 'دين متأخر', 'bg-danger-soft'],
    ['pendingSend', 'بانتظار الإرسال', 'bg-warning-soft'],
    ['pendingApproval', 'بانتظار موافقتك', 'bg-warning-soft'],
    ['rejected', 'مرفوض', 'bg-surface-muted'],
  ] as const)('shows %s as «%s» with its colour', (status, label, token) => {
    renderUi(<StatusChip status={status} />);
    expect(screen.getByText(label)).toHaveClass(token);
  });

  it('never uses red for a customer debt that is not overdue (tab 14 › ألوان المال)', () => {
    expect(STATUSES.debt.tone).not.toBe('danger');
    expect(STATUSES.credit.tone).not.toBe('danger');
  });

  it('always carries a word, never colour alone', () => {
    for (const status of Object.keys(STATUSES) as Status[]) {
      expect(STATUSES[status].label.trim()).not.toBe('');
    }
  });

  it('is a small pill with a 6 px dot in the words’ colour', () => {
    renderUi(<StatusChip status="paid" />);

    const chip = screen.getByText('مدفوعة');
    expect(chip).toHaveClass('rounded-full', 'text-xs', 'font-semibold', 'text-success-ink');
    const dot = chip.querySelector('[aria-hidden="true"]')!;
    expect(dot).toHaveClass('size-1.5', 'rounded-full', 'bg-current');
  });
});

describe('Badge', () => {
  it('has the dot of its tone, unless it starts with its own icon or is asked not to', () => {
    renderUi(
      <>
        <Badge tone="warning">على الحساب</Badge>
        <Badge tone="success">
          <CheckCircleIcon size={16} />
          متوازن
        </Badge>
        <Badge tone="brand" dot={false}>
          داخلي
        </Badge>
      </>,
    );

    const credit = screen.getByText('على الحساب');
    expect(credit).toHaveClass('bg-warning-soft', 'text-warning-ink', 'rounded-full', 'px-2.5', 'py-0.5');
    expect(credit.querySelector('.bg-current')).not.toBeNull();
    expect(screen.getByText('متوازن').querySelector('.bg-current')).toBeNull();
    expect(screen.getByText('داخلي').querySelector('.bg-current')).toBeNull();
  });

  it('keeps the dot before a number or an amount: only an icon replaces it', () => {
    renderUi(
      <>
        <Badge tone="warning">
          <bdi className="num">3</bdi> أصناف
        </Badge>
        <Badge tone="danger">
          <Money minor={125000} currency="SYP" /> متأخر
        </Badge>
      </>,
    );

    for (const words of ['أصناف', 'متأخر']) {
      const badge = screen.getByText(words, { exact: false });
      expect(badge.firstElementChild).toHaveClass('size-1.5', 'rounded-full', 'bg-current');
      expect(badge.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('PageHeader', () => {
  it('gives the page its one h1, a line of description and the actions at the end', () => {
    renderUi(
      <PageHeader
        title="المنتجات"
        description="101 قطعة في 16 موديلاً"
        icon={<ProductsIcon />}
        actions={<button type="button">أضف منتجاً</button>}
      />,
    );

    const title = screen.getByRole('heading', { level: 1, name: 'المنتجات' });
    expect(title).toHaveClass('text-2xl', 'font-bold', 'text-ink');
    expect(screen.getByText('101 قطعة في 16 موديلاً')).toHaveClass('text-sm', 'text-ink-muted');
    expect(screen.getByRole('button', { name: 'أضف منتجاً' })).toBeInTheDocument();
    // The icon is decorative: the title says it.
    expect(title.parentElement!.previousElementSibling).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws just the title when that is all there is', () => {
    const { container } = renderUi(<PageHeader title="الأجهزة" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('الأجهزة');
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Banner', () => {
  it('is a status for warnings and an alert for danger, each with its own tokens', () => {
    renderUi(
      <>
        <Banner tone="offline">دون إنترنت منذ 2:05 م</Banner>
        <Banner tone="danger">انتهى اشتراكك</Banner>
      </>,
    );

    expect(screen.getByRole('status')).toHaveClass('bg-warning-soft', 'text-warning-ink');
    expect(screen.getByRole('alert')).toHaveClass('bg-danger-soft');
  });

  it('can be hidden when it offers a close button', async () => {
    const onDismiss = vi.fn();
    const { user } = renderUi(<Banner onDismiss={onDismiss}>باقي 3 أيام من الباقة المجانية.</Banner>);
    await user.click(screen.getByRole('button', { name: 'أخفِ التنبيه' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('Card and StatTile', () => {
  it('marks a selected card with brand-soft and a brand ring, not surface', () => {
    renderUi(<Card selected>مقهى الياسمين</Card>);

    const card = screen.getByText('مقهى الياسمين');
    expect(card).toHaveClass('bg-brand-soft', 'ring-brand');
    expect(card).not.toHaveClass('bg-surface');
  });

  it('gives the trend an arrow, a colour and words', () => {
    renderUi(
      <StatTile
        label="مبيعات اليوم"
        value={<Money minor={128450000} currency="SYP" />}
        trend={{ direction: 'down', value: '−3%', comparison: 'عن الخميس الماضي' }}
      />,
    );

    const trend = screen.getByText('−3%').parentElement!;
    expect(trend).toHaveClass('text-danger-ink');
    expect(trend).toHaveTextContent('انخفاض');
    expect(trend.querySelector('svg')).toHaveClass('rtl:-scale-x-100');
    expect(screen.getByText('عن الخميس الماضي')).toBeInTheDocument();
  });

  it('draws a card as a surface on a hairline with a soft lift', () => {
    renderUi(<Card>بقالية أبو خليل</Card>);
    expect(screen.getByText('بقالية أبو خليل')).toHaveClass(
      'rounded-card',
      'border-line',
      'bg-surface',
      'shadow-e1',
    );
  });

  it('shows the number big in equal-width digits, its unit smaller and softer, and the trend by the label', () => {
    renderUi(
      <StatTile
        label="صافي المبيعات اليوم"
        value={<Money minor={1342000} currency="SYP" />}
        trend={{ direction: 'up', value: '12%' }}
        sparkline={[3, 5, 4, 8, 9]}
      />,
    );

    const value = screen.getByText(
      (_, element) => element?.tagName === 'BDI' && !!element.closest('p'),
    ).parentElement!;
    expect(value).toHaveClass('num', 'text-kpi', 'font-bold', '[&_[data-money-unit]]:text-ink-subtle');
    const pill = screen.getByText('12%').parentElement!;
    expect(pill).toHaveClass('bg-success-soft', 'text-success-ink');
    expect(pill).toHaveTextContent('ارتفاع');
    expect(pill.parentElement).toContainElement(screen.getByText('صافي المبيعات اليوم'));
    // The line runs with time: from the right in Arabic. Decorative, the number says it.
    const spark = value.parentElement!.querySelector(':scope > svg')!;
    expect(spark).toHaveAttribute('aria-hidden', 'true');
    expect(spark).toHaveClass('rtl:-scale-x-100');
  });

  it('draws a level dashed baseline, not a climb from zero, when only the latest day has a value', () => {
    const { container, rerender } = renderUi(
      <StatTile label="الفواتير" value="3" sparkline={[0, 0, 0, 0, 0, 0, 3]} />,
    );
    const flat = container.querySelector('svg path[stroke]')!;
    expect(flat).toHaveAttribute('stroke-dasharray');
    // No wash under it
    expect(container.querySelector('path[fill^="url("]')).toBeNull();
    rerender(<StatTile label="الفواتير" value="3" sparkline={[0, 1, 0, 3]} />);
    expect(container.querySelector('svg path[stroke]')).not.toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('path[fill^="url("]')).not.toBeNull();
  });

  it('keeps the reading order: the label, its number right after it, then the change and its comparison together', () => {
    renderUi(
      <StatTile
        label="مبيعات اليوم"
        icon={<ProductsIcon />}
        value={<Money minor={128450000} currency="SYP" />}
        footnote="مؤقت"
        trend={{ direction: 'up', value: '+12%', comparison: 'عن الخميس الماضي' }}
      />,
    );

    // The label is a child of the tile, with its picture inside it and its number next to it.
    const label = screen.getByText('مبيعات اليوم');
    const tile = label.parentElement!;
    expect(tile).toHaveClass('rounded-card', 'grid');
    expect(label.closest('div')).toBe(tile);
    expect(label.querySelector('svg')!.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(stripBidiControls(label.nextElementSibling!.textContent!)).toBe('1,284,500 ل.س');
    // The change comes after the footnote in the DOM, its comparison right after it…
    const pill = screen.getByText('+12%').parentElement!;
    const footnote = screen.getByText('مؤقت');
    expect(footnote.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const comparison = pill.nextElementSibling!;
    expect(comparison).toHaveTextContent('عن الخميس الماضي');
    expect(comparison).toHaveClass('text-ink-subtle', 'text-end');
    // …and the grid draws the pill beside the label, the comparison just under the pill.
    expect(pill).toHaveClass('col-start-2', 'row-start-1');
    expect(comparison).toHaveClass('row-start-2', 'col-span-full');
  });

  it('gives a tile without a trend a single column', () => {
    renderUi(<StatTile label="عدد الزبائن" value={<bdi className="num">48</bdi>} />);

    const label = screen.getByText('عدد الزبائن');
    expect(label.parentElement).toHaveClass('grid-cols-1');
    expect(label.nextElementSibling).toHaveTextContent('48');
  });
});

interface Row {
  id: string;
  name: string;
  minor: number;
}

const COLUMNS: DataColumn<Row>[] = [
  { key: 'name', header: 'الزبون', total: 'المجموع' },
  {
    key: 'amount',
    header: 'المبلغ',
    numeric: true,
    cell: (row) => <Money minor={row.minor} currency="SYP" />,
    total: <Money minor={4975000} currency="SYP" />,
  },
];
const ROWS: Row[] = [
  { id: '1', name: 'أبو أحمد الخلف', minor: 4850000 },
  { id: '2', name: 'أم محمد', minor: 125000 },
];

describe('DataTable', () => {
  it('aligns numbers to the column end in equal-width digits and adds the totals row', () => {
    renderUi(<DataTable caption="ديون الزبائن" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />);

    const table = screen.getByRole('table', { name: 'ديون الزبائن' });
    expect(within(table).getByRole('columnheader', { name: 'المبلغ' })).toHaveClass('text-end', 'num');
    const cells = within(table).getAllByRole('cell');
    expect(cells[1]).toHaveClass('text-end', 'num');
    expect(cells[0]).toHaveClass('text-start');
    const totals = table.querySelector('tfoot tr')!;
    expect(totals).toHaveClass('bg-surface-total');
    expect(totals).toHaveTextContent('المجموع');
    expect(stripBidiControls(totals.textContent!)).toContain('49,750 ل.س');
  });

  it('shows skeleton rows and says it is busy while loading, without a totals row', () => {
    renderUi(<DataTable caption="ديون" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} loading />);

    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('أم محمد')).not.toBeInTheDocument();
    expect(table.querySelector('tfoot')).toBeNull();
  });

  it('shows the empty state when there are no rows', () => {
    renderUi(
      <DataTable
        caption="ديون"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<EmptyState icon={CustomersIcon} title="لا زبائن بعد." />}
      />,
    );
    expect(screen.getByText('لا زبائن بعد.')).toBeInTheDocument();
  });

  it('shows the error with a retry', async () => {
    const onRetry = vi.fn();
    const { user } = renderUi(
      <DataTable
        caption="ديون"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        error="لم نستطع تحميل الديون. حاول مرة أخرى."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('لم نستطع تحميل الديون.');
    await user.click(screen.getByRole('button', { name: 'حاول مرة أخرى' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses the row height of its density', () => {
    renderUi(<DataTable caption="قيود" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />, {
      density: 'dense',
    });
    expect(screen.getByText('أم محمد').closest('tr')).toHaveClass('h-8');
  });

  it('sits in a card shell with soft column heads, hairline rows and the first column in semibold', () => {
    const { container } = renderUi(
      <DataTable caption="ديون الزبائن" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    );

    expect(container.querySelector('[dir] > div')).toHaveClass(
      'rounded-card',
      'border-line',
      'bg-surface',
      'overflow-hidden',
    );
    const head = screen.getByRole('columnheader', { name: 'الزبون' });
    expect(head).toHaveClass('text-xs', 'font-semibold', 'text-ink-subtle');
    expect(head.closest('tr')).toHaveClass('bg-surface-muted/60');
    const row = screen.getByText('أم محمد').closest('tr')!;
    expect(row).toHaveClass('h-12', 'border-b', 'border-line', 'hover:bg-surface-muted/60');
    expect(screen.getByText('أم محمد')).toHaveClass('font-semibold');
  });

  it('leaves a first cell drawn by the screen with its own weights', () => {
    renderUi(
      <DataTable
        caption="الزبائن"
        columns={[
          {
            key: 'name',
            header: 'الزبون',
            cell: (row: Row) => (
              <span>
                {row.name} <span className="text-ink-muted">زبون دائم</span>
              </span>
            ),
          },
        ]}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );
    expect(screen.getAllByRole('cell')[0]).not.toHaveClass('font-semibold');
  });
});

describe('Tabs', () => {
  const items = [
    { value: 'today', label: 'اليوم', content: 'مبيعات اليوم' },
    { value: 'week', label: 'هذا الأسبوع', content: 'مبيعات الأسبوع' },
    { value: 'month', label: 'هذا الشهر', content: 'مبيعات الشهر' },
  ] as const;

  function Controlled({ onChange }: { onChange: (value: string) => void }) {
    return <Tabs label="الفترة" items={items} value="today" onValueChange={onChange} />;
  }

  it('links the active tab to its panel', () => {
    renderUi(<Controlled onChange={() => {}} />);

    const tab = screen.getByRole('tab', { name: 'اليوم' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'اليوم' })).toHaveTextContent('مبيعات اليوم');
    expect(screen.getByRole('tab', { name: 'هذا الأسبوع' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves forward with ArrowLeft in RTL, and with ArrowRight in LTR', async () => {
    const onChange = vi.fn();
    const { user, unmount } = renderUi(<Controlled onChange={onChange} />);
    screen.getByRole('tab', { name: 'اليوم' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('week');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('month');
    unmount();

    const ltr = renderUi(<Controlled onChange={onChange} />, { dir: 'ltr' });
    screen.getByRole('tab', { name: 'اليوم' }).focus();
    await ltr.user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('week');
  });

  it('underlines the active section of a page by default, at the control height of its density', () => {
    renderUi(<Controlled onChange={() => {}} />);

    expect(screen.getByRole('tablist', { name: 'الفترة' })).toHaveClass('border-b', 'border-line');
    const active = screen.getByRole('tab', { name: 'اليوم' });
    expect(active).toHaveClass('border-b-2', 'border-brand', 'text-ink', 'font-semibold', 'min-h-10');
    expect(screen.getByRole('tab', { name: 'هذا الأسبوع' })).toHaveClass(
      'border-transparent',
      'text-ink-muted',
    );
  });

  it('can be a segmented track instead, keeping the same roles and keys', async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <Tabs label="الفترة" items={items} value="today" onValueChange={onChange} variant="pill" />,
    );

    expect(screen.getByRole('tablist', { name: 'الفترة' })).toHaveClass(
      'bg-surface-muted',
      'rounded-control',
      'min-h-10',
      'pointer-coarse:min-h-12',
    );
    const active = screen.getByRole('tab', { name: 'اليوم' });
    expect(active).toHaveClass('bg-surface', 'text-ink', 'shadow-e1', 'ring-1', 'ring-line');
    expect(active).toHaveAttribute('aria-selected', 'true');
    active.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('week');
  });
});

describe('SegmentedControl', () => {
  it('is a radio group where one option is always chosen and the arrows follow RTL', async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <SegmentedControl
        label="السكر"
        value="medium"
        onValueChange={onChange}
        options={[
          { value: 'none', label: 'بلا' },
          { value: 'medium', label: 'وسط' },
          { value: 'extra', label: 'زيادة' },
        ]}
      />,
    );

    expect(screen.getByRole('radiogroup', { name: 'السكر' })).toBeInTheDocument();
    const chosen = screen.getByRole('radio', { name: 'وسط' });
    expect(chosen).toHaveAttribute('aria-checked', 'true');
    expect(chosen).toHaveAttribute('tabindex', '0');
    chosen.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('extra');
    expect(screen.getByRole('radio', { name: 'زيادة' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('none');
  });

  it('is 48 high on touch', () => {
    renderUi(
      <SegmentedControl
        label="العملة"
        value="SYP"
        onValueChange={() => {}}
        options={[{ value: 'SYP', label: 'ل.س' }]}
      />,
      { density: 'touch' },
    );
    // The track is the touch control height (56) with 4 inside, so the segment is 48.
    expect(screen.getByRole('radiogroup')).toHaveClass('min-h-14', 'p-1');
  });

  it('lifts the chosen segment out of a muted track; a finger gets 48 on the admin', () => {
    renderUi(
      <SegmentedControl
        label="الفترة"
        value="day"
        onValueChange={() => {}}
        options={[
          { value: 'day', label: 'اليوم' },
          { value: 'week', label: 'الأسبوع' },
        ]}
      />,
    );

    // The whole control is the admin's control height, 48 under a finger, like the fields beside it.
    expect(screen.getByRole('radiogroup')).toHaveClass(
      'bg-surface-muted',
      'p-1',
      'rounded-control',
      'min-h-10',
      'pointer-coarse:min-h-12',
    );
    const chosen = screen.getByRole('radio', { name: 'اليوم' });
    expect(chosen).toHaveClass('bg-surface', 'text-ink', 'shadow-e1', 'ring-1', 'ring-line', 'rounded-small');
    // A clear layer over the track's 4 inside gives the finger the full height.
    expect(chosen).toHaveClass('relative', 'before:absolute', 'before:-inset-y-1');
    expect(screen.getByRole('radio', { name: 'الأسبوع' })).toHaveClass('text-ink-muted');
  });
});

describe('EmptyState, Skeleton and Avatar', () => {
  it('says what will show here and offers one primary action', () => {
    renderUi(
      <EmptyState
        icon={CustomersIcon}
        title="لا زبائن بعد."
        description="أضف أول زبون، أو استوردهم من ملف."
        action={<button type="button">أضف زبوناً</button>}
      />,
    );
    expect(screen.getByText('لا زبائن بعد.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أضف زبوناً' })).toBeInTheDocument();
  });

  it('frames the empty state in a dashed line, with the picture on a 48 brand-soft tile', () => {
    renderUi(<EmptyState icon={CustomersIcon} title="لا زبائن بعد." />);

    const frame = screen.getByText('لا زبائن بعد.').parentElement!;
    expect(frame).toHaveClass('rounded-card', 'border-dashed', 'border-line-control/50');
    const tile = frame.querySelector('svg')!.parentElement!;
    expect(tile).toHaveClass('size-12', 'rounded-card', 'bg-brand-soft', 'text-brand');
    expect(frame.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hides skeletons from screen readers', () => {
    const { container } = renderUi(<Skeleton className="h-4" />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('bg-surface-muted');
  });

  it('draws initials, decorative unless it stands alone', () => {
    expect(initialsOf('أبو أحمد الخلف')).toBe('أأ');
    expect(initialsOf(' سامر ')).toBe('س');
    renderUi(
      <>
        <Avatar name="خالد العلي" />
        <Avatar name="فاطمة الجاسم" labelled />
      </>,
    );
    expect(screen.getByText('خع')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: 'فاطمة الجاسم' })).toHaveTextContent('فج');
  });
});

describe('Logo (docs/design/kit/logo.md)', () => {
  it('draws the exact mark: viewBox 64, corner 16, the «S» path, stroke 7 and the dot', () => {
    const { container } = renderUi(<LogoMark />);
    const svg = container.querySelector('svg')!;

    expect(svg).toHaveAttribute('viewBox', '0 0 64 64');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('rect')).toHaveAttribute('rx', '16');
    expect(svg.querySelector('rect')).toHaveClass('fill-mark-from');
    const path = svg.querySelector('path')!;
    expect(path).toHaveAttribute('d', 'M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42');
    expect(path).toHaveAttribute('stroke-width', '7');
    expect(path).toHaveAttribute('stroke-linecap', 'round');
    expect(path).toHaveClass('stroke-on-mark');
    const dot = svg.querySelector('circle')!;
    expect([dot.getAttribute('cx'), dot.getAttribute('cy'), dot.getAttribute('r')]).toEqual([
      '46',
      '46',
      '3.5',
    ]);
    // The mark keeps its colours in both modes (the specimen): no dark: classes.
    expect(dot).toHaveClass('fill-on-mark/90');
    expect(dot.getAttribute('class')).not.toContain('dark:');
  });

  it('draws the app icon with corner 15, and the small one with stroke 8 and no dot', () => {
    const { container } = renderUi(
      <>
        <AppIcon label="أيقونة التطبيق" />
        <AppIcon small label="أيقونة صغيرة" />
      </>,
    );
    const [large, small] = [...container.querySelectorAll('svg')];
    expect(large!.querySelector('rect')).toHaveAttribute('rx', '15');
    expect(large!.querySelector('circle')).not.toBeNull();
    expect(small!.querySelector('path')).toHaveAttribute('stroke-width', '8');
    expect(small!.querySelector('circle')).toBeNull();
    expect(screen.getByRole('img', { name: 'أيقونة التطبيق' })).toBe(large);
  });

  it('writes «SERFA» in Latin, bold and letter-spaced, and «سيرفا» under it in brand-ink', () => {
    renderUi(
      <>
        <Logo />
        <LogoStacked />
      </>,
    );
    const latins = screen.getAllByText('Serfa');
    expect(latins).toHaveLength(2);
    for (const latin of latins) {
      expect(latin).toHaveAttribute('lang', 'en');
      expect(latin).toHaveAttribute('dir', 'ltr');
      // A word for screen readers, drawn in capitals.
      expect(latin).toHaveClass('uppercase', 'font-bold', 'tracking-[0.12em]');
    }
    for (const arabic of screen.getAllByText('سيرفا'))
      expect(arabic).toHaveClass('text-brand-ink', 'font-semibold');
    expect(LOGO_S_PATH).toBe('M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42');
  });

  it('fills each mark with its own emerald → teal gradient, over the solid emerald square', () => {
    const { container } = renderUi(
      <>
        <LogoMark />
        <LogoMark label="علامة سيرفا" />
        <AppIcon small />
      </>,
    );
    const ids = [...container.querySelectorAll('svg')].map((svg) => {
      const gradient = svg.querySelector('linearGradient')!;
      const [from, to] = [...gradient.querySelectorAll('stop')];
      expect(from).toHaveClass('text-mark-from');
      expect(to).toHaveClass('text-mark-to');
      const [solid, painted] = [...svg.querySelectorAll('rect')];
      expect(solid).toHaveClass('fill-mark-from');
      expect(painted).toHaveAttribute('fill', `url(#${gradient.id})`);
      expect(gradient.id).toMatch(/^[\w-]+$/);
      return gradient.id;
    });
    expect(new Set(ids).size).toBe(3);
  });

  it('turns the words light on the deep-emerald sidebar', () => {
    renderUi(<Logo tone="sidebar" />);
    expect(screen.getByText('Serfa')).toHaveClass('text-sidebar-strong');
    expect(screen.getByText('سيرفا')).toHaveClass('text-sidebar-muted');
  });
});

describe('ProgressBar', () => {
  it('announces its label and value, and fills to the ratio', () => {
    renderUi(<ProgressBar label="تنزيل بيانات المحل" value={30} max={120} valueText="25%" />);

    const bar = screen.getByRole('progressbar', { name: 'تنزيل بيانات المحل' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemax', '120');
    expect(bar).toHaveAttribute('aria-valuetext', '25%');
    expect(bar.firstElementChild).toHaveStyle({ width: '25%' });
    expect(bar.firstElementChild).toHaveClass('bg-brand');
  });

  it('clamps an overshoot, and pulses without a value while the total is unknown', () => {
    const { unmount } = renderUi(<ProgressBar label="س" value={500} max={100} tone="warning" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-warning');
    unmount();

    renderUi(<ProgressBar label="س" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('w-1/3');
  });

  it('runs on a rounded surface-muted track, filled in the colour of its tone', () => {
    renderUi(
      <>
        <ProgressBar label="الهدف" value={100} tone="success" />
        <ProgressBar label="الحد" value={120} max={100} tone="danger" />
      </>,
    );
    const goal = screen.getByRole('progressbar', { name: 'الهدف' });
    expect(goal).toHaveClass('rounded-full', 'bg-surface-muted');
    expect(goal.firstElementChild).toHaveClass('bg-success');
    expect(screen.getByRole('progressbar', { name: 'الحد' }).firstElementChild).toHaveClass('bg-danger');
  });
});
