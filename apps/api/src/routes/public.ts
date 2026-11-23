import { BookingStatus, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { ApiError, asyncRoute } from '../errors.js';
import { createReference } from '../references.js';
import { parseDateOnly, propertyDateToday } from '../time.js';
import { validateStayDates } from '../services/bookings.js';
import { createMapLink } from '../services/maps.js';
import type { createWeatherService } from '../services/weather.js';
import type { createNotificationService } from '../services/notifications.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { try { parseDateOnly(value); return true; } catch { return false; } }, 'Invalid calendar date');
const contactSchema = z.object({ name: z.string().trim().min(2).max(180), phone: z.string().trim().min(7).max(40), email: z.string().trim().email().max(320).optional().or(z.literal('')) });
const bookingSchema = contactSchema.extend({
  checkIn: dateText,
  checkOut: dateText,
  guests: z.coerce.number().int().min(1).max(20),
  roomTypeId: z.string().uuid().optional(),
  specialRequests: z.string().trim().max(2000).optional().default(''),
  whatsappOptIn: z.boolean().optional().default(false),
  source: z.enum(['website', 'direct', 'whatsapp', 'referral']).optional().default('website'),
}).strict();
const enquirySchema = contactSchema.extend({ message: z.string().trim().min(3).max(4000), checkIn: dateText.optional(), checkOut: dateText.optional(), guests: z.coerce.number().int().min(1).max(20).optional(), source: z.enum(['website', 'direct', 'whatsapp', 'referral']).optional().default('website') }).strict().superRefine((value, ctx) => {
  if (Boolean(value.checkIn) !== Boolean(value.checkOut)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOut'], message: 'Both dates must be supplied together' });
  if (value.checkIn && value.checkOut) { try { validateStayDates(value.checkIn, value.checkOut); } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOut'], message: 'Check-out must be after check-in and the dates must be in the future' }); } }
});
const availabilitySchema = z.object({ checkIn: dateText, checkOut: dateText, guests: z.coerce.number().int().min(1).max(20), roomTypeId: z.string().uuid().optional() }).strict();
const preferenceSchema = z.object({ name: z.string().trim().min(2).max(180), phone: z.string().trim().min(7).max(40).optional(), email: z.string().trim().email().max(320).optional(), dietaryPreference: z.string().trim().max(120).optional(), allergies: z.string().trim().max(1000).optional(), specialNeeds: z.string().trim().max(2000).optional(), arrivalMealTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), whatsappOptIn: z.boolean().default(false) }).strict().refine((value) => Boolean(value.phone || value.email), 'Phone or email is required').refine((value) => !value.whatsappOptIn || Boolean(value.phone), 'A phone number is required for WhatsApp opt-in');

type PublicDeps = { prisma: PrismaClient; weather: ReturnType<typeof createWeatherService>; notifications: ReturnType<typeof createNotificationService>; sensitiveLimiter: RequestHandler };

export function publicRouter({ prisma, weather, notifications, sensitiveLimiter }: PublicDeps) {
  const router = Router();
  router.get('/resort', asyncRoute(async (_req, res) => {
    const values = await prisma.websiteSetting.findMany({ where: { isPublic: true, key: { in: ['contact.phone', 'contact.email', 'contact.address', 'contact.mapUrl', 'resort.description', 'resort.whatsappNumber'] } } });
    const settings = Object.fromEntries(values.map((entry) => [entry.key, entry.value]));
    res.json({ data: { name: 'Forest Side Resort', tagline: 'Your Mountain Stay, Made Simpler.', location: 'Guptkashi, Rudraprayag, Uttarakhand, India', contacts: settings } });
  }));

  router.get('/rooms', asyncRoute(async (_req, res) => {
    const types = await prisma.roomType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, include: { _count: { select: { rooms: { where: { isActive: true } } } } } });
    res.json({ data: types.map(({ _count, ...type }) => ({ ...type, inventoryConfigured: _count.rooms > 0 })) });
  }));

  router.get('/tariffs', asyncRoute(async (req, res) => {
    const dateTextValue = typeof req.query.date === 'string' ? req.query.date : propertyDateToday();
    const date = dateText.parse(dateTextValue);
    const roomTypeId = typeof req.query.roomTypeId === 'string' ? req.query.roomTypeId : undefined;
    const rates = await prisma.seasonalRate.findMany({ where: { isActive: true, isPublished: true, validFrom: { lte: parseDateOnly(date) }, validTo: { gte: parseDateOnly(date) }, ...(roomTypeId ? { roomTypeId } : {}) }, include: { roomType: { select: { id: true, name: true } } }, orderBy: [{ roomTypeId: 'asc' }, { amount: 'asc' }] });
    res.json({ data: rates.map((rate) => ({ id: rate.id, name: rate.name, season: rate.season, dayType: rate.dayType, amount: rate.amount.toString(), currency: rate.currency, validFrom: rate.validFrom.toISOString().slice(0, 10), validTo: rate.validTo.toISOString().slice(0, 10), extraCharges: rate.extraCharges, roomType: rate.roomType })) });
  }));

  router.post('/price-quote', asyncRoute(async (req, res) => {
    const input = z.object({ checkIn: dateText, checkOut: dateText, roomTypeId: z.string().uuid().optional() }).strict().parse(req.body);
    const { checkIn, checkOut, nights } = validateStayDates(input.checkIn, input.checkOut);
    const lastNight = new Date(checkOut.getTime() - 86_400_000);
    const rates = await prisma.seasonalRate.findMany({ where: {
      isActive: true, isPublished: true,
      validFrom: { lte: lastNight }, validTo: { gte: checkIn },
      ...(input.roomTypeId ? { OR: [{ roomTypeId: input.roomTypeId }, { roomTypeId: null }] } : { roomTypeId: null }),
    }, orderBy: [{ specialDate: 'desc' }, { validFrom: 'desc' }], include: { roomType: { select: { id: true, name: true } } } });
    const nightly: Array<{ date: string; rateId: string | null; rateName: string | null; amount: string | null; currency: string | null; extraCharges: Prisma.JsonValue | null }> = [];
    let accommodationTotal = new Prisma.Decimal(0);
    for (let index = 0; index < nights; index += 1) {
      const night = new Date(checkIn.getTime() + index * 86_400_000);
      const date = night.toISOString().slice(0, 10);
      const dayType = [0, 6].includes(night.getUTCDay()) ? 'WEEKEND' : 'WEEKDAY';
      const applicable = rates.filter((rate) => rate.validFrom <= night && rate.validTo >= night);
      const choose = (pool: typeof rates) => {
        const ordered = [...pool].sort((a, b) => {
          const aSpecial = a.specialDate?.toISOString().slice(0, 10) === date ? 1 : 0;
          const bSpecial = b.specialDate?.toISOString().slice(0, 10) === date ? 1 : 0;
          const aDay = a.dayType === dayType ? 1 : 0;
          const bDay = b.dayType === dayType ? 1 : 0;
          return bSpecial - aSpecial || bDay - aDay || b.validFrom.getTime() - a.validFrom.getTime();
        });
        return ordered.find((rate) => rate.specialDate?.toISOString().slice(0, 10) === date)
          ?? ordered.find((rate) => rate.dayType === dayType)
          ?? ordered.find((rate) => rate.dayType === 'ANY');
      };
      const specific = input.roomTypeId ? applicable.filter((rate) => rate.roomTypeId === input.roomTypeId) : [];
      const generic = applicable.filter((rate) => rate.roomTypeId === null);
      const match = (specific.length ? choose(specific) : undefined) ?? choose(generic);
      if (match) {
        accommodationTotal = accommodationTotal.add(match.amount);
        nightly.push({ date, rateId: match.id, rateName: match.name, amount: match.amount.toString(), currency: match.currency, extraCharges: match.extraCharges });
      } else nightly.push({ date, rateId: null, rateName: null, amount: null, currency: null, extraCharges: null });
    }
    const missingNights = nightly.filter((item) => item.amount === null).map((item) => item.date);
    res.json({ data: { priceDiscoveryAvailable: missingNights.length === 0, status: missingNights.length === nights ? 'OWNER_TARIFF_PENDING' : missingNights.length ? 'PARTIALLY_CONFIGURED' : 'QUOTE_READY', checkIn: input.checkIn, checkOut: input.checkOut, nights, currency: 'INR', accommodationTotal: missingNights.length ? null : accommodationTotal.toString(), nightly, missingNights, additionalCharges: 'Shown per applicable published tariff; confirm with the resort before booking.' } });
  }));

  router.get('/price-history', asyncRoute(async (req, res) => {
    const roomTypeId = typeof req.query.roomTypeId === 'string' ? req.query.roomTypeId : undefined;
    const rates = await prisma.historicalRate.findMany({ where: { isPublished: true, ...(roomTypeId ? { roomTypeId } : {}) }, orderBy: { effectiveFrom: 'desc' }, include: { roomType: { select: { name: true } } } });
    res.json({ data: rates.map((rate) => ({ id: rate.id, name: rate.name, season: rate.season, dayType: rate.dayType, amount: rate.amount.toString(), currency: rate.currency, effectiveFrom: rate.effectiveFrom.toISOString().slice(0, 10), effectiveTo: rate.effectiveTo?.toISOString().slice(0, 10) ?? null, roomType: rate.roomType })) });
  }));

  router.post('/availability', sensitiveLimiter, asyncRoute(async (req, res) => {
    const input = availabilitySchema.parse(req.body);
    const { checkIn, checkOut } = validateStayDates(input.checkIn, input.checkOut);
    const types = await prisma.roomType.findMany({ where: { isActive: true, maxOccupancy: { gte: input.guests }, ...(input.roomTypeId ? { id: input.roomTypeId } : {}) }, include: { rooms: { where: { isActive: true }, select: { id: true } } } });
    if (types.length === 0 || types.every((type) => type.rooms.length === 0)) {
      res.json({ data: { availabilityKnown: false, status: 'OWNER_CONFIRMATION_REQUIRED', message: 'Room inventory has not been configured. Please submit a booking request for owner review.' } });
      return;
    }
    const results = await Promise.all(types.map(async (type) => {
      const roomIds = type.rooms.map((room) => room.id);
      const conflicts = roomIds.length ? await prisma.booking.findMany({ where: { roomId: { in: roomIds }, status: BookingStatus.CONFIRMED, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } }, select: { roomId: true } }) : [];
      const occupied = new Set(conflicts.map((booking) => booking.roomId));
      return { roomTypeId: type.id, roomType: type.name, availableCount: roomIds.filter((id) => !occupied.has(id)).length };
    }));
    res.json({ data: { availabilityKnown: true, status: 'INFORMATIONAL_ONLY', roomTypes: results, message: 'Availability is informational. The resort confirms every booking request before a reservation is made.' } });
  }));

  router.post('/booking-requests', sensitiveLimiter, asyncRoute(async (req, res) => {
    const input = bookingSchema.parse(req.body);
    const dates = validateStayDates(input.checkIn, input.checkOut);
    if (input.roomTypeId) {
      const type = await prisma.roomType.findFirst({ where: { id: input.roomTypeId, isActive: true } });
      if (!type) throw new ApiError(400, 'INVALID_ROOM_TYPE');
      if (input.guests > type.maxOccupancy) throw new ApiError(400, 'GUEST_COUNT_EXCEEDS_CAPACITY');
    }
    const reference = createReference('FSR');
    const booking = await prisma.$transaction(async (tx) => {
      const guest = await tx.guest.create({ data: { fullName: input.name, phone: input.phone, email: input.email || null } });
      if (input.whatsappOptIn) await tx.guestPreference.create({ data: { guestId: guest.id, whatsappOptIn: true, whatsappOptInAt: new Date(), consentSource: 'booking_request' } });
      const created = await tx.booking.create({ data: {
        reference, guestId: guest.id, roomTypeId: input.roomTypeId, checkIn: dates.checkIn, checkOut: dates.checkOut,
        guestCount: input.guests, status: BookingStatus.REQUESTED, paymentStatus: PaymentStatus.NOT_REQUIRED,
        specialRequests: input.specialRequests || null, source: input.source,
        whatsappOptIn: input.whatsappOptIn, whatsappOptInAt: input.whatsappOptIn ? new Date() : null,
      }, select: { id: true, reference: true, status: true, createdAt: true, guestId: true } });
      await tx.bookingGuest.create({ data: { bookingId: created.id, guestId: guest.id, role: 'LEAD' } });
      return created;
    });
    let emailNotification: { sent: boolean; reason?: string } | undefined;
    if (input.email) emailNotification = await notifications.sendBookingAcknowledgement({ to: input.email, reference, guestId: booking.guestId, bookingId: booking.id, optedIn: true });
    const whatsappNotification = input.whatsappOptIn ? await notifications.sendWhatsAppTemplate({ to: input.phone, templateName: config.WHATSAPP_TEMPLATE_BOOKING_ACK, bodyParameters: [reference], guestId: booking.guestId, bookingId: booking.id, optedIn: true, type: 'BOOKING_REQUEST_ACK' }) : undefined;
    const ownerNotification = await notifications.sendOwnerBookingNotification({ reference, guestName: input.name, phone: input.phone, checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests, guestId: booking.guestId, bookingId: booking.id });
    res.status(201).json({ data: { reference: booking.reference, status: booking.status, submittedAt: booking.createdAt.toISOString(), confirmation: 'This is a booking request. A reservation is created only after the resort reviews availability and confirms it.', ...(emailNotification ? { emailNotification } : {}), ...(whatsappNotification ? { whatsappNotification } : {}), ownerNotification } });
  }));

  router.post('/enquiries', sensitiveLimiter, asyncRoute(async (req, res) => {
    const input = enquirySchema.parse(req.body);
    const reference = createReference('ENQ');
    const result = await prisma.$transaction(async (tx) => {
      const guest = await tx.guest.create({ data: { fullName: input.name, phone: input.phone, email: input.email || null } });
      const enquiry = await tx.enquiry.create({ data: {
        reference, guestId: guest.id, name: input.name, phone: input.phone, email: input.email || null,
        message: input.message, checkIn: input.checkIn ? parseDateOnly(input.checkIn) : null,
        checkOut: input.checkOut ? parseDateOnly(input.checkOut) : null, guestCount: input.guests ?? null, source: input.source,
      }, select: { reference: true, status: true, createdAt: true } });
      return enquiry;
    });
    res.status(201).json({ data: { ...result, submittedAt: result.createdAt.toISOString() } });
  }));

  router.get('/weather', asyncRoute(async (_req, res) => {
    const data = await weather.get();
    res.json({ data, advisories: [{ name: 'India Meteorological Department', url: 'https://mausam.imd.gov.in/' }, { name: 'Rudraprayag district administration', url: 'https://rudraprayag.gov.in/' }], safetyNote: 'Forecasts are not guarantees. This service does not predict landslides, road closures or emergencies.' });
  }));

  router.get('/weather/current', asyncRoute(async (_req, res) => {
    const weatherData = await weather.get();
    res.json({ data: { available: weatherData.available, location: weatherData.location, source: weatherData.source, current: weatherData.current, lastUpdated: weatherData.lastUpdated, observedAt: weatherData.observedAt, stale: weatherData.stale, providerStatus: weatherData.providerStatus } });
  }));

  router.get('/weather/forecast', asyncRoute(async (_req, res) => {
    const weatherData = await weather.get();
    res.json({ data: { available: weatherData.available, location: weatherData.location, source: weatherData.source, forecast: weatherData.forecast, hourly: weatherData.hourly, lastUpdated: weatherData.lastUpdated, stale: weatherData.stale, providerStatus: weatherData.providerStatus } });
  }));

  router.get('/weather/summary', asyncRoute(async (_req, res) => {
    const weatherData = await weather.get();
    res.json({ data: weatherData, safetyNote: 'Forecasts are not guarantees. This service does not predict landslides, road closures or emergencies.' });
  }));

  router.get('/attractions', asyncRoute(async (_req, res) => {
    const data = await prisma.attraction.findMany({ where: { isPublished: true }, orderBy: { name: 'asc' } });
    res.json({ data });
  }));
  router.get('/cafes', asyncRoute(async (_req, res) => {
    const data = await prisma.cafe.findMany({ where: { isPublished: true }, orderBy: { name: 'asc' } });
    res.json({ data });
  }));
  router.get('/meal-options', asyncRoute(async (_req, res) => {
    const data = await prisma.mealOption.findMany({ where: { isPublished: true }, orderBy: { sortOrder: 'asc' } });
    res.json({ data });
  }));
  router.post('/meal-preferences', sensitiveLimiter, asyncRoute(async (req, res) => {
    const input = preferenceSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const guest = await tx.guest.create({ data: { fullName: input.name, phone: input.phone || null, email: input.email || null } });
      const preferences = await tx.guestPreference.create({ data: {
        guestId: guest.id, dietaryPreference: input.dietaryPreference, allergies: input.allergies,
        specialNeeds: input.specialNeeds, arrivalMealTime: input.arrivalMealTime,
        whatsappOptIn: input.whatsappOptIn, whatsappOptInAt: input.whatsappOptIn ? new Date() : null,
        consentSource: input.whatsappOptIn ? 'meal_preferences_form' : null,
      } });
      return preferences;
    });
    if (input.whatsappOptIn && input.phone) {
      if (config.WHATSAPP_TEMPLATE_PREARRIVAL) await notifications.sendWhatsAppTemplate({ to: input.phone, templateName: config.WHATSAPP_TEMPLATE_PREARRIVAL, guestId: result.guestId, optedIn: true, type: 'MEAL_PREFERENCES_ACK' });
    }
    res.status(201).json({ data: { saved: true, message: 'Meal preferences have been received for owner review.' } });
  }));

  router.get('/contact', asyncRoute(async (_req, res) => {
    const entries = await prisma.websiteSetting.findMany({ where: { isPublic: true, key: { in: ['contact.phone', 'contact.email', 'contact.address', 'contact.mapUrl', 'resort.whatsappNumber'] } } });
    const settings = Object.fromEntries(entries.map(({ key, value }) => [key, value]));
    res.json({ data: { location: 'Guptkashi, Rudraprayag, Uttarakhand, India', phone: settings['contact.phone'] ?? null, email: settings['contact.email'] ?? null, address: settings['contact.address'] ?? null, mapUrl: settings['contact.mapUrl'] ?? createMapLink().url, whatsappNumber: settings['resort.whatsappNumber'] ?? null } });
  }));
  router.get('/map-link', (_req, res) => res.json({ data: createMapLink() }));
  router.get('/reviews', asyncRoute(async (_req, res) => {
    const reviews = await prisma.review.findMany({ where: { status: 'VERIFIED', publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { guestName: true, rating: true, body: true, stayDate: true, publishedAt: true } });
    res.json({ data: reviews });
  }));

  return router;
}
