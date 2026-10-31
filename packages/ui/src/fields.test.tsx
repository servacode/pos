import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, Radio, RadioGroup } from './Checkbox';
import { canonicalNumber, displayNumber, MoneyField } from './NumberField';
import { SearchField } from './SearchField';
import { Select } from './Select';
import { Switch } from './Switch';
import { renderUi } from './test/render';
import { TextField } from './TextField';

describe('TextField', () => {
  it('links its label, hint and error to the input', () => {
    renderUi(<TextField label="رقم الجوال" hint="يبدأ بـ 09" error="رقم الجوال ناقص." />);

    const input = screen.getByLabelText('رقم الجوال');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('رقم الجوال ناقص.');
    // The hint gives way to the error.
    expect(screen.queryByText('يبدأ بـ 09')).not.toBeInTheDocument();
  });

  it('is 56 high with 18 px text on the touch density', () => {
    renderUi(<TextField label="الاسم" />, { density: 'touch' });
    expect(screen.getByLabelText('الاسم')).toHaveClass('min-h-14', 'text-lg');
  });
});

describe('canonicalNumber', () => {
  it.each([
    ['1,250', 0, false, '1250'],
    ['١٬٢٥٠٫٥', 2, false, '1250.5'],
    ['۱۲۳', 0, false, '123'],
    ['12.345', 2, false, '12.34'],
    ['12.5', 0, false, '12'],
    ['0012', 0, false, '12'],
    ['.5', 2, false, '0.5'],
    ['12.', 2, false, '12.'],
    ['−300', 0, true, '-300'],
    ['-300', 0, false, '300'],
    ['abc', 0, false, ''],
  ])('reads %j (decimals %i, negative %s) as %j', (typed, decimals, negative, expected) => {
    expect(canonicalNumber(typed, decimals, negative)).toBe(expected);
  });
});

describe('displayNumber', () => {
  it('groups thousands in the store digits', () => {
    expect(displayNumber('1250000.5', 'latn')).toBe('1,250,000.5');
    expect(displayNumber('-1250.5', 'arab')).toBe('−١٬٢٥٠٫٥');
  });
});

function Controlled({ currency, initial }: { currency: 'SYP' | 'USD'; initial: number | null }) {
  const [minor, setMinor] = useState<number | null>(initial);
  return (
    <>
      <MoneyField label="المبلغ" currency={currency} valueMinor={minor} onValueChange={setMinor} />
      <output>{minor === null ? 'فارغ' : String(minor)}</output>
      <button type="button" onClick={() => setMinor(500000)}>
        5000
      </button>
    </>
  );
}

describe('MoneyField', () => {
  it('takes Arabic-Indic digits, groups thousands while typing and reports minor units', async () => {
    const { user } = renderUi(<Controlled currency="SYP" initial={null} />);

    const input = screen.getByLabelText('المبلغ');
    await user.type(input, '١٢٥٠');
    expect(input).toHaveValue('1,250');
    expect(screen.getByRole('status')).toHaveTextContent('125000');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveClass('num');
  });

  it('accepts two decimals for the dollar and none for the new pound', async () => {
    const { user } = renderUi(<Controlled currency="USD" initial={1250} />);

    const input = screen.getByLabelText('المبلغ');
    expect(input).toHaveValue('12.50');
    await user.clear(input);
    await user.type(input, '12.505');
    expect(input).toHaveValue('12.50');
    expect(screen.getByRole('status')).toHaveTextContent('1250');
  });

  it('shows the currency symbol inside the field', () => {
    renderUi(<Controlled currency="SYP" initial={null} />);
    expect(screen.getByText('ل.س')).toBeInTheDocument();
  });

  it('follows an amount set from outside, e.g. a quick-cash button', async () => {
    const { user } = renderUi(<Controlled currency="SYP" initial={null} />);

    await user.click(screen.getByRole('button', { name: '5000' }));
    expect(screen.getByLabelText('المبلغ')).toHaveValue('5,000');
  });

  it('shows Arabic-Indic digits when the store uses them', () => {
    renderUi(<Controlled currency="SYP" initial={125000} />, { digits: 'arab' });
    expect(screen.getByLabelText('المبلغ')).toHaveValue('١٬٢٥٠');
  });
});

describe('Select', () => {
  it('is a labelled native select that shows its error', () => {
    renderUi(
      <Select label="المدينة" error="اختر مدينة.">
        <option>الرقة</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'المدينة' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('اختر مدينة.');
  });
});

describe('SearchField', () => {
  function Search() {
    const [value, setValue] = useState('');
    return <SearchField label="ابحث باسم المنتج" value={value} onValueChange={setValue} slashShortcut />;
  }

  it('is reached with «/» from anywhere on the page, but not while typing in another field', async () => {
    const { user } = renderUi(
      <>
        <input aria-label="ملاحظة" />
        <Search />
      </>,
    );

    const search = screen.getByRole('searchbox', { name: 'ابحث باسم المنتج' });
    await user.click(screen.getByLabelText('ملاحظة'));
    await user.keyboard('/');
    expect(search).not.toHaveFocus();
    expect(screen.getByLabelText('ملاحظة')).toHaveValue('/');

    (document.activeElement as HTMLElement).blur();
    await user.keyboard('/');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
  });

  it('clears with Escape or the clear button', async () => {
    const { user } = renderUi(<Search />);

    const search = screen.getByRole('searchbox');
    await user.type(search, 'حليب');
    await user.click(screen.getByRole('button', { name: 'امسح البحث' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();

    await user.type(search, 'سكر{Escape}');
    expect(search).toHaveValue('');
  });
});

describe('Checkbox and Radio', () => {
  it('shows «بعضها» on a select-all box', () => {
    renderUi(<Checkbox label="حدّد الكل" indeterminate />);

    const box = screen.getByRole('checkbox', { name: 'حدّد الكل' });
    expect((box as HTMLInputElement).indeterminate).toBe(true);
    expect(box).toHaveAttribute('aria-checked', 'mixed');
  });

  it('makes the whole row a 48 px target on touch', () => {
    renderUi(<Checkbox label="اطبع الإيصال" />, { density: 'touch' });
    expect(screen.getByText('اطبع الإيصال').closest('label')).toHaveClass('min-h-12');
  });

  it('groups radios under a legend', async () => {
    const { user } = renderUi(
      <RadioGroup legend="طريقة الدفع">
        <Radio name="pay" label="نقداً" defaultChecked />
        <Radio name="pay" label="شام كاش" />
      </RadioGroup>,
    );

    expect(screen.getByRole('group', { name: 'طريقة الدفع' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('شام كاش'));
    expect(screen.getByRole('radio', { name: 'شام كاش' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'نقداً' })).not.toBeChecked();
  });
});

describe('Switch', () => {
  it('is a role="switch" named by its label, toggled by a click on the label too', async () => {
    const onChange = vi.fn();
    const { user } = renderUi(
      <Switch
        label="أرسل الفاتورة على واتساب"
        description="للزبائن المسجّلين"
        checked={false}
        onCheckedChange={onChange}
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'أرسل الفاتورة على واتساب' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('للزبائن المسجّلين');
    await user.click(screen.getByText('أرسل الفاتورة على واتساب'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    renderUi(<Switch label="الوضع الكثيف" checked onCheckedChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
