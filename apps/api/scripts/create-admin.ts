import bcrypt from 'bcryptjs';
import { AdminRole } from '@prisma/client';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';

try {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be provided through environment variables');
  if (config.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  const email = config.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) throw new Error('An administrator with that email already exists');
  const role = await prisma.adminUser.count() === 0 ? AdminRole.SUPER_ADMIN : AdminRole.MANAGER;
  await prisma.adminUser.create({ data: { email, passwordHash, role } });
  console.info(JSON.stringify({ event: 'administrator_created', email, role }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administrator creation failed');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
