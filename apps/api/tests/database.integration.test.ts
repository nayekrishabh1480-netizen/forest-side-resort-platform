import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const database = testDatabaseUrl ? new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } }) : undefined;

describe.skipIf(!database)('PostgreSQL booking overlap constraint (requires TEST_DATABASE_URL and applied migrations)', () => {
  const suffix = randomUUID().slice(0, 8);
  let typeId = '';
  let roomId = '';
  let guestId = '';
  let guestTwoId = '';
  const bookingIds: string[] = [];

  beforeAll(async () => {
    await database!.$connect();
    const type = await database!.roomType.create({ data: { name: `[SYNTHETIC TEST] ${suffix}`, slug: `synthetic-${suffix}`, maxOccupancy: 2, isActive: true } });
    typeId = type.id;
    const room = await database!.room.create({ data: { roomNumber: `SYN-${suffix}`, roomTypeId: type.id } });
    roomId = room.id;
    const [guest, guestTwo] = await Promise.all([
      database!.guest.create({ data: { fullName: '[SYNTHETIC TEST] Guest A' } }),
      database!.guest.create({ data: { fullName: '[SYNTHETIC TEST] Guest B' } }),
    ]);
    guestId = guest.id;
    guestTwoId = guestTwo.id;
    const first = await database!.booking.create({ data: { reference: `FSR-TEST-${suffix}-1`, guestId, roomId, roomTypeId: typeId, checkIn: new Date('2098-05-01T00:00:00Z'), checkOut: new Date('2098-05-04T00:00:00Z'), guestCount: 2, status: 'CONFIRMED' } });
    bookingIds.push(first.id);
  });

  it('rejects direct writes that overlap a confirmed physical room stay', async () => {
    await expect(database!.booking.create({ data: { reference: `FSR-TEST-${suffix}-2`, guestId: guestTwoId, roomId, roomTypeId: typeId, checkIn: new Date('2098-05-03T00:00:00Z'), checkOut: new Date('2098-05-05T00:00:00Z'), guestCount: 1, status: 'CONFIRMED' } })).rejects.toBeDefined();
  });

  afterAll(async () => {
    if (!database) return;
    await database.booking.deleteMany({ where: { id: { in: bookingIds } } });
    if (guestId) await database.guest.deleteMany({ where: { id: { in: [guestId, guestTwoId] } } });
    if (roomId) await database.room.delete({ where: { id: roomId } });
    if (typeId) await database.roomType.delete({ where: { id: typeId } });
    await database.$disconnect();
  });
});
