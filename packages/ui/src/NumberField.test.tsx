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
