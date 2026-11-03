import { describe, expect, it } from 'vitest';
import { COLOURS, insertValue, presetGroups, SIZE_KINDS } from './presets';

describe('built-in option values', () => {
  it('keeps the built-in values in shop order and the store’s own after them', () => {
    const sizes = presetGroups('المقاس');
    let v: string[] = [];
    for (const x of ['L', 'نص نص', 'S', 'XL', 'M', 'S']) v = insertValue(v, x, sizes);
    expect(v).toEqual(['S', 'M', 'L', 'XL', 'نص نص']);
    expect(insertValue(['32', '36'], '34', sizes)).toEqual(['32', '34', '36']);
  });

  it('knows each kind by its name, and nothing for a name the shop made up', () => {
    expect(presetGroups(' اللون ')).toEqual([COLOURS]);
    expect(presetGroups('النمرة').flatMap((g) => g.values)).toContain('42');
    expect(presetGroups('العمر')[1]!.values.slice(0, 3)).toEqual(['سنتان', '3 سنوات', '4 سنوات']);
    expect(presetGroups('القماش')).toEqual([]);
    expect(SIZE_KINDS.map((k) => k.name)).toEqual(['المقاس', 'النمرة', 'العمر']);
  });
});
