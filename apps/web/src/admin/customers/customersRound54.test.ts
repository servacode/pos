import { describe, expect, it } from 'vitest';
import { birthdayLink } from './debtReminder';

describe('the birthday greeting on WhatsApp', () => {
  it('opens the customer chat with a greeting that names the customer and the shop', () => {
    const link = birthdayLink('+963933111222', { name: 'ريم', store: 'بوتيك الأناقة' });
    expect(link).toContain('https://wa.me/963933111222?text=');
    const text = decodeURIComponent(link!.split('text=')[1]!);
    expect(text).toContain('ريم');
    expect(text).toContain('بوتيك الأناقة');
    expect(text).toContain('عيد ميلاد سعيد');
  });

  it('gives nothing when the customer has no usable phone', () => {
    expect(birthdayLink(null, { name: 'ريم', store: 'نور' })).toBeNull();
    expect(birthdayLink('abc', { name: 'ريم', store: 'نور' })).toBeNull();
  });
});
