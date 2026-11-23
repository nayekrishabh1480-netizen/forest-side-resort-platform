import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { assertRoomAvailable, validateStayDates } from '../src/services/bookings.js';
import { createWeatherService, fetchWeatherJson } from '../src/services/weather.js';
import { propertyDateToday } from '../src/time.js';
import { parseWorkbook } from '../src/routes/imports.js';

const futureDates = { checkIn: '2027-01-04', checkOut: '2027-01-07' };
const sessionToken = 'synthetic-test-session-token-do-not-use-in-production-123456';

function mockPrisma() {
  const prisma: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    $transaction: vi.fn(async (operation: any) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
    adminSession: { findUnique: vi.fn() },
    guest: { create: vi.fn().mockResolvedValue({ id: 'guest-synthetic-1' }) },
    guestPreference: { create: vi.fn().mockResolvedValue({ id: 'pref-synthetic-1', guestId: 'guest-synthetic-1' }) },
    attraction: { create: vi.fn() },
    websiteSetting: { upsert: vi.fn() },
    booking: { create: vi.fn().mockResolvedValue({ id: 'booking-synthetic-1', reference: 'FSR-20270104-ABCD1234', status: 'REQUESTED', createdAt: new Date('2027-01-01T00:00:00Z'), guestId: 'guest-synthetic-1' }) },
    bookingGuest: { create: vi.fn().mockResolvedValue({}) },
    notificationLog: { create: vi.fn(), update: vi.fn() },
    weatherRecord: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    importBatch: { create: vi.fn().mockResolvedValue({ id: 'batch-synthetic-1', status: 'COMPLETED', rowsRead: 1, rowsImported: 1, rowsSkipped: 0, rowsFailed: 0, personalDataIncluded: false }) },
    travellerRegisterEntry: { create: vi.fn().mockResolvedValue({}) },
  };
  return prisma;
}

function appWith(prisma: ReturnType<typeof mockPrisma>, overrides: Record<string, unknown> = {}) {
  const weather = { get: vi.fn().mockResolvedValue({ available: false, location: 'Guptkashi', source: null, current: null, forecast: [], lastUpdated: null, stale: false }) };
  const notifications = { sendBookingAcknowledgement: vi.fn().mockResolvedValue({ sent: false, reason: 'PROVIDER_NOT_CONFIGURED' }), sendOwnerBookingNotification: vi.fn().mockResolvedValue({ sent: false, reason: 'OWNER_EMAIL_OR_SMTP_NOT_CONFIGURED' }), sendBookingStatusUpdate: vi.fn().mockResolvedValue({ sent: false, reason: 'PROVIDER_NOT_CONFIGURED' }), sendWhatsAppTemplate: vi.fn().mockResolvedValue({ sent: false }) };
  return { app: createApp({ prisma: prisma as never, weather: weather as never, notifications: notifications as never, ...overrides }), weather, notifications };
}

async function workbookBuffer(duplicate = false) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Traveller Register');
  const headers: Record<string, string> = { A5: 'Serial No.', B5: 'No. of Travellers', C5: 'Name of Traveller', E5: 'Age', F5: 'Nationality', G5: 'Residence (permanent address)', J5: 'Id Proof', K5: 'Mob ph.', L5: 'Date of Arrival', M5: 'Travelling from', N5: 'Travelling to', O5: 'Date of departure' };
  for (const [address, value] of Object.entries(headers)) sheet.getCell(address).value = value;
  const row: Record<string, ExcelJS.CellValue> = { A6: 1, B6: 2, C6: 'Synthetic Traveller Name', E6: 35, F6: 'Synthetic Nationality', G6: 'Synthetic private address', J6: 'SYNTHETIC-ID-DO-NOT-IMPORT', K6: '+911234567890', L6: new Date('2027-01-04T00:00:00.000Z'), M6: 'Synthetic Origin', N6: 'Synthetic Destination', O6: new Date('2027-01-07T00:00:00.000Z') };
  for (const [address, value] of Object.entries(row)) sheet.getCell(address).value = value;
  if (duplicate) for (const [address, value] of Object.entries(row)) sheet.getCell(address.replace('6', '7')).value = value;
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

