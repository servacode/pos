import { describe, expect, it } from 'vitest';
import { suggestCategoryName, suggestFor } from './categorySuggest';

const cat = (id: string, name: string) => ({ id, name, archivedAt: null });

describe('suggestCategoryName', () => {
  it('reads a medical store name by its words', () => {
    const med = ['medical_supplies'] as const;
    expect(suggestCategoryName('قفازات طبية', med)).toBe('مستهلكات');
    expect(suggestCategoryName('شاش معقم', med)).toBe('مستهلكات');
    expect(suggestCategoryName('جهاز ضغط', med)).toBe('أجهزة قياس');
    expect(suggestCategoryName('كرسي متحرك', med)).toBe('كراسي متحركة');
  });

  it('reads a clothing store name by its words, and never uses medical words there', () => {
    const clothes = ['clothing'] as const;
    expect(suggestCategoryName('بنطال جينز', clothes)).toBe('بناطيل');
    expect(suggestCategoryName('تيشيرت قطن رجالي', clothes)).toBe('قمصان');
    expect(suggestCategoryName('جوارب قطن', clothes)).toBe('جوارب');
    expect(suggestCategoryName('قفازات صوف', clothes)).toBeNull();
  });

  it('never proposes a grocery category in a medical store, and reads catheters and thermometers', () => {
    const med = ['medical_supplies'] as const;
    expect(suggestCategoryName('قسطرة فولي', med)).toBe('مستهلكات');
    expect(suggestCategoryName('ميزان حرارة رقمي', med)).toBe('أجهزة قياس');
    expect(suggestCategoryName('ترمومتر', med)).toBe('أجهزة قياس');
    expect(suggestCategoryName('حليب أطفال', med)).not.toBe('ألبان وأجبان');
    expect(suggestCategoryName('معلب فول', ['pharmacy'])).toBeNull();
    // A grocery store keeps them
    expect(suggestCategoryName('فول مدمس', ['supermarket'])).toBe('معلبات');
  });

  it('uses the store’s own longer name for a category', () => {
    expect(suggestFor('قفازات', [cat('c1', 'مستهلكات طبية')], ['medical_supplies'])).toEqual({
      categoryId: 'c1',
      newName: null,
    });
  });

  it('says nothing for a name it does not know', () => {
    expect(suggestCategoryName('شيء غريب', ['supermarket'])).toBeNull();
    expect(suggestCategoryName('   ', undefined)).toBeNull();
  });
});

describe('suggestFor', () => {
  it("uses the store's own category when the suggested name exists", () => {
    expect(suggestFor('قفازات', [cat('c1', 'مستهلكات')], ['medical_supplies'])).toEqual({
      categoryId: 'c1',
      newName: null,
    });
  });

  it('proposes a new category when none fits, and the category named inside the product name otherwise', () => {
    expect(suggestFor('قفازات', [], ['medical_supplies'])).toEqual({ categoryId: null, newName: 'مستهلكات' });
    expect(suggestFor('حليب بقر', [cat('c2', 'حليب')], ['general'])).toEqual({
      categoryId: 'c2',
      newName: null,
    });
    expect(suggestFor('شيء غريب', [], undefined)).toBeNull();
  });
});
