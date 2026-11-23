import bcrypt from 'bcryptjs';
import { AdminRole, BookingStatus, DayType, NotificationStatus, Prisma, PrismaClient, ReviewStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { assertRoomAvailable, changeBookingStatus, validateStayDates } from '../services/bookings.js';
import { createReference } from '../references.js';
import { parseDateOnly, propertyDateToday, utcNowFromPropertyDate } from '../time.js';
import type { AppDependencies } from '../app.js';
import { importsRouter } from './imports.js';
import { createMapLink } from '../services/maps.js';
import { config } from '../config.js';

const uuid = z.string().uuid();
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { try { parseDateOnly(value); return true; } catch { return false; } });
const nullableText = (max: number) => z.string().trim().max(max).optional().nullable();
const httpsUrl = z.string().url().max(1000).refine((value) => { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; }, 'URL must use HTTPS and cannot include credentials');
const bookingCreate = z.object({ name: z.string().trim().min(2).max(180), phone: z.string().trim().min(7).max(40), email: z.string().trim().email().max(320).optional(), roomId: uuid, checkIn: dateText, checkOut: dateText, guests: z.coerce.number().int().min(1).max(20), specialRequests: z.string().trim().max(2000).optional() }).strict();
const bookingEdit = z.object({ checkIn: dateText.optional(), checkOut: dateText.optional(), guests: z.coerce.number().int().min(1).max(20).optional(), roomId: uuid.optional().nullable(), roomTypeId: uuid.optional().nullable(), specialRequests: z.string().trim().max(2000).optional().nullable() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const rateBaseInput = z.object({ roomTypeId: uuid.optional().nullable(), name: z.string().trim().min(2).max(120), season: z.string().trim().min(2).max(80), dayType: z.nativeEnum(DayType).default(DayType.ANY), amount: z.coerce.number().min(0).max(10_000_000), currency: z.string().length(3).default('INR'), validFrom: dateText, validTo: dateText, specialDate: dateText.optional(), extraCharges: z.array(z.object({ name: z.string().trim().min(1).max(100), amount: z.number().min(0), taxable: z.boolean().default(false) }).strict()).max(30).default([]), isPublished: z.boolean().default(false), isActive: z.boolean().default(true) }).strict();
const rateInput = rateBaseInput.refine((value) => value.validFrom <= value.validTo, { message: 'validTo must not be before validFrom', path: ['validTo'] });
const roomTypeInput = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: nullableText(3000), maxOccupancy: z.coerce.number().int().min(1).max(30), amenities: z.array(z.string().trim().min(1).max(100)).max(40).default([]), isActive: z.boolean().default(true) }).strict();
const roomInput = z.object({ roomNumber: z.string().trim().min(1).max(40), roomTypeId: uuid, isActive: z.boolean().default(true), notes: nullableText(1000) }).strict();
const attractionInput = z.object({ name: z.string().trim().min(2).max(180), description: nullableText(2000), distanceKm: z.coerce.number().min(0).max(10_000).optional().nullable(), address: nullableText(500), mapsUrl: httpsUrl.optional().nullable(), photoUrl: httpsUrl.optional().nullable(), isPublished: z.boolean().default(false) }).strict();
const cafeInput = z.object({ name: z.string().trim().min(2).max(180), description: nullableText(2000), address: nullableText(500), distanceKm: z.coerce.number().min(0).max(10_000).optional().nullable(), mapsUrl: httpsUrl.optional().nullable(), openingHours: nullableText(500), isPublished: z.boolean().default(false) }).strict();
const mealInput = z.object({ name: z.string().trim().min(2).max(120), description: nullableText(1000), price: z.coerce.number().min(0).max(1_000_000).optional().nullable(), currency: z.string().length(3).default('INR'), isAvailable: z.boolean().default(false), isPublished: z.boolean().default(false), sortOrder: z.number().int().min(0).default(0) }).strict();
const settingInput = z.object({ settings: z.array(z.object({ key: z.string().trim().min(2).max(120), value: z.string().max(4000), isPublic: z.boolean().default(false) }).strict()).max(100) }).strict();
const userInput = z.object({ email: z.string().trim().email().max(320), password: z.string().min(12).max(200), role: z.nativeEnum(AdminRole).default(AdminRole.STAFF) }).strict();
const enquiryStatusInput = z.object({ status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }).strict();
const bookingStatusInput = z.object({ status: z.nativeEnum(BookingStatus), roomId: uuid.optional() }).strict();
const reviewStatusInput = z.object({ status: z.nativeEnum(ReviewStatus) }).strict();

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  const guarded = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}
function sendCsv(res: import('express').Response, filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csv}`);
}

async function dashboardStats(prisma: PrismaClient) {
  const monthStartText = `${propertyDateToday().slice(0, 7)}-01`;
  const nextMonthDate = new Date(`${monthStartText}T00:00:00.000Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonthText = nextMonthDate.toISOString().slice(0, 10);
  const monthStartInstant = utcNowFromPropertyDate(monthStartText, 0);
  const [enquiries, requests, confirmed, stays, paid, allAverage, repeatGroups, responded, activeRooms, monthStays, marketing] = await Promise.all([
    prisma.enquiry.count(),
    prisma.booking.count({ where: { status: BookingStatus.REQUESTED } }),
    prisma.booking.count({ where: { status: BookingStatus.CONFIRMED } }),
    prisma.booking.count({ where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } } }),
    prisma.booking.aggregate({ where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }, paymentStatus: 'PAID', totalAmount: { not: null }, createdAt: { gte: monthStartInstant } }, _sum: { totalAmount: true } }),
    prisma.booking.aggregate({ where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }, totalAmount: { not: null } }, _avg: { totalAmount: true } }),
    prisma.booking.groupBy({ by: ['guestId'], where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } }, _count: { _all: true } }),
    prisma.enquiry.findMany({ where: { respondedAt: { not: null } }, select: { createdAt: true, respondedAt: true } }),
    prisma.room.count({ where: { isActive: true } }),
    prisma.booking.findMany({ where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }, checkIn: { lt: parseDateOnly(nextMonthText) }, checkOut: { gt: parseDateOnly(monthStartText) }, roomId: { not: null } }, select: { checkIn: true, checkOut: true } }),
    prisma.booking.groupBy({ by: ['source'], _count: { _all: true }, where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } } }),
  ]);
  const completedSources = marketing.reduce((sum, item) => sum + item._count._all, 0);
  const direct = marketing.filter((item) => ['website', 'direct'].includes((item.source ?? '').toLowerCase())).reduce((sum, item) => sum + item._count._all, 0);
  const repeat = repeatGroups.filter((group) => group._count._all > 1).length;
  const responseMinutes = responded.flatMap((item) => item.respondedAt ? [(item.respondedAt.getTime() - item.createdAt.getTime()) / 60_000] : []);
  const monthStart = parseDateOnly(monthStartText).getTime();
  const monthEnd = parseDateOnly(nextMonthText).getTime();
  const nightsOccupied = monthStays.reduce((sum, stay) => sum + Math.max(0, Math.ceil((Math.min(stay.checkOut.getTime(), monthEnd) - Math.max(stay.checkIn.getTime(), monthStart)) / 86_400_000)), 0);
  const daysInMonth = Math.round((monthEnd - monthStart) / 86_400_000);
  const occupancy = activeRooms ? Math.min(100, nightsOccupied / (activeRooms * daysInMonth) * 100) : null;
  const conversionDenominator = enquiries + requests;
  return {
    totalEnquiries: enquiries,
    pendingBookings: requests,
    confirmedBookings: confirmed,
    directBookingSharePct: completedSources ? Math.round(direct / completedSources * 10000) / 100 : 0,
    bookingConversionPct: conversionDenominator ? Math.round(confirmed / conversionDenominator * 10000) / 100 : 0,
    averageBookingValue: allAverage._avg.totalAmount?.toString() ?? null,
    monthlyRevenue: paid._sum.totalAmount?.toString() ?? '0',
    occupancyPct: occupancy === null ? null : Math.round(occupancy * 100) / 100,
    repeatBookingRatePct: repeatGroups.length ? Math.round(repeat / repeatGroups.length * 10000) / 100 : 0,
    averageEnquiryResponseMinutes: responseMinutes.length ? Math.round(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length) : null,
    customerAcquisitionCost: null,
    customerAcquisitionCostReason: 'Marketing spend is not recorded in the database.',
    bookingSources: marketing.map((item) => ({ source: item.source ?? 'unknown', bookings: item._count._all })),
    records: { enquiries, bookingRequests: requests, confirmedBookings: stays },
    month: monthStartText.slice(0, 7),
  };
}