describe('Forest Side API', () => {
  beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('returns a versioned health response when the database responds', async () => {
    const prisma = mockPrisma();
    const { app } = appWith(prisma);
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'ok', database: 'ok', timeZone: 'Asia/Kolkata' });
  });

  it('reports database degradation without leaking connection errors', async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockRejectedValue(new Error('synthetic database failure with private details'));
    const { app } = appWith(prisma);
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('private details');
  });

  it('validates date order and property-local past dates', () => {
    expect(() => validateStayDates('2027-01-08', '2027-01-07')).toThrowError(ApiError);
    expect(() => validateStayDates('2020-01-01', '2020-01-02')).toThrowError(/past in Asia\/Kolkata/);
    expect(validateStayDates(...Object.values(futureDates)).nights).toBe(3);
  });

  it('uses Asia/Kolkata for the local calendar date boundary', () => {
    expect(propertyDateToday(new Date('2026-11-22T18:29:59.000Z'))).toBe('2026-11-22');
    expect(propertyDateToday(new Date('2026-11-22T18:30:00.000Z'))).toBe('2026-11-23');
  });

  it('creates a booking request without confirming availability or exposing guest data', async () => {
    const prisma = mockPrisma();
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/booking-requests').send({ name: 'Synthetic Traveller', phone: '+911234567890', email: '', ...futureDates, guests: 2 });
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('REQUESTED');
    expect(response.body.data.reference).toMatch(/^FSR-/);
    expect(response.body.data.confirmation).toContain('only after the resort reviews');
    expect(response.text).not.toContain('Synthetic Traveller');
    expect(response.text).not.toContain('+911234567890');
    expect(prisma.booking.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REQUESTED', paymentStatus: 'NOT_REQUIRED', roomTypeId: undefined }) }));
    expect(prisma.bookingGuest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'LEAD' }) }));
  });

  it('returns the created booking request when owner notification delivery throws', async () => {
    const prisma = mockPrisma();
    const { app, notifications } = appWith(prisma);
    notifications.sendOwnerBookingNotification.mockRejectedValue(new Error('synthetic private provider detail'));

    const response = await request(app).post('/api/v1/booking-requests').send({ name: 'Synthetic Traveller', phone: '+911234567890', email: '', ...futureDates, guests: 2 });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('REQUESTED');
    expect(response.body.data.reference).toMatch(/^FSR-/);
    expect(response.body.data.ownerNotification).toEqual({ sent: false });
    expect(response.text).not.toContain('synthetic private provider detail');
  });

  it('rejects invalid booking dates before touching storage', async () => {
    const prisma = mockPrisma();
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/booking-requests').send({ name: 'Synthetic Traveller', phone: '+911234567890', ...futureDates, checkOut: '2027-01-02', guests: 2 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_STAY_DATES');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed booking phone numbers before touching storage', async () => {
    const prisma = mockPrisma();
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/booking-requests').send({ name: 'Synthetic Traveller', phone: 'abcdefghi', email: '', ...futureDates, guests: 2 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid booking email and guest count before touching storage', async () => {
    const prisma = mockPrisma();
    const { app } = appWith(prisma);
    const invalidEmail = await request(app).post('/api/v1/booking-requests').send({ name: 'Synthetic Traveller', phone: '+911234567890', email: 'not-an-email', ...futureDates, guests: 2 });
    const invalidGuestCount = await request(app).post('/api/v1/booking-requests').send({ name: 'Synthetic Traveller', phone: '+911234567890', email: '', ...futureDates, guests: 21 });

    expect(invalidEmail.status).toBe(400);
    expect(invalidEmail.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidGuestCount.status).toBe(400);
    expect(invalidGuestCount.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('protects private admin APIs with authenticated sessions', async () => {
    const prisma = mockPrisma();
    const { app } = appWith(prisma);
    const response = await request(app).get('/api/v1/admin/bookings');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects admin requests from an unapproved browser origin', async () => {
    const prisma = mockPrisma();
    prisma.adminSession.findUnique.mockResolvedValue({ id: 'session-1', tokenHash: 'ignored-by-test-double', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, adminUser: { id: 'admin-1', email: 'synthetic@example.test', role: 'MANAGER', isActive: true } });
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/admin/attractions').set('Origin', 'https://untrusted.example').set('Cookie', `fsr_admin_session=${sessionToken}`).send({ name: 'Synthetic listing', mapsUrl: 'https://example.test' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
    expect(prisma.attraction.create).not.toHaveBeenCalled();
  });

  it('rejects script-capable map URLs before creating public listings', async () => {
    const prisma = mockPrisma();
    prisma.adminSession.findUnique.mockResolvedValue({ id: 'session-1', tokenHash: 'ignored-by-test-double', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, adminUser: { id: 'admin-1', email: 'synthetic@example.test', role: 'MANAGER', isActive: true } });
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/admin/attractions').set('Cookie', `fsr_admin_session=${sessionToken}`).send({ name: 'Synthetic listing', mapsUrl: 'javascript:alert(1)' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.attraction.create).not.toHaveBeenCalled();
  });

  it('rejects non-text public website settings before persistence', async () => {
    const prisma = mockPrisma();
    prisma.adminSession.findUnique.mockResolvedValue({ id: 'session-1', tokenHash: 'ignored-by-test-double', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, adminUser: { id: 'admin-1', email: 'synthetic@example.test', role: 'MANAGER', isActive: true } });
    const { app } = appWith(prisma);
    const response = await request(app).put('/api/v1/admin/settings').set('Cookie', `fsr_admin_session=${sessionToken}`).send({ settings: [{ key: 'contact.address', value: { injected: true }, isPublic: true }] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.websiteSetting.upsert).not.toHaveBeenCalled();
  });

  it('serializes and rejects an overlapping confirmed room stay', async () => {
    const db: any = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      room: { findUnique: vi.fn().mockResolvedValue({ id: 'room-1', isActive: true, roomTypeId: 'type-1', roomType: { isActive: true, maxOccupancy: 2 } }) },
      booking: { findFirst: vi.fn().mockResolvedValue({ id: 'collision-1' }) },
    };
    await expect(assertRoomAvailable(db, 'room-1', new Date('2027-01-04T00:00:00Z'), new Date('2027-01-07T00:00:00Z'))).rejects.toMatchObject({ code: 'ROOM_DATE_CONFLICT', status: 409 });
    expect(db.$queryRaw).toHaveBeenCalledOnce();
  });

  it('returns a clear weather fallback if the provider is unavailable', async () => {
    const prisma = mockPrisma() as never;
    const service = createWeatherService(prisma, vi.fn().mockRejectedValue(new Error('synthetic network failure')) as typeof fetch, { apiKey: 'synthetic-key', locationName: 'Guptkashi', latitude: undefined, longitude: undefined, cacheTtlSeconds: 900 });
    await expect(service.get()).resolves.toMatchObject({ available: false, source: null, current: null, forecast: [], providerStatus: 'unavailable' });
  });

  it('retries a temporary weather provider failure once', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(fetchWeatherJson('https://weather.example.test/current', fetcher as typeof fetch)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses cached weather when refreshing from the provider fails', async () => {
    const prisma = mockPrisma();
    prisma.weatherRecord.findFirst.mockResolvedValue({ source: 'OpenWeatherMap', temperatureC: 4, relativeHumidityPct: 55, precipitationMm: 0, rainProbabilityPct: 20, conditionCode: null, forecast: { current: { temperatureC: 4, condition: 'clear sky' }, days: [], hourly: [], observedAt: null }, fetchedAt: new Date('2026-11-22T00:00:00Z'), expiresAt: new Date('2026-11-22T00:15:00Z') });
    const service = createWeatherService(prisma as never, vi.fn().mockRejectedValue(new Error('synthetic network failure')) as typeof fetch, { apiKey: 'synthetic-key', locationName: 'Guptkashi', latitude: undefined, longitude: undefined, cacheTtlSeconds: 900 });
    await expect(service.get()).resolves.toMatchObject({ available: true, stale: true, source: 'OpenWeatherMap', current: { temperatureC: 4 } });
  });

  it('geocodes Guptkashi then returns current conditions and three-day forecast from OpenWeather', async () => {
    const prisma = mockPrisma();
    prisma.weatherRecord.create.mockImplementation(async ({ data }: any) => data);
    const now = Math.floor(Date.now() / 1000);
    const entry = (offset: number, temp: number) => ({ dt: now + offset, main: { temp, temp_min: temp - 1, temp_max: temp + 1, feels_like: temp - 1, humidity: 61, pressure: 1008 }, weather: [{ id: 800, description: 'clear sky', icon: '01d' }], wind: { speed: 2, deg: 130 }, clouds: { all: 8 }, pop: 0.25, rain: { '3h': 0 } });
    const replies = [
      [{ lat: 30.5, lon: 79.1, name: 'Guptkashi' }],
      { dt: now, name: 'Guptkashi', main: { temp: 9, feels_like: 8, humidity: 60, pressure: 1009 }, weather: [{ id: 800, description: 'clear sky', icon: '01d' }], wind: { speed: 2.4, deg: 140, gust: 3 }, clouds: { all: 10 }, visibility: 10000, sys: { sunrise: now - 3000, sunset: now + 20000 } },
      { city: { name: 'Guptkashi', timezone: 19800 }, list: [entry(3600, 10), entry(14400, 8), entry(86400, 11), entry(172800, 12), entry(259200, 10)] },
    ];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = createWeatherService(prisma as never, fetcher as typeof fetch, { apiKey: 'synthetic-key', locationName: 'Guptkashi', latitude: undefined, longitude: undefined, cacheTtlSeconds: 900 });
    const result = await service.get();
    expect(result).toMatchObject({ available: true, location: 'Guptkashi', source: 'OpenWeatherMap', current: { temperatureC: 9, feelsLikeC: 8, humidityPct: 60 }, providerStatus: 'ready' });
    expect(result.forecast).toHaveLength(3);
    expect(result.hourly[0]).toMatchObject({ temperatureC: 10, rainProbabilityPct: 25, windKph: 7 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(prisma.weatherRecord.create).toHaveBeenCalledOnce();
  });

  it('parses the real traveller-register column layout and flags duplicate rows', async () => {
    const result = await parseWorkbook(await workbookBuffer(true));
    expect(result.headers).toContain('Id Proof');
    expect(result.rowsRead).toBe(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ travellerCount: 2, travelFrom: 'Synthetic Origin', travelTo: 'Synthetic Destination', duplicateOf: null });
    expect(result.rows[0]?.fullName).toBe('Synthetic Traveller Name');
  });

  it('previews Excel data without returning names, contact details or identity numbers', async () => {
    const prisma = mockPrisma();
    prisma.adminSession.findUnique.mockResolvedValue({ id: 'session-1', tokenHash: 'ignored-by-test-double', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, adminUser: { id: 'admin-1', email: 'synthetic@example.test', role: 'MANAGER', isActive: true } });
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/admin/imports/traveller-register/preview')
      .set('Cookie', `fsr_admin_session=${sessionToken}`)
      .attach('file', await workbookBuffer(), { filename: 'synthetic-register.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(response.status).toBe(200);
    expect(response.body.data.personalDataStoredInPreview).toBe(false);
    expect(response.body.data.rows[0]).toMatchObject({ rowNumber: 6, travellerCount: 2, personalDataDetected: true });
    expect(response.text).not.toContain('Synthetic Traveller Name');
    expect(response.text).not.toContain('+911234567890');
    expect(response.text).not.toContain('SYNTHETIC-ID-DO-NOT-IMPORT');
    expect(response.text).not.toContain('Synthetic private address');
  });

  it('stores only operational traveller fields on import by default', async () => {
    const prisma = mockPrisma();
    prisma.adminSession.findUnique.mockResolvedValue({ id: 'session-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, adminUser: { id: 'admin-1', email: 'synthetic@example.test', role: 'MANAGER', isActive: true } });
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/admin/imports/traveller-register')
      .set('Cookie', `fsr_admin_session=${sessionToken}`)
      .attach('file', await workbookBuffer(), { filename: 'synthetic-register.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ personalDataIncluded: false, identityProofsImported: false, addressesImported: false, rowsImported: 1 });
    expect(prisma.guest.create).not.toHaveBeenCalled();
    expect(prisma.travellerRegisterEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ fullName: expect.anything(), phone: expect.anything() }) }));
    expect(response.text).not.toContain('Synthetic Traveller Name');
  });

  it('requires owner role and explicit attestation before an import may include contacts', async () => {
    const prisma = mockPrisma();
    prisma.adminSession.findUnique.mockResolvedValue({ id: 'session-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, adminUser: { id: 'admin-1', email: 'synthetic@example.test', role: 'MANAGER', isActive: true } });
    const { app } = appWith(prisma);
    const response = await request(app).post('/api/v1/admin/imports/traveller-register')
      .set('Cookie', `fsr_admin_session=${sessionToken}`)
      .field('includePersonalData', 'true').field('ownerAuthorized', 'true')
      .attach('file', await workbookBuffer(), { filename: 'synthetic-register.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('OWNER_AUTHORIZATION_REQUIRED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
