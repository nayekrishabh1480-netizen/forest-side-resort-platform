import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { ApiError, asyncRoute } from '../errors.js';
import { hashToken } from '../references.js';
import { requireAdmin, SESSION_COOKIE } from '../middleware/auth.js';

const loginSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) }).strict();

export function authRouter(prisma: PrismaClient) {
  const router = Router();
  router.post('/login', asyncRoute(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.adminUser.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    const verified = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!user || !verified || !user.isActive) throw new ApiError(401, 'INVALID_CREDENTIALS');
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.adminSession.deleteMany({ where: { adminUserId: user.id, OR: [{ expiresAt: { lte: new Date() } }, { revokedAt: { not: null } }] } }),
      prisma.adminSession.create({ data: { adminUserId: user.id, tokenHash: hashToken(rawToken), expiresAt } }),
    ]);
    res.cookie(SESSION_COOKIE, rawToken, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/api/v1/admin', maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000 });
    res.json({ data: { id: user.id, email: user.email, role: user.role, expiresAt: expiresAt.toISOString() } });
  }));

  router.post('/logout', requireAdmin(prisma), asyncRoute(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await prisma.adminSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/api/v1/admin' });
    res.status(204).end();
  }));

  router.get('/session', requireAdmin(prisma), (req, res) => {
    res.json({ data: req.admin });
  });
  return router;
}
