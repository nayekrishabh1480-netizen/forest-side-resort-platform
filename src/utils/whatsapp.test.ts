import { describe, expect, it } from 'vitest';
import { buildWhatsAppUrl, normalizeIndianMobileNumber } from './whatsapp';

describe('WhatsApp click-to-chat URL', () => {
  it('normalizes a local Indian mobile number and encodes the message', () => {
    expect(buildWhatsAppUrl('Hello, resort!', '98765 43210')).toBe('https://wa.me/919876543210?text=Hello%2C%20resort!');
  });

  it('adds the country code only once when input already includes +91', () => {
    expect(normalizeIndianMobileNumber('+91-98765-43210')).toBe('9876543210');
    expect(buildWhatsAppUrl('Hello', '+91 98765 43210')).toBe('https://wa.me/919876543210?text=Hello');
  });

  it('rejects missing, malformed, or non-Indian mobile numbers without creating a broken link', () => {
    expect(normalizeIndianMobileNumber(undefined)).toBeNull();
    expect(normalizeIndianMobileNumber('1234567890')).toBeNull();
    expect(buildWhatsAppUrl('Hello', 'not-a-number')).toBeNull();
  });
});
