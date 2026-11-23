import { randomBytes, createHash } from 'node:crypto';

export function createReference(prefix: 'FSR' | 'ENQ', now = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).replaceAll('-', '');
  return `${prefix}-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
