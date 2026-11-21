import { describe, expect, it } from 'vitest';
import { csvText, TextCell } from './exportCsv';

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

describe('csvText formulas', () => {
  it('defuses a text that would run as a formula, but leaves numbers and plain text alone', () => {
    const t = csvText(['a'], [['=HYPERLINK("x")'], ['+963944'], ['@cmd'], ['-5+2'], [-5], ['شاي']]);
    expect(t).toBe('﻿a\r\n"\'=HYPERLINK(""x"")"\r\n\'+963944\r\n\'@cmd\r\n\'-5+2\r\n-5\r\nشاي\r\n');
  });
});

describe('csvText codes', () => {
  it('keeps a barcode as text for Excel, and falls back to a plain cell for anything else', () => {
    const t = csvText(['a'], [[new TextCell('6221031234567')], [new TextCell('=x')]]);
    expect(t).toBe('﻿a\r\n"=""6221031234567"""\r\n\'=x\r\n');
  });
});
