import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, Radio, RadioGroup } from './Checkbox';
import { ChoiceCard } from './ChoiceCard';
import { FieldGroup } from './FieldGroup';
import { canonicalNumber, displayNumber, MoneyField, NumberField } from './NumberField';
import { PasswordField } from './PasswordField';
import { SearchField } from './SearchField';
import { Select } from './Select';
import { Switch } from './Switch';
import { renderUi } from './test/render';
import { TextField } from './TextField';
import { ToggleChip } from './ToggleChip';

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
    const input = screen.getByLabelText('الاسم');
    // The bordered box carries the height, so the field is exactly as tall as a button beside it.
    expect(input.parentElement).toHaveClass('min-h-14');
    expect(input).toHaveClass('text-lg');
  });

  it('is 40 high with a mouse and 48 on a finger on the admin (comfortable)', () => {
    renderUi(<TextField label="الاسم" />);
    expect(screen.getByLabelText('الاسم').parentElement).toHaveClass('min-h-10', 'pointer-coarse:min-h-12');
  });

  it('draws the identity box: a surface, the 3:1 border and the brand halo on focus, no shadow', () => {
    renderUi(<TextField label="الاسم" hint="كما يظهر على الإيصال" />);

    const input = screen.getByLabelText('الاسم');
    expect(input.parentElement).toHaveClass(
      'border-line-control',
      'bg-surface',
      'focus-within:ring-brand/15',
    );
    expect(input.parentElement).not.toHaveClass('shadow-e1');
    expect(input).toHaveAccessibleDescription('كما يظهر على الإيصال');
    // A browser fill paints the input itself: rounded like the box, it never squares its corners.
    expect(input).toHaveClass('rounded-[inherit]');
  });

  it('insets an LTR number like Arabic text: the input pads both sides alike, the box adds the rest', () => {
    renderUi(<TextField label="السعر" dir="ltr" endAdornment={<span>ل.س</span>} />);

    const input = screen.getByLabelText('السعر');
    // An LTR input inside an Arabic box would swap its own start and end, so it has neither.
    expect(input).toHaveClass('px-2');
    expect(input.className).not.toMatch(/(^|\s)p[se]-/);
    // The box runs in the page's direction: the edge inset goes where no unit sits.
    expect(input.parentElement).toHaveClass('ps-1');
    expect(input.parentElement).not.toHaveClass('pe-1');
  });

  it("lets a font size of the screen's own replace the field's, at every pointer", () => {
    renderUi(
      <>
        <TextField label="رمز المتجر" dir="ltr" inputClassName="num text-2xl font-bold" />
        <TextField label="الاسم" inputClassName="num" />
      </>,
    );

    const code = screen.getByLabelText('رمز المتجر');
    expect(code).toHaveClass('text-2xl');
    expect(code).not.toHaveClass('text-[0.9375rem]');
    expect(code).not.toHaveClass('pointer-coarse:text-base');
    expect(screen.getByLabelText('الاسم')).toHaveClass('text-[0.9375rem]', 'pointer-coarse:text-base');
  });

  it('keeps a read-only value on the muted fill, still focusable', async () => {
    const { user } = renderUi(<TextField label="رمز المتجر" defaultValue="RAQ-001" readOnly dir="ltr" />);
    const input = screen.getByLabelText('رمز المتجر');
    expect(input.parentElement).toHaveClass('bg-surface-muted');
    await user.tab();
    expect(input).toHaveFocus();
  });

  it('marks an error on the box, and rings the box while you type in it', () => {
    renderUi(<TextField label="رقم الجوال" error="رقم الجوال ناقص." />);
    const input = screen.getByLabelText('رقم الجوال');
    expect(input.parentElement).toHaveClass('border-danger', 'ring-danger/15');
    // The border stays red when focused, so the global focus ring shows where the typing goes.
    expect(input.parentElement).toHaveClass(
      'has-[input:focus-visible]:outline-2',
      'has-[input:focus-visible]:outline-ring',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('greys a disabled field instead of fading it', () => {
    renderUi(<TextField label="الفرع" defaultValue="الرقة" disabled />);
    const input = screen.getByLabelText('الفرع');
    expect(input).toBeDisabled();
    expect(input.parentElement).toHaveClass('bg-surface-muted');
    expect(input.parentElement).not.toHaveClass('opacity-50');
  });
});

describe('PasswordField', () => {
  it('shows and hides the password with a pressed toggle', async () => {
    const { user } = renderUi(<PasswordField label="كلمة السر" defaultValue="raqqa2026" />);

    const input = screen.getByLabelText('كلمة السر');
    const toggle = screen.getByRole('button', { name: 'أظهر كلمة السر' });
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('NumberField', () => {
  it('shows its unit at the end of the box and keeps the number LTR', () => {
    function Weight() {
      const [value, setValue] = useState('1.25');
      return <NumberField label="الوزن" value={value} onValueChange={setValue} decimals={3} unit="كغ" />;
    }
    renderUi(<Weight />);

    const input = screen.getByLabelText('الوزن');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input.nextElementSibling).toHaveTextContent('كغ');
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
    // It has no caret: with the border kept red, the global focus ring shows the keyboard's place.
    expect(select).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-ring');
    expect(select).not.toHaveClass('focus:outline-hidden');
  });

  it('is the field box itself, at the density height', () => {
    renderUi(
      <Select label="الفرع" hint="فرع البيع">
        <option>الرقة</option>
      </Select>,
      { density: 'touch' },
    );

    const select = screen.getByRole('combobox', { name: 'الفرع' });
    expect(select).toHaveClass('min-h-14', 'rounded-control', 'border-line-control');
    expect(select).toHaveAccessibleDescription('فرع البيع');
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

  it('makes the whole row a 56 px target on touch, like the chips and buttons beside it', () => {
    renderUi(
      <>
        <Checkbox label="اطبع الإيصال" />
        <Radio name="pay" label="نقداً" />
      </>,
      { density: 'touch' },
    );
    expect(screen.getByText('اطبع الإيصال').closest('label')).toHaveClass('min-h-14');
    expect(screen.getByText('نقداً').closest('label')).toHaveClass('min-h-14');
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
    // The name is wired to the label itself, so a screen reader and an audit both read it on the button
    expect(toggle).toHaveAttribute('aria-labelledby');
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

  it('is toggled from the keyboard', async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Switch label="البيع دون مخزون" checked onCheckedChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('switch', { name: 'البيع دون مخزون' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('is as tall as the density controls, its button included: 56 on touch', () => {
    renderUi(<Switch label="البيع دون مخزون" checked onCheckedChange={vi.fn()} />, { density: 'touch' });

    const toggle = screen.getByRole('switch', { name: 'البيع دون مخزون' });
    expect(toggle).toHaveClass('min-h-14');
    expect(toggle.parentElement).toHaveClass('min-h-14');
  });
});

describe('FieldGroup', () => {
  it('names its controls with the legend and describes them with the hint and error', () => {
    renderUi(
      <FieldGroup legend="الإيصال" hint="بعد كل بيع" error="اختر طريقة واحدة على الأقل.">
        <Checkbox label="اطبع الإيصال" />
      </FieldGroup>,
    );

    const group = screen.getByRole('group', { name: 'الإيصال' });
    expect(group).toHaveAccessibleDescription('اختر طريقة واحدة على الأقل. بعد كل بيع');
    expect(screen.getByRole('checkbox', { name: 'اطبع الإيصال' })).toBeInTheDocument();
  });
});

describe('ChoiceCard', () => {
  it('is a radio named by its title, picked by a click anywhere on the card', async () => {
    const { user } = renderUi(
      <>
        <ChoiceCard name="sector" title="بقالية" description="باركود ووزن" />
        <ChoiceCard name="sector" title="مقهى" description="طاولات وطلبات" defaultChecked />
      </>,
    );

    const grocery = screen.getByRole('radio', { name: /بقالية/ });
    expect(grocery).not.toBeChecked();
    await user.click(screen.getByText('باركود ووزن'));
    expect(grocery).toBeChecked();
    expect(screen.getByRole('radio', { name: /مقهى/ })).not.toBeChecked();
  });
});

describe('ToggleChip', () => {
  it('is a checkbox by default and a radio when asked, named by its label', async () => {
    const { user } = renderUi(
      <>
        <ToggleChip label="حلويات" />
        <ToggleChip type="radio" name="size" label="وسط" />
      </>,
    );

    const chip = screen.getByRole('checkbox', { name: 'حلويات' });
    await user.click(screen.getByText('حلويات'));
    expect(chip).toBeChecked();
    expect(screen.getByRole('radio', { name: 'وسط' })).toBeInTheDocument();
  });

  it('is at least the density control height', () => {
    renderUi(<ToggleChip label="سفري" />, { density: 'touch' });
    expect(screen.getByText('سفري').closest('label')).toHaveClass('min-h-14');
  });
});
