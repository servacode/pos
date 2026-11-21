/* eslint-disable no-restricted-syntax -- the dot shows the product's own colour: it is data, not interface chrome */
/** A colour's name in Arabic to a colour for its dot beside the name; null when the name is not known. */
const COLOURS: Record<string, string> = {
  أبيض: '#ffffff',
  ابيض: '#ffffff',
  أسود: '#111111',
  اسود: '#111111',
  أحمر: '#d62828',
  احمر: '#d62828',
  أزرق: '#1d4ed8',
  ازرق: '#1d4ed8',
  'أزرق فاتح': '#7cc0f2',
  سماوي: '#38bdf8',
  كحلي: '#1e2a5a',
  نيلي: '#27348b',
  أخضر: '#2f9e44',
  اخضر: '#2f9e44',
  زيتي: '#6b7a2c',
  أصفر: '#facc15',
  اصفر: '#facc15',
  برتقالي: '#f97316',
  بنفسجي: '#7c3aed',
  موف: '#a78bfa',
  وردي: '#f9a8d4',
  فوشيا: '#d6247f',
  بني: '#7b4a2a',
  جملي: '#c19a6b',
  بيج: '#e8d8b9',
  كريمي: '#f5ecd5',
  رمادي: '#9ca3af',
  فضي: '#cbd5e1',
  ذهبي: '#d4a017',
  خمري: '#6d1a36',
  عنابي: '#7f1d3a',
  تركوازي: '#14b8a6',
  طحيني: '#b8a48a',
};

export function swatchOf(name: string): string | null {
  const key = name.trim().replace(/\s+/g, ' ');
  return COLOURS[key] ?? COLOURS[key.replace(/^ال/, '')] ?? null;
}

/** Whether an option is the colour (by its name) */
export const isColourOption = (optionName: string): boolean => /لون|colou?r/i.test(optionName);
