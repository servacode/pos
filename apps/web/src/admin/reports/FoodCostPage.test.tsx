import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodCostReport } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { NOW, TODAY } from '../../test/reports';
import { foodCostCsv, marginPercent } from './FoodCostPage';

const report: FoodCostReport = {
  from: '2026-11-01',
  to: '2026-11-13',
  baseCurrency: 'SYP',
  totalSoldMinor: 300_000,
  totalCostMinor: 30_000,
  withoutRecipe: [{ productId: 's', name: 'سلطة' }],
  rows: [
    {
      productId: 'p1',
      name: 'بيتزا',
      priceMinor: 100_000,
      costMinor: 10_000,
      incomplete: true,
      marginMinor: 90_000,
      marginBp: 9_000,
      soldQty: 3000,
      soldCostMinor: 30_000,
      soldTotalMinor: 300_000,
    },
  ],
};

describe('كلفة الوجبات', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows each dish with its cost and margin, and the dishes sold with no recipe', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: (() => {
          const me = makeMe();
          return { ...me, user: { ...me.user, permissions: [...me.user.permissions, 'report.view'] } };
        })(),
      },
      [`GET /v1/reports/food-cost?from=${TODAY.slice(0, 8)}01&to=${TODAY}`]: { status: 200, body: report },
    });
    renderApp('/reports/food-cost');
    expect(await screen.findByRole('heading', { name: 'كلفة الوجبات', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('بيتزا')).toBeInTheDocument();
    expect(screen.getByText('كلفة ناقصة')).toBeInTheDocument();
    expect(screen.getByText('90٪')).toBeInTheDocument();
    expect(screen.getByText('سلطة')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('writes the margin as a percent and a CSV for Excel', () => {
    expect(marginPercent(9_000)).toBe('90٪');
    expect(marginPercent(null)).toBe('—');
    const csv = foodCostCsv(report);
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    expect(csv).toContain('"بيتزا"');
    expect(csv).toContain('90');
  });
});
