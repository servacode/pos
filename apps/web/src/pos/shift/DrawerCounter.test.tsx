import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Keypad } from '@serva/ui';
import { DrawerCounter, totalCount, useCountKeypad } from './DrawerCounter';
import { countTotal, type DrawerCount } from './shift';

/** The same pair the shift screens use: drawers typed as a total, and the keypad beside them */
function Harness({ currencies }: { currencies: ('SYP' | 'USD')[] }) {
  const [counts, setCounts] = useState<DrawerCount[]>(currencies.map((c) => totalCount(c)));
  const keypad = useCountKeypad(counts, setCounts, null);
  return (
    <div>
      {counts.map((count, i) => (
        <DrawerCounter
          key={count.currency}
          count={count}
          onChange={(next) => setCounts((list) => list.map((c, j) => (j === i ? next : c)))}
          active={keypad.activeIn(count.currency)}
          onActivate={(key) => keypad.activate(count.currency, key)}
          fraction={keypad.fractionIn(count.currency)}
        />
      ))}
      <Keypad label="لوحة العدّ" {...keypad.keypad} />
      <output aria-label="usd">
        {counts.find((c) => c.currency === 'USD')
          ? countTotal(counts.find((c) => c.currency === 'USD')!)
          : ''}
      </output>
      <output aria-label="syp">
        {counts.find((c) => c.currency === 'SYP')
          ? countTotal(counts.find((c) => c.currency === 'SYP')!)
          : ''}
      </output>
    </div>
  );
}

const press = async (user: ReturnType<typeof userEvent.setup>, keys: string) => {
  const pad = screen.getByRole('group', { name: 'لوحة العدّ' });
  for (const k of keys) {
    const name = k === '<' ? 'امسح رقماً' : k;
    await user.click(
      k === '<'
        ? screen.getByRole('button', { name })
        : [...pad.querySelectorAll('button')].find((b) => b.textContent === k)!,
    );
  }
};

describe('the shift count keypad (round 39)', () => {
  it('has a decimal point for the dollar drawer: 51 . 2 4 counts 51.24 $', async () => {
    const user = userEvent.setup();
    render(<Harness currencies={['USD']} />);
    expect(screen.getByRole('button', { name: '.' })).toBeTruthy();
    await press(user, '51.24');
    expect(screen.getByLabelText('usd').textContent).toBe('5124');
    // a third decimal is not taken, and the field shows what was typed
    await press(user, '9');
    expect(screen.getByLabelText('usd').textContent).toBe('5124');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('51.24');
  });

  it('keeps a typed zero after the point («51.0» then 5 is 51.05, not 515), and backspace walks back over the cents', async () => {
    const user = userEvent.setup();
    render(<Harness currencies={['USD']} />);
    await press(user, '51.05');
    expect(screen.getByLabelText('usd').textContent).toBe('5105');
    await press(user, '<<');
    expect(screen.getByLabelText('usd').textContent).toBe('5100');
    await press(user, '<');
    expect(screen.getByLabelText('usd').textContent).toBe('5100');
    await press(user, '<');
    expect(screen.getByLabelText('usd').textContent).toBe('500');
  });

  it('keeps the pound drawer whole: its keypad has «00», no point', async () => {
    const user = userEvent.setup();
    render(<Harness currencies={['SYP']} />);
    expect(screen.queryByRole('button', { name: '.' })).toBeNull();
    await press(user, '5');
    await user.click(screen.getByRole('button', { name: '00' }));
    expect(screen.getByLabelText('syp').textContent).toBe('50000');
  });

  it('takes a point typed in the field itself, and drops it for the pound (1500.75 is 1,500 whole pounds)', async () => {
    const user = userEvent.setup();
    render(<Harness currencies={['USD', 'SYP']} />);
    const [usd, syp] = screen.getAllByRole('textbox') as HTMLInputElement[];
    await user.type(usd!, '51.24');
    expect(usd!.value).toBe('51.24');
    expect(screen.getByLabelText('usd').textContent).toBe('5124');
    await user.type(syp!, '1500.75');
    expect(screen.getByLabelText('syp').textContent).toBe('150000');
  });
});
