import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MoneyField } from './NumberField';

function Harness({ currency }: { currency: 'SYP' | 'USD' }) {
  const [minor, setMinor] = useState<number | null>(null);
  return (
    <>
      <MoneyField label="السعر" currency={currency} valueMinor={minor} onValueChange={setMinor} />
      <output data-testid="minor">{String(minor)}</output>
    </>
  );
}

describe('MoneyField', () => {
  it('says a currency shown without fractions drops the point, instead of silently changing the amount', async () => {
    const user = userEvent.setup();
    render(<Harness currency="SYP" />);
    await user.type(screen.getByLabelText('السعر'), '60000.');
    expect(screen.getByText(/تُعرض بلا كسور/)).toBeInTheDocument();
  });

  it('keeps the fraction of a currency that has one, with no notice', async () => {
    const user = userEvent.setup();
    render(<Harness currency="USD" />);
    await user.type(screen.getByLabelText('السعر'), '12.50');
    expect(screen.getByTestId('minor')).toHaveTextContent('1250');
    expect(screen.queryByText(/تُعرض بلا كسور/)).not.toBeInTheDocument();
  });

  it('refuses an absurdly large amount with a message and does not pass it on', async () => {
    const user = userEvent.setup();
    render(<Harness currency="USD" />);
    await user.type(screen.getByLabelText('السعر'), '99999999999999999');
    expect(screen.getByText('المبلغ كبير جداً: تحقّق من الأصفار')).toBeInTheDocument();
    expect(Number(screen.getByTestId('minor').textContent)).toBeLessThan(1e13);
  });
});

describe('MoneyField letters', () => {
  it('refuses letters with a message and keeps the number as it was', async () => {
    const user = userEvent.setup();
    render(<Harness currency="SYP" />);
    const field = screen.getByLabelText('السعر');
    await user.type(field, '4');
    await user.type(field, 'W');
    expect(screen.getByText('اكتب أرقاماً فقط')).toBeInTheDocument();
    expect(screen.getByTestId('minor')).toHaveTextContent('400');
    await user.type(field, '5');
    expect(screen.queryByText('اكتب أرقاماً فقط')).not.toBeInTheDocument();
    expect(screen.getByTestId('minor')).toHaveTextContent('4500');
  });
});

describe('MoneyField refusals', () => {
  it('refuses a minus with a reason and keeps the amount as it was', async () => {
    const user = userEvent.setup();
    render(<Harness currency="SYP" />);
    const field = screen.getByLabelText('السعر');
    await user.type(field, '-');
    expect(screen.getByText('لا يُقبل مبلغ سالب')).toBeInTheDocument();
    expect(screen.getByTestId('minor')).toHaveTextContent('null');
    // The digits typed after the refused sign are ignored too: «-5» must not become 5
    await user.type(field, '5');
    expect(screen.getByText('لا يُقبل مبلغ سالب')).toBeInTheDocument();
    expect(screen.getByTestId('minor')).toHaveTextContent('null');
    await user.tab();
    expect(screen.queryByText('لا يُقبل مبلغ سالب')).not.toBeInTheDocument();
    await user.type(field, '5');
    expect(screen.getByTestId('minor')).toHaveTextContent('500');
  });

  it('does not turn 2500.5 into 25005: the digits after a refused point are ignored', async () => {
    const user = userEvent.setup();
    render(<Harness currency="SYP" />);
    const field = screen.getByLabelText('السعر');
    await user.type(field, '2500.5');
    expect(screen.getByTestId('minor')).toHaveTextContent('250000');
    expect(screen.getByText(/تُعرض بلا كسور/)).toBeInTheDocument();
    // Deleting a digit lifts it: typing goes on
    await user.type(field, '{Backspace}7');
    expect(screen.getByTestId('minor')).toHaveTextContent('250700');
  });

  it('refuses a fraction a currency without fractions cannot keep, instead of cutting it', async () => {
    const user = userEvent.setup();
    render(<Harness currency="SYP" />);
    await user.type(screen.getByLabelText('السعر'), '2500');
    await user.paste('.5');
    expect(screen.getByText(/تُعرض بلا كسور/)).toBeInTheDocument();
    expect(screen.getByTestId('minor')).toHaveTextContent('250000');
  });

  it('refuses a third fraction digit of a two-digit currency', async () => {
    const user = userEvent.setup();
    render(<Harness currency="USD" />);
    await user.type(screen.getByLabelText('السعر'), '12.505');
    expect(screen.getByText(/أكثر من 2 خانات/)).toBeInTheDocument();
    expect(screen.getByTestId('minor')).toHaveTextContent('1250');
  });
});
