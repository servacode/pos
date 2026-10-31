import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLE_KEYS,
  PLATFORM_ROLE_PERMISSIONS,
  platformCan,
  type PlatformRole,
} from './permissions';
import {
  CORE_FEATURES,
  FEATURES,
  FEATURE_KEYS,
  SECTORS,
  SECTOR_FAMILIES,
  SECTOR_KEYS,
  SUGGESTED_FEATURES_MAX,
  featuresToOffer,
  getSector,
  needsTaxNotice,
  suggestFeatures,
  type FeatureKey,
  type SectorKey,
} from './sectors';

describe('the sector catalogue', () => {
  it('gives every sector a family, an icon, known features and priced sample items', () => {
    for (const sector of SECTORS) {
      expect(SECTOR_FAMILIES).toContain(sector.family);
      expect(sector.icon.length).toBeGreaterThan(0);
      for (const feature of sector.suggestedFeatures) expect(FEATURE_KEYS).toContain(feature);
      expect(new Set(sector.suggestedFeatures).size).toBe(sector.suggestedFeatures.length);
      expect(sector.demoItems.length).toBeGreaterThanOrEqual(4);
      const keys = sector.demoItems.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const demo of sector.demoItems) {
        expect(Number.isSafeInteger(demo.priceMinor) && demo.priceMinor > 0).toBe(true);
        expect(demo.priceMinor % 100).toBe(0);
      }
    }
  });

  it('covers the seven families of tab 03', () => {
    expect(new Set(SECTORS.map((s) => s.family))).toEqual(new Set(SECTOR_FAMILIES));
  });

  it('suggests each feature for the sectors of tab 04 and nothing else', () => {
    const suggestedFor = (feature: FeatureKey) =>
      SECTORS.filter((s) => (s.suggestedFeatures as readonly string[]).includes(feature)).map((s) => s.key);
    expect(suggestedFor('variants')).toEqual(['clothing', 'cosmetics']);
    expect(suggestedFor('tables')).toEqual(['restaurant', 'cafe']);
    expect(suggestedFor('weighed_items')).toEqual(['supermarket', 'bakery', 'produce']);
    expect(suggestedFor('timed_pricing')).toEqual(['cafe']);
    // «لا تُقترح، تُفعَّل عند إضافة فرع»
    expect(suggestedFor('multi_branch')).toEqual([]);
  });

  it('has a one-line Arabic explanation for every switch and six fixed basics', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURES[key].labelAr.length).toBeGreaterThan(0);
      expect(FEATURES[key].descriptionAr.length).toBeGreaterThan(0);
    }
    expect(FEATURE_KEYS).toHaveLength(23);
    expect(CORE_FEATURES.map((f) => f.key)).toEqual([
      'sales',
      'products',
      'inventory',
      'customers',
      'reports',
      'currencies',
    ]);
  });

  it('finds a sector by key, and nothing for an unknown one', () => {
    expect(getSector('cafe')?.labelAr).toBe('مقهى وكافتيريا');
    expect(getSector('kiosk' as SectorKey)).toBeUndefined();
  });
});

describe('suggestFeatures', () => {
  it('turns on variants, quick exchange and seller commissions for clothing (23 › 1)', () => {
    const clothing = suggestFeatures(['clothing']);
    expect(clothing).toEqual(expect.arrayContaining(['variants', 'quick_exchange', 'sales_commissions']));
    expect(clothing).not.toContain('tables');
    expect(clothing).not.toContain('kitchen_printing');
  });

  it('gives a café with a bakery the six of the design board', () => {
    expect(suggestFeatures(['cafe', 'bakery'])).toEqual([
      'modifiers',
      'order_numbers',
      'kitchen_printing',
      'tables',
      'recipes',
      'loyalty',
    ]);
  });

  it('takes the first chosen sector first', () => {
    expect(suggestFeatures(['produce', 'clothing']).slice(0, 2)).toEqual(['weighed_items', 'variants']);
  });

  it('starts a quick-service restaurant without the hall', () => {
    expect(suggestFeatures(['restaurant'])).toContain('tables');
    expect(suggestFeatures(['restaurant'], { restaurantMode: 'quick' })).not.toContain('tables');
    expect(suggestFeatures(['restaurant'], { restaurantMode: 'dine_in' })).toContain('tables');
    // The mode concerns the restaurant only
    expect(suggestFeatures(['cafe'], { restaurantMode: 'quick' })).toContain('tables');
  });

  it('suggests nothing for a general store or an unknown sector', () => {
    expect(suggestFeatures(['general'])).toEqual([]);
    expect(suggestFeatures(['kiosk' as SectorKey])).toEqual([]);
    expect(suggestFeatures([])).toEqual([]);
  });

  it('is at most six known features without repeats, all from the chosen sectors', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...SECTOR_KEYS)), fc.boolean(), (sectors, quick) => {
        const out = suggestFeatures(sectors, { restaurantMode: quick ? 'quick' : 'dine_in' });
        expect(out.length).toBeLessThanOrEqual(SUGGESTED_FEATURES_MAX);
        expect(new Set(out).size).toBe(out.length);
        const pool = new Set(sectors.flatMap((s) => getSector(s)?.suggestedFeatures ?? []));
        for (const f of out) expect(pool.has(f)).toBe(true);
        const distinct =
          pool.size - (quick && sectors.includes('restaurant') && !sectors.includes('cafe') ? 1 : 0);
        expect(out.length).toBe(Math.min(SUGGESTED_FEATURES_MAX, distinct));
      }),
    );
  });
});

