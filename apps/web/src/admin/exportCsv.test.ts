import { describe, expect, it } from 'vitest';
import { csvText } from './exportCsv';

describe('csvText', () => {
  it('starts with a BOM, quotes special cells, ends lines with CRLF', () => {
    const t = csvText(
      ['أ', 'ب'],
      [
        ['x,y', 'say "hi"'],
        [1, 2],
      ],
    );
    expect(t.startsWith('﻿')).toBe(true);
    expect(t).toBe('﻿أ,ب\r\n"x,y","say ""hi"""\r\n1,2\r\n');
  });
});
