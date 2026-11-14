import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { ids, PINS } from '../../test/pos';
import { openShift, renderPos } from '../../test/renderPos';

async function signIn(user: ReturnType<typeof renderPos>['user']) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /سامر/ }));
  await user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
}

describe('reloading the till', () => {
  it('keeps the cashier signed in within the idle window, with no code asked', async () => {
    const local = memoryLocal();
    await openShift(local);
    const first = renderPos({ local });
    await signIn(first.user);
    first.view.unmount();
    renderPos({ local });
    expect(await screen.findByRole('list', { name: 'الأصناف' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'الموظفون' })).not.toBeInTheDocument();
    // No code is kept anywhere
    expect(JSON.stringify(globalThis.sessionStorage)).not.toContain(PINS[ids.samer]!);
  });

  it('asks for the code again after the screen is locked, and after the idle window', async () => {
    const local = memoryLocal();
    await openShift(local);
    const first = renderPos({ local });
    await signIn(first.user);
    await first.user.click(screen.getByRole('button', { name: 'المزيد' }));
    await first.user.click(screen.getByRole('menuitem', { name: /اقفل الشاشة/ }));
    await screen.findByRole('list', { name: 'الموظفون' });
    first.view.unmount();
    renderPos({ local });
    expect(await screen.findByRole('list', { name: 'الموظفون' })).toBeInTheDocument();
  });

  it('asks again when the last touch is older than the idle window', async () => {
    const local = memoryLocal();
    await openShift(local);
    let clock = Date.now();
    const first = renderPos({ local, now: () => clock });
    await signIn(first.user);
    first.view.unmount();
    clock += 6 * 60_000;
    renderPos({ local, now: () => clock });
    expect(await screen.findByRole('list', { name: 'الموظفون' })).toBeInTheDocument();
  });
});
