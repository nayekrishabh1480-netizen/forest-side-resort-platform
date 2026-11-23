import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  if (process.env.SEED_SYNTHETIC !== 'true') throw new Error('Set SEED_SYNTHETIC=true to create clearly labelled synthetic records.');
  await prisma.roomType.upsert({
    where: { slug: 'synthetic-sample-room' },
    create: { name: '[SYNTHETIC] Sample room type', slug: 'synthetic-sample-room', description: 'Development-only synthetic record. Replace with owner-approved room information.', isActive: false, maxOccupancy: 2 },
    update: { isActive: false },
  });
  await prisma.marketingSource.upsert({
    where: { slug: 'synthetic-test-source' },
    create: { name: '[SYNTHETIC] Test source', slug: 'synthetic-test-source', isActive: false },
    update: { isActive: false },
  });
  console.info('Synthetic seed records created.');
} finally {
  await prisma.$disconnect();
}
