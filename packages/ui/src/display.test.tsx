import { screen, within } from '@testing-library/react';
import { formatMoney, stripBidiControls } from '@serva/core';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, initialsOf } from './Avatar';
import { Balance } from './Balance';
import { STATUSES, StatusChip, type Status } from './Badge';
import { Banner } from './Banner';
import { Card, StatTile } from './Card';
import { DataTable, type DataColumn } from './DataTable';
import { EmptyState } from './EmptyState';
import { CustomersIcon } from './icons';
import { AppIcon, Logo, LOGO_S_PATH, LogoMark, LogoStacked } from './Logo';
import { Money } from './Money';
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
  it('marks a selected card with brand-soft and a brand border, not surface', () => {
    renderUi(<Card selected>مقهى الياسمين</Card>);

    const card = screen.getByText('مقهى الياسمين');
    expect(card).toHaveClass('bg-brand-soft', 'border-brand');
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
    expect(screen.getByRole('radio')).toHaveClass('min-h-12');
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
    expect(svg.querySelector('rect')).toHaveClass('fill-brand');
    const path = svg.querySelector('path')!;
    expect(path).toHaveAttribute('d', 'M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42');
    expect(path).toHaveAttribute('stroke-width', '7');
    expect(path).toHaveAttribute('stroke-linecap', 'round');
    expect(path).toHaveClass('stroke-on-brand');
    const dot = svg.querySelector('circle')!;
    expect([dot.getAttribute('cx'), dot.getAttribute('cy'), dot.getAttribute('r')]).toEqual([
      '46',
      '46',
      '3.5',
    ]);
    expect(dot).toHaveClass('fill-brand-soft', 'dark:fill-on-brand');
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

  it('writes «Serva» in Latin and «سيرفا» under it in brand-ink', () => {
    renderUi(
      <>
        <Logo />
        <LogoStacked />
      </>,
    );
    for (const latin of screen.getAllByText('Serva')) {
      expect(latin).toHaveAttribute('lang', 'en');
      expect(latin).toHaveAttribute('dir', 'ltr');
      expect(latin).toHaveClass('font-bold');
    }
    for (const arabic of screen.getAllByText('سيرفا'))
      expect(arabic).toHaveClass('text-brand-ink', 'font-semibold');
    expect(LOGO_S_PATH).toBe('M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42');
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
});
