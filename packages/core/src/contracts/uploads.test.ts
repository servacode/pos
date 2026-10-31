import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors';
import {
  UPLOAD_BODY_LIMIT_BYTES,
  UPLOAD_PURPOSES,
  base64DecodedLength,
  sniffImageType,
  uploadInput,
} from './uploads';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

describe('base64DecodedLength', () => {
  it('matches the real decoded size for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 300 }), (bytes) => {
        expect(base64DecodedLength(b64(bytes))).toBe(bytes.length);
      }),
    );
  });

  it.each(['', 'abc', 'ab=c', 'a=bc', 'abc=d===', 'ab c', 'ab-_', 'YWJj\n', '====', 'a===', '==ab'])(
    'refuses %j',
    (text) => {
      expect(base64DecodedLength(text)).toBeNull();
    },
  );
});

describe('sniffImageType', () => {
  it('reads JPEG, PNG and WebP from their first bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('refuses SVG, GIF, PDF, a RIFF that is not WebP and short files', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(
      sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])),
    ).toBeNull();
    expect(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBeNull();
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('uploadInput', () => {
  it('takes a receipt photo in base64', () => {
    const parsed = uploadInput.parse({
      purpose: 'payment_receipt',
      contentType: 'image/jpeg',
      fileName: ' إيصال-شام-كاش.jpg ',
      dataBase64: b64(JPEG),
    });
    expect(parsed).toMatchObject({ purpose: 'payment_receipt', fileName: 'إيصال-شام-كاش.jpg' });
  });

  it('refuses an unknown purpose or a type that is not an image we take', () => {
    const base = { purpose: 'store_logo', contentType: 'image/png', dataBase64: b64(PNG) };
    expect(uploadInput.safeParse(base).success).toBe(true);
    expect(uploadInput.safeParse({ ...base, purpose: 'avatar' }).success).toBe(false);
    const svg = uploadInput.safeParse({ ...base, contentType: 'image/svg+xml' });
    expect(svg.error?.issues[0]?.message).toBe('ارفع صورة JPG أو PNG أو WebP');
    expect(uploadInput.safeParse({ ...base, contentType: 'application/pdf' }).success).toBe(false);
  });

  it('refuses text that is not base64, or empty', () => {
    for (const dataBase64 of ['not base64!', '']) {
      const result = uploadInput.safeParse({ purpose: 'store_logo', contentType: 'image/png', dataBase64 });
      expect(result.error?.issues[0]?.path).toEqual(['dataBase64']);
      expect(result.error?.issues[0]?.message).toBe('الملف غير صالح. اختر الصورة من جديد');
    }
  });

  it('refuses a file over its purpose limit: a logo of 600 KB, a receipt of 3 MB', () => {
    const logo = uploadInput.safeParse({
      purpose: 'store_logo',
      contentType: 'image/png',
      dataBase64: 'A'.repeat(Math.ceil((600 * 1024) / 3) * 4),
    });
    expect(logo.error?.issues[0]?.message).toBe('الصورة أكبر من 512 كيلوبايت. صغّرها وأعد المحاولة');
    const receipt = uploadInput.safeParse({
      purpose: 'payment_receipt',
      contentType: 'image/jpeg',
      dataBase64: 'A'.repeat(Math.ceil((3 * 1024 * 1024) / 3) * 4),
    });
    expect(receipt.success).toBe(false);
    const fits = uploadInput.safeParse({
      purpose: 'payment_receipt',
      contentType: 'image/jpeg',
      dataBase64: 'A'.repeat(Math.floor((2 * 1024 * 1024) / 3) * 4),
    });
    expect(fits.success).toBe(true);
  });

  it('keeps the route body limit above the largest file in base64', () => {
    const largest = Math.max(...Object.values(UPLOAD_PURPOSES).map((p) => p.maxBytes));
    expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(Math.ceil(largest / 3) * 4 + 1024);
    expect(UPLOAD_PURPOSES.payment_receipt.permission).toBe('subscription.manage');
    expect(UPLOAD_PURPOSES.store_logo.permission).toBe('store.setup');
  });

  it('names the new error codes of step 6', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining(['read_only', 'duplicate_transaction', 'awaiting_second_approval']),
    );
  });
});