export function adminRouter({ prisma, weather, notifications }: AppDependencies) {
  const router = Router();
  router.use(requireAdmin(prisma));
  const manager = requireRole(AdminRole.MANAGER, AdminRole.SUPER_ADMIN);

  router.get('/dashboard', asyncRoute(async (_req, res) => res.json({ data: await dashboardStats(prisma) })));
  router.get('/analytics', asyncRoute(async (_req, res) => res.json({ data: await dashboardStats(prisma) })));
  router.get('/reports/bookings.csv', asyncRoute(async (_req, res) => {
    const records = await prisma.booking.findMany({ include: { guest: true, room: { select: { roomNumber: true } } }, orderBy: { createdAt: 'desc' }, take: 10_000 });
    sendCsv(res, 'forest-side-bookings.csv', ['Reference', 'Created', 'Guest', 'Phone', 'Email', 'Check in', 'Check out', 'Guests', 'Room', 'Status', 'Source', 'Payment status', 'Amount'], records.map((b) => [b.reference, b.createdAt.toISOString(), b.guest.fullName, b.guest.phone, b.guest.email, b.checkIn.toISOString().slice(0, 10), b.checkOut.toISOString().slice(0, 10), b.guestCount, b.room?.roomNumber, b.status, b.source, b.paymentStatus, b.totalAmount?.toString()]));
  }));
  router.get('/reports/enquiries.csv', asyncRoute(async (_req, res) => {
    const records = await prisma.enquiry.findMany({ orderBy: { createdAt: 'desc' }, take: 10_000 });
    sendCsv(res, 'forest-side-enquiries.csv', ['Reference', 'Created', 'Name', 'Phone', 'Email', 'Message', 'Status', 'Source'], records.map((e) => [e.reference, e.createdAt.toISOString(), e.name, e.phone, e.email, e.message, e.status, e.source]));
  }));

  router.get('/bookings', asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' && Object.values(BookingStatus).includes(req.query.status as BookingStatus) ? req.query.status as BookingStatus : undefined;
    const records = await prisma.booking.findMany({ where: status ? { status } : undefined, include: { guest: { select: { id: true, fullName: true, phone: true, email: true } }, room: { include: { roomType: true } }, roomType: true }, orderBy: { createdAt: 'desc' }, take: 500 });
    res.json({ data: records });
  }));
  router.post('/bookings', manager, asyncRoute(async (req, res) => {
    const input = bookingCreate.parse(req.body);
    const dates = validateStayDates(input.checkIn, input.checkOut);
    const reference = createReference('FSR');
    const record = await prisma.$transaction(async (tx) => {
      const room = await assertRoomAvailable(tx, input.roomId, dates.checkIn, dates.checkOut, undefined, input.guests);
      const guest = await tx.guest.create({ data: { fullName: input.name, phone: input.phone, email: input.email ?? null } });
      const booking = await tx.booking.create({ data: { reference, guestId: guest.id, roomId: room.id, roomTypeId: room.roomTypeId, checkIn: dates.checkIn, checkOut: dates.checkOut, guestCount: input.guests, specialRequests: input.specialRequests ?? null, status: BookingStatus.CONFIRMED, confirmedByAdminId: req.admin!.id, confirmedAt: new Date(), paymentStatus: 'NOT_REQUIRED', source: 'admin' }, include: { guest: { select: { id: true, fullName: true } }, room: true } });
      await tx.bookingGuest.create({ data: { bookingId: booking.id, guestId: guest.id, role: 'LEAD' } });
      return booking;
    });
    res.status(201).json({ data: record });
  }));
  router.patch('/bookings/:id', manager, asyncRoute(async (req, res) => {
    const input = bookingEdit.parse(req.body);
    const current = await prisma.booking.findUnique({ where: { id: uuid.parse(req.params.id) } });
    if (!current) throw new ApiError(404, 'BOOKING_NOT_FOUND');
    const dates = validateStayDates(input.checkIn ?? current.checkIn.toISOString().slice(0, 10), input.checkOut ?? current.checkOut.toISOString().slice(0, 10), current.status === BookingStatus.COMPLETED);
    const data: Prisma.BookingUpdateInput = {
      checkIn: input.checkIn ? dates.checkIn : undefined,
      checkOut: input.checkOut ? dates.checkOut : undefined,
      guestCount: input.guests,
      roomType: input.roomTypeId === undefined ? undefined : input.roomTypeId ? { connect: { id: input.roomTypeId } } : { disconnect: true },
      room: input.roomId === undefined ? undefined : input.roomId ? { connect: { id: input.roomId } } : { disconnect: true },
      specialRequests: input.specialRequests,
    };
    const updated = await prisma.$transaction(async (tx) => {
      if (current.status === BookingStatus.CONFIRMED) {
        const targetRoomId = input.roomId === undefined ? current.roomId : input.roomId;
        if (!targetRoomId) throw new ApiError(409, 'ROOM_REQUIRED_TO_CONFIRM');
        const room = await assertRoomAvailable(tx, targetRoomId, dates.checkIn, dates.checkOut, current.id, input.guests ?? current.guestCount);
        if (input.roomTypeId && input.roomTypeId !== room.roomTypeId) throw new ApiError(400, 'ROOM_TYPE_MISMATCH');
        data.roomType = { connect: { id: room.roomTypeId } };
      }
      return tx.booking.update({ where: { id: current.id }, data, include: { guest: { select: { id: true, fullName: true } }, room: { include: { roomType: true } } } });
    });
    res.json({ data: updated });
  }));
  router.put('/bookings/:id/status', manager, asyncRoute(async (req, res) => {
    const input = bookingStatusInput.parse(req.body);
    const data = await changeBookingStatus(prisma, uuid.parse(req.params.id), input.status, req.admin!.id, input.roomId);
    const notification = data.guest.email && ['CONFIRMED', 'CANCELLED'].includes(data.status)
      ? await notifications!.sendBookingStatusUpdate({ to: data.guest.email, reference: data.reference, status: data.status, guestId: data.guest.id, bookingId: data.id })
      : null;
    const whatsappNotification = data.whatsappOptIn && data.guest.phone && ['CONFIRMED', 'CANCELLED'].includes(data.status)
      ? await notifications!.sendWhatsAppTemplate({ to: data.guest.phone, templateName: config.WHATSAPP_TEMPLATE_BOOKING_STATUS, bodyParameters: [data.reference, data.status.toLowerCase()], guestId: data.guest.id, bookingId: data.id, optedIn: true, type: `BOOKING_${data.status}` })
      : null;
    res.json({ data, ...(notification ? { notification } : {}), ...(whatsappNotification ? { whatsappNotification } : {}) });
  }));
  router.put('/bookings/:id/payment-status', manager, asyncRoute(async (req, res) => {
    const input = z.object({ paymentStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'PAID', 'REFUNDED']), totalAmount: z.coerce.number().min(0).max(10_000_000).nullable().optional() }).strict().parse(req.body);
    const data = await prisma.booking.update({ where: { id: uuid.parse(req.params.id) }, data: { paymentStatus: input.paymentStatus, ...(input.totalAmount !== undefined ? { totalAmount: input.totalAmount } : {}) } });
    res.json({ data });
  }));

  router.get('/guests', asyncRoute(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const data = await prisma.guest.findMany({ where: search ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { email: { contains: search, mode: 'insensitive' } }] } : undefined, include: { preferences: true, _count: { select: { bookings: true, enquiries: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
    res.json({ data });
  }));
  router.get('/guests/:id', asyncRoute(async (req, res) => {
    const guest = await prisma.guest.findUnique({ where: { id: uuid.parse(req.params.id) }, include: { preferences: true, bookings: { include: { room: true }, orderBy: { createdAt: 'desc' } }, enquiries: { orderBy: { createdAt: 'desc' } } } });
    if (!guest) throw new ApiError(404, 'GUEST_NOT_FOUND');
    res.json({ data: guest });
  }));
  router.patch('/guests/:id', manager, asyncRoute(async (req, res) => {
    const input = z.object({ fullName: z.string().trim().min(2).max(180).optional().nullable(), phone: z.string().trim().min(7).max(40).optional().nullable(), email: z.string().trim().email().max(320).optional().nullable(), notes: nullableText(2000) }).strict().parse(req.body);
    const guest = await prisma.guest.update({ where: { id: uuid.parse(req.params.id) }, data: input });
    res.json({ data: guest });
  }));

  router.get('/rooms', asyncRoute(async (_req, res) => res.json({ data: await prisma.room.findMany({ include: { roomType: true }, orderBy: { roomNumber: 'asc' } }) })));
  router.post('/room-types', manager, asyncRoute(async (req, res) => res.status(201).json({ data: await prisma.roomType.create({ data: roomTypeInput.parse(req.body) }) })));
  router.patch('/room-types/:id', manager, asyncRoute(async (req, res) => res.json({ data: await prisma.roomType.update({ where: { id: uuid.parse(req.params.id) }, data: roomTypeInput.partial().parse(req.body) }) })));
  router.post('/rooms', manager, asyncRoute(async (req, res) => res.status(201).json({ data: await prisma.room.create({ data: roomInput.parse(req.body), include: { roomType: true } }) })));
  router.patch('/rooms/:id', manager, asyncRoute(async (req, res) => res.json({ data: await prisma.room.update({ where: { id: uuid.parse(req.params.id) }, data: roomInput.partial().parse(req.body), include: { roomType: true } }) })));

  router.get('/pricing/seasonal', asyncRoute(async (_req, res) => res.json({ data: await prisma.seasonalRate.findMany({ include: { roomType: true, createdBy: { select: { id: true, email: true } } }, orderBy: [{ validFrom: 'desc' }, { season: 'asc' }] }) })));
  router.post('/pricing/seasonal', manager, asyncRoute(async (req, res) => {
    const input = rateInput.parse(req.body);
    const data = await prisma.seasonalRate.create({ data: { ...input, validFrom: parseDateOnly(input.validFrom), validTo: parseDateOnly(input.validTo), specialDate: input.specialDate ? parseDateOnly(input.specialDate) : null, createdById: req.admin!.id, amount: new Prisma.Decimal(input.amount), currency: input.currency.toUpperCase() } });
    res.status(201).json({ data });
  }));
  router.patch('/pricing/seasonal/:id', manager, asyncRoute(async (req, res) => {
    const input = rateBaseInput.partial().parse(req.body);
    const id = uuid.parse(req.params.id);
    const data = await prisma.$transaction(async (tx) => {
      const prior = await tx.seasonalRate.findUnique({ where: { id } });
      if (!prior) throw new ApiError(404, 'RATE_NOT_FOUND');
      const today = parseDateOnly(propertyDateToday());
      const nextValidFrom = input.validFrom ? parseDateOnly(input.validFrom) : prior.validFrom < today ? today : prior.validFrom;
      const nextValidTo = input.validTo ? parseDateOnly(input.validTo) : prior.validTo;
      if (nextValidFrom > nextValidTo) throw new ApiError(400, 'INVALID_RATE_DATES');
      const archiveTo = new Date(nextValidFrom.getTime() - 86_400_000);
      const effectiveTo = archiveTo < prior.validTo ? archiveTo : prior.validTo;
      if (prior.validFrom <= effectiveTo) {
        await tx.historicalRate.create({ data: { roomTypeId: prior.roomTypeId, name: prior.name, season: prior.season, dayType: prior.dayType, amount: prior.amount, currency: prior.currency, effectiveFrom: prior.validFrom, effectiveTo, isPublished: prior.isPublished } });
      }
      return tx.seasonalRate.update({ where: { id }, data: {
        ...input,
        validFrom: nextValidFrom,
        validTo: nextValidTo,
        ...(input.specialDate !== undefined ? { specialDate: input.specialDate ? parseDateOnly(input.specialDate) : null } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
      } });
    });
    res.json({ data });
  }));
  router.get('/pricing/history', asyncRoute(async (_req, res) => res.json({ data: await prisma.historicalRate.findMany({ include: { roomType: true }, orderBy: { effectiveFrom: 'desc' } }) })));
  router.post('/pricing/history', manager, asyncRoute(async (req, res) => {
    const input = z.object({ roomTypeId: uuid.optional().nullable(), name: z.string().trim().min(2).max(120), season: z.string().trim().min(2).max(80), dayType: z.nativeEnum(DayType).default(DayType.ANY), amount: z.coerce.number().min(0), currency: z.string().length(3).default('INR'), effectiveFrom: dateText, effectiveTo: dateText.optional().nullable(), isPublished: z.boolean().default(false) }).strict().parse(req.body);
    const data = await prisma.historicalRate.create({ data: { ...input, amount: new Prisma.Decimal(input.amount), currency: input.currency.toUpperCase(), effectiveFrom: parseDateOnly(input.effectiveFrom), effectiveTo: input.effectiveTo ? parseDateOnly(input.effectiveTo) : null } });
    res.status(201).json({ data });
  }));

  router.get('/enquiries', asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await prisma.enquiry.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'desc' }, take: 500 });
    res.json({ data });
  }));
  router.put('/enquiries/:id/status', asyncRoute(async (req, res) => {
    const { status } = enquiryStatusInput.parse(req.body);
    const data = await prisma.enquiry.update({ where: { id: uuid.parse(req.params.id) }, data: { status, respondedAt: status === 'NEW' ? null : new Date() } });
    res.json({ data });
  }));
  router.get('/preferences', asyncRoute(async (_req, res) => res.json({ data: await prisma.guestPreference.findMany({ include: { guest: { select: { id: true, fullName: true, phone: true, email: true } } }, orderBy: { updatedAt: 'desc' }, take: 500 }) })));
  router.patch('/preferences/:id', manager, asyncRoute(async (req, res) => {
    const input = z.object({ dietaryPreference: nullableText(120), allergies: nullableText(1000), specialNeeds: nullableText(2000), arrivalMealTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(), whatsappOptIn: z.boolean().optional() }).strict().parse(req.body);
    const data = await prisma.guestPreference.update({ where: { id: uuid.parse(req.params.id) }, data: { ...input, ...(input.whatsappOptIn === true ? { whatsappOptInAt: new Date() } : input.whatsappOptIn === false ? { whatsappOptInAt: null } : {}) } });
    res.json({ data });
  }));

  router.get('/attractions', asyncRoute(async (_req, res) => res.json({ data: await prisma.attraction.findMany({ orderBy: { name: 'asc' } }) })));
  router.post('/attractions', manager, asyncRoute(async (req, res) => res.status(201).json({ data: await prisma.attraction.create({ data: attractionInput.parse(req.body) }) })));
  router.patch('/attractions/:id', manager, asyncRoute(async (req, res) => res.json({ data: await prisma.attraction.update({ where: { id: uuid.parse(req.params.id) }, data: attractionInput.partial().parse(req.body) }) })));
  router.delete('/attractions/:id', manager, asyncRoute(async (req, res) => { await prisma.attraction.delete({ where: { id: uuid.parse(req.params.id) } }); res.status(204).end(); }));
  router.get('/cafes', asyncRoute(async (_req, res) => res.json({ data: await prisma.cafe.findMany({ orderBy: { name: 'asc' } }) })));
  router.post('/cafes', manager, asyncRoute(async (req, res) => res.status(201).json({ data: await prisma.cafe.create({ data: cafeInput.parse(req.body) }) })));
  router.patch('/cafes/:id', manager, asyncRoute(async (req, res) => res.json({ data: await prisma.cafe.update({ where: { id: uuid.parse(req.params.id) }, data: cafeInput.partial().parse(req.body) }) })));
  router.delete('/cafes/:id', manager, asyncRoute(async (req, res) => { await prisma.cafe.delete({ where: { id: uuid.parse(req.params.id) } }); res.status(204).end(); }));
  router.get('/meal-options', asyncRoute(async (_req, res) => res.json({ data: await prisma.mealOption.findMany({ orderBy: { sortOrder: 'asc' } }) })));
  router.post('/meal-options', manager, asyncRoute(async (req, res) => res.status(201).json({ data: await prisma.mealOption.create({ data: mealInput.parse(req.body) }) })));
  router.patch('/meal-options/:id', manager, asyncRoute(async (req, res) => res.json({ data: await prisma.mealOption.update({ where: { id: uuid.parse(req.params.id) }, data: mealInput.partial().parse(req.body) }) })));

  router.get('/reviews', asyncRoute(async (_req, res) => res.json({ data: await prisma.review.findMany({ orderBy: { createdAt: 'desc' } }) })));
  router.put('/reviews/:id/status', manager, asyncRoute(async (req, res) => {
    const { status } = reviewStatusInput.parse(req.body);
    const data = await prisma.review.update({ where: { id: uuid.parse(req.params.id) }, data: { status, publishedAt: status === ReviewStatus.VERIFIED ? new Date() : null } });
    res.json({ data });
  }));
  router.get('/notifications', asyncRoute(async (_req, res) => res.json({ data: await prisma.notificationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }) })));
  router.post('/notifications/whatsapp', manager, asyncRoute(async (req, res) => {
    const input = z.object({ guestId: uuid, template: z.enum(['booking_ack', 'prearrival']), parameters: z.array(z.string().max(250)).max(10).default([]), bookingId: uuid.optional() }).strict().parse(req.body);
    const guest = await prisma.guest.findUnique({ where: { id: input.guestId }, include: { preferences: true } });
    if (!guest?.phone) throw new ApiError(404, 'GUEST_PHONE_NOT_FOUND');
    const optedIn = Boolean(guest.preferences?.whatsappOptIn);
    const templateName = input.template === 'booking_ack' ? config.WHATSAPP_TEMPLATE_BOOKING_ACK : config.WHATSAPP_TEMPLATE_PREARRIVAL;
    if (!templateName) throw new ApiError(503, 'WHATSAPP_TEMPLATE_NOT_CONFIGURED');
    const outcome = await notifications!.sendWhatsAppTemplate({ to: guest.phone, templateName, bodyParameters: input.parameters, guestId: guest.id, bookingId: input.bookingId, optedIn, type: input.template.toUpperCase() });
    if (!optedIn) throw new ApiError(403, 'GUEST_OPT_IN_REQUIRED');
    res.json({ data: outcome });
  }));
  router.get('/weather', asyncRoute(async (_req, res) => res.json({ data: await weather!.get() })));
  router.post('/weather/refresh', manager, asyncRoute(async (_req, res) => res.json({ data: await weather!.get() })));

  const collections = [
    { path: '/marketing-sources', model: prisma.marketingSource, create: z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/), isActive: z.boolean().default(true) }).strict() },
  ] as const;
  for (const collection of collections) {
    router.get(collection.path, asyncRoute(async (_req, res) => res.json({ data: await collection.model.findMany({ orderBy: { name: 'asc' } }) })));
    router.post(collection.path, manager, asyncRoute(async (req, res) => res.status(201).json({ data: await collection.model.create({ data: collection.create.parse(req.body) }) })));
  }

  router.get('/settings', manager, asyncRoute(async (_req, res) => {
    const rows = await prisma.websiteSetting.findMany({ orderBy: { key: 'asc' } });
    res.json({ data: rows.map(({ id, key, value, isPublic, updatedAt }) => ({ id, key, value, isPublic, updatedAt })) });
  }));
  router.put('/settings', manager, asyncRoute(async (req, res) => {
    const input = settingInput.parse(req.body);
    const allowed = new Set(['resort.description', 'resort.tagline', 'contact.phone', 'contact.email', 'contact.address', 'contact.mapUrl', 'resort.whatsappNumber', 'whatsapp.template.prearrival', 'whatsapp.template.bookingAck']);
    for (const item of input.settings) if (!allowed.has(item.key)) throw new ApiError(400, 'SETTING_KEY_NOT_ALLOWED');
    for (const item of input.settings) if (item.key === 'contact.mapUrl' && item.value !== '' && (typeof item.value !== 'string' || !httpsUrl.safeParse(item.value).success)) throw new ApiError(400, 'INVALID_MAP_URL', 'Map links must use HTTPS');
    const data = await prisma.$transaction(input.settings.map((setting) => prisma.websiteSetting.upsert({ where: { key: setting.key }, create: { ...setting, value: setting.value as Prisma.InputJsonValue }, update: { value: setting.value as Prisma.InputJsonValue, isPublic: setting.isPublic } })));
    res.json({ data });
  }));

  router.get('/admins', requireRole(AdminRole.SUPER_ADMIN), asyncRoute(async (_req, res) => res.json({ data: await prisma.adminUser.findMany({ select: { id: true, email: true, role: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'asc' } }) })));
  router.post('/admins', requireRole(AdminRole.SUPER_ADMIN), asyncRoute(async (req, res) => {
    const input = userInput.parse(req.body);
    const data = await prisma.adminUser.create({ data: { email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12), role: input.role }, select: { id: true, email: true, role: true, isActive: true, createdAt: true } });
    res.status(201).json({ data });
  }));
  router.patch('/admins/:id', requireRole(AdminRole.SUPER_ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ role: z.nativeEnum(AdminRole).optional(), isActive: z.boolean().optional(), password: z.string().min(12).max(200).optional() }).strict().parse(req.body);
    if (req.params.id === req.admin!.id && input.isActive === false) throw new ApiError(400, 'CANNOT_DISABLE_CURRENT_ADMIN');
    const data = await prisma.adminUser.update({ where: { id: uuid.parse(req.params.id) }, data: { role: input.role, isActive: input.isActive, ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}) }, select: { id: true, email: true, role: true, isActive: true, updatedAt: true } });
    if (input.isActive === false || input.password) await prisma.adminSession.updateMany({ where: { adminUserId: data.id, revokedAt: null }, data: { revokedAt: new Date() } });
    res.json({ data });
  }));

  router.use('/imports', importsRouter(prisma));
  router.get('/map-link', (_req, res) => res.json({ data: createMapLink() }));
  return router;
}
