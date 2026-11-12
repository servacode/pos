import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { bannerFor, SubscriptionChip } from './subscription-banner';

const facts = (over: Partial<Parameters<typeof bannerFor>[0]> = {}) => ({
  lifecycle: 'trialing' as const,
  readOnly: false,
  daysLeft: 20,
  ...over,
});

describe('bannerFor', () => {
  it('says nothing while there is time', () => {
    expect(bannerFor(facts())).toBeNull();
    expect(bannerFor(facts({ lifecycle: 'active', daysLeft: 4 }))).toBeNull();
    expect(bannerFor(facts({ lifecycle: 'active', daysLeft: null }))).toBeNull();
  });

  it('warns when the trial or the period ends within 3 days', () => {
    expect(bannerFor(facts({ daysLeft: 3 }))).toMatchObject({ kind: 'ending', tone: 'warning' });
    expect(bannerFor(facts({ daysLeft: 3 }))!.title).toContain('تجربتك المجانية');
    expect(bannerFor(facts({ lifecycle: 'active', daysLeft: 1 }))!.title).toBe('تنتهي اشتراكك خلال يوم واحد');
    expect(bannerFor(facts({ daysLeft: 0 }))!.title).toBe('تنتهي تجربتك المجانية اليوم');
  });

  it('names the days of grace left and sends the owner to pay', () => {
    const spec = bannerFor(facts({ lifecycle: 'grace', daysLeft: 4 }))!;
    expect(spec).toMatchObject({ kind: 'grace', tone: 'warning' });
    expect(spec.detail).toContain('باقي 4 أيام');
    expect(spec.detail).toContain('ادفع الآن');
    expect(bannerFor(facts({ lifecycle: 'grace', daysLeft: 0 }))!.detail).toContain('ينتهي البيع اليوم');
  });

  it('explains read-only: what still works, nothing deleted, how to come back', () => {
    const spec = bannerFor(facts({ lifecycle: 'read_only', readOnly: true, daysLeft: 0 }))!;
    expect(spec).toMatchObject({ kind: 'read_only', tone: 'danger' });
    expect(spec.title).toBe('المتجر الآن للقراءة والتصدير فقط');
    expect(spec.detail).toMatch(/لا شيء محذوف/);
    // The server's flag alone is enough, whatever the lifecycle text says
    expect(bannerFor(facts({ lifecycle: 'grace', readOnly: true }))!.kind).toBe('read_only');
  });
});

describe('the till chip', () => {
  it('shows nothing when all is well, and tells the cashier whom to ask', () => {
    const { container, rerender } = render(<SubscriptionChip subscription={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <SubscriptionChip
        subscription={{ lifecycle: 'read_only', readOnly: true, daysLeft: 0, writeUntil: null }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('للقراءة فقط. أخبر المالك');
    rerender(
      <SubscriptionChip
        subscription={{ lifecycle: 'grace', readOnly: false, daysLeft: 3, writeUntil: null }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('مهلة السماح');
  });
});

function signedIn(
  subscription: Partial<MeResponse['subscription']>,
  permissions: MeResponse['user']['permissions'],
) {
  const me = makeMe(subscription);
  mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: { ...me, user: { ...me.user, permissions } } },
  });
  return renderApp('/');
}

describe('the banner in the admin', () => {
  it('shows the read-only state with a pay link for whoever manages the subscription', async () => {
    signedIn({ status: 'active', lifecycle: 'read_only', readOnly: true, daysLeft: 0, graceDaysLeft: 0 }, [
      'subscription.manage',
    ]);
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('المتجر الآن للقراءة والتصدير فقط');
    expect(screen.getAllByRole('link', { name: 'ادفع الآن' })[0]).toHaveAttribute('href', '/subscription');
  });

  it('tells the others to ask the owner instead of offering a link they cannot use', async () => {
    signedIn({ status: 'active', lifecycle: 'grace', readOnly: false, daysLeft: 0, graceDaysLeft: 5 }, []);
    expect(await screen.findByText(/انتهى اشتراكك وأنت في مهلة السماح/)).toBeInTheDocument();
    expect(screen.getByText(/اطلب من مالك المتجر/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ادفع الآن' })).toBeNull();
  });

  it('is quiet in a healthy trial', async () => {
    signedIn({}, ['subscription.manage']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(screen.queryByText(/مهلة السماح|للقراءة والتصدير/)).toBeNull();
  });
});
