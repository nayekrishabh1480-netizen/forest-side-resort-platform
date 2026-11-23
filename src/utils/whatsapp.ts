const CONTACT_NO = import.meta.env.VITE_CONTACT_NO as string | undefined;

export function normalizeIndianMobileNumber(value?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

export function buildWhatsAppUrl(message: string, contactNo: string | null | undefined = CONTACT_NO): string | null {
  const local = normalizeIndianMobileNumber(contactNo);
  return local ? `https://wa.me/91${local}?text=${encodeURIComponent(message)}` : null;
}

export function isWhatsAppConfigured(): boolean {
  return normalizeIndianMobileNumber(CONTACT_NO) !== null;
}

export const generalWhatsAppMessage = 'Hello, I am interested in staying at Forest Side Resort, Guptkashi. Please share the details.';