describe('featuresToOffer', () => {
  it('offers the café features not yet on when a café is added to a clothing store (23 › 1)', () => {
    const enabled = suggestFeatures(['clothing']);
    const offers = featuresToOffer(['clothing'], ['clothing', 'cafe'], [...enabled, 'loyalty']);
    expect(offers).toEqual([
      'modifiers',
      'order_numbers',
      'kitchen_printing',
      'tables',
      'recipes',
      'timed_pricing',
      'delivery',
    ]);
  });

  it('offers nothing when no sector is added, and never removes', () => {
    expect(featuresToOffer(['cafe'], ['cafe'], [])).toEqual([]);
    expect(featuresToOffer(['cafe', 'clothing'], ['clothing'], ['tables'])).toEqual([]);
  });

  it('respects the quick-service answer and repeats nothing', () => {
    expect(featuresToOffer([], ['restaurant', 'cafe'], [], { restaurantMode: 'quick' })).toContain('tables');
    const offers = featuresToOffer([], ['restaurant', 'cafe'], []);
    expect(new Set(offers).size).toBe(offers.length);
    expect(featuresToOffer([], ['restaurant'], [], { restaurantMode: 'quick' })).not.toContain('tables');
  });
});

describe('needsTaxNotice', () => {
  it('is true only with wholesale among the sectors (07)', () => {
    expect(needsTaxNotice(['wholesale'])).toBe(true);
    expect(needsTaxNotice(['cafe', 'wholesale'])).toBe(true);
    expect(needsTaxNotice(['cafe', 'pharmacy'])).toBe(false);
    expect(needsTaxNotice(['kiosk' as SectorKey])).toBe(false);
  });
});

describe('platform roles', () => {
  it('lists the three roles of the platform_role enum', () => {
    expect(PLATFORM_ROLE_KEYS).toEqual(['super_admin', 'support', 'accountant']);
  });

  it('gives the general manager everything', () => {
    expect(ALL_PLATFORM_PERMISSIONS).toEqual(Object.keys(PLATFORM_PERMISSIONS));
    for (const p of ALL_PLATFORM_PERMISSIONS) expect(platformCan('super_admin', p)).toBe(true);
  });

  it('lets the accountant confirm payments but not reverse them, nor touch prices or accounts (07, 13)', () => {
    expect(platformCan('accountant', 'platform.payments.decide')).toBe(true);
    expect(platformCan('accountant', 'platform.payments.unconfirm')).toBe(false);
    expect(platformCan('accountant', 'platform.plans.manage')).toBe(false);
    expect(platformCan('accountant', 'platform.payment_accounts.manage')).toBe(false);
    expect(platformCan('accountant', 'platform.stores.extend')).toBe(false);
  });

  it('lets support see stores and write notes only', () => {
    expect(PLATFORM_ROLE_PERMISSIONS.support).toEqual(['platform.stores.view', 'platform.stores.notes']);
    expect(platformCan('support', 'platform.payments.view')).toBe(false);
  });

  it('keeps the sensitive keys with the general manager alone', () => {
    for (const p of [
      'platform.payment_accounts.manage',
      'platform.approvals.decide',
      'platform.audit.view',
      'platform.stores.suspend',
    ] as const) {
      expect(PLATFORM_ROLE_KEYS.filter((r) => platformCan(r, p))).toEqual(['super_admin']);
    }
  });

  it('answers false for an unknown role', () => {
    expect(platformCan('developer' as PlatformRole, 'platform.stores.view')).toBe(false);
  });

  it('never shares a key with the store permissions', async () => {
    const { ALL_PERMISSIONS } = await import('./permissions');
    for (const p of ALL_PLATFORM_PERMISSIONS) expect((ALL_PERMISSIONS as string[]).includes(p)).toBe(false);
  });
});
