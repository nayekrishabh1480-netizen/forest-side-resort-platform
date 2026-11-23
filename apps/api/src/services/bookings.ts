import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../errors.js';
import { createReference } from '../references.js';
import { parseDateOnly, propertyDateToday } from '../time.js';

type Db = PrismaClient | Prisma.TransactionClient;

export function validateStayDates(checkInText: string, checkOutText: string, allowPast = false) {
  let checkIn: Date;
  let checkOut: Date;
  try {
    checkIn = parseDateOnly(checkInText);
    checkOut = parseDateOnly(checkOutText);
  } catch {
    throw new ApiError(400, 'INVALID_STAY_DATES', 'Dates must be valid YYYY-MM-DD calendar dates');
  }
  if (checkOut <= checkIn) throw new ApiError(400, 'INVALID_STAY_DATES', 'Check-out must be after check-in');
  if (!allowPast && checkInText < propertyDateToday()) throw new ApiError(400, 'INVALID_STAY_DATES', 'Check-in cannot be in the past in Asia/Kolkata');
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  if (nights > 90) throw new ApiError(400, 'INVALID_STAY_DATES', 'A stay cannot exceed 90 nights');
  return { checkIn, checkOut, nights };
}

export async function assertRoomAvailable(db: Db, roomId: string, checkIn: Date, checkOut: Date, skipBookingId?: string, guestCount?: number) {
  // Serialize confirmations for one physical room; the SQL exclusion constraint is the final safety net.
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
  const room = await db.room.findUnique({ where: { id: roomId }, include: { roomType: true } });
  if (!room?.isActive || !room.roomType.isActive) throw new ApiError(409, 'ROOM_UNAVAILABLE', 'Selected room is not active');
  if (guestCount !== undefined && guestCount > room.roomType.maxOccupancy) throw new ApiError(400, 'GUEST_COUNT_EXCEEDS_CAPACITY');
  const collision = await db.booking.findFirst({
    where: {
      roomId,
      status: BookingStatus.CONFIRMED,
      ...(skipBookingId ? { id: { not: skipBookingId } } : {}),
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
    },
    select: { id: true },
  });
  if (collision) throw new ApiError(409, 'ROOM_DATE_CONFLICT', 'This room is already reserved for one or more selected nights');
  return room;
}

export async function confirmBooking(prisma: PrismaClient, id: string, roomId: string, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new ApiError(404, 'BOOKING_NOT_FOUND');
    if (booking.status !== BookingStatus.REQUESTED && booking.status !== BookingStatus.CONFIRMED) {
      throw new ApiError(409, 'INVALID_BOOKING_TRANSITION');
    }
    const room = await assertRoomAvailable(tx, roomId, booking.checkIn, booking.checkOut, id, booking.guestCount);
    if (booking.roomTypeId && booking.roomTypeId !== room.roomTypeId) throw new ApiError(400, 'ROOM_TYPE_MISMATCH');
    return tx.booking.update({
      where: { id },
      data: { roomId, roomTypeId: room.roomTypeId, status: BookingStatus.CONFIRMED, confirmedByAdminId: adminId, confirmedAt: new Date() },
      include: { guest: { select: { id: true, fullName: true, email: true, phone: true } }, room: { include: { roomType: true } } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 });
}

export async function changeBookingStatus(prisma: PrismaClient, id: string, status: BookingStatus, adminId: string, roomId?: string) {
  if (status === BookingStatus.CONFIRMED) {
    if (!roomId) throw new ApiError(400, 'ROOM_REQUIRED_TO_CONFIRM');
    return confirmBooking(prisma, id, roomId, adminId);
  }
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new ApiError(404, 'BOOKING_NOT_FOUND');
    const allowed: Record<BookingStatus, BookingStatus[]> = {
      REQUESTED: [BookingStatus.CANCELLED],
      CONFIRMED: [BookingStatus.CANCELLED, BookingStatus.COMPLETED],
      CANCELLED: [],
      COMPLETED: [],
    };
    if (!allowed[booking.status].includes(status)) throw new ApiError(409, 'INVALID_BOOKING_TRANSITION');
    return tx.booking.update({
      where: { id },
      data: { status, ...(status === BookingStatus.CANCELLED ? { cancelledAt: new Date() } : {}) },
      include: { guest: { select: { id: true, fullName: true, email: true, phone: true } }, room: { include: { roomType: true } } },
    });
  });
}

export async function createBookingReference() {
  return createReference('FSR');
}
