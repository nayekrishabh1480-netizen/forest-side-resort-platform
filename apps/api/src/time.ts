const PROPERTY_TIME_ZONE = 'Asia/Kolkata';

export function propertyDateToday(now = new Date()): string {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROPERTY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => values.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function parseDateOnly(input: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error('Date must use YYYY-MM-DD format');
  const date = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) throw new Error('Date is invalid');
  return date;
}

export function formatPropertyDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PROPERTY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function utcNowFromPropertyDate(date: string, hour = 12): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour - 5, -30));
}
