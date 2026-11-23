import { AdminRole, PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { ApiError, asyncRoute } from '../errors.js';
import { hashToken } from '../references.js';

export const SESSION_COOKIE = 'fsr_admin_session';

export function requireAdmin(prisma: PrismaClient): RequestHandler {
  return asyncRoute(async (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && !config.appOrigins.includes(origin)) throw new ApiError(403, 'CORS_ORIGIN_DENIED');
    }
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 40) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
    const session = await prisma.adminSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { adminUser: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.adminUser.isActive) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
    req.admin = { id: session.adminUser.id, email: session.adminUser.email, role: session.adminUser.role };
    next();
  });
}

export function requireRole(...roles: AdminRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.admin) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED'));
    if (!roles.includes(req.admin.role)) return next(new ApiError(403, 'INSUFFICIENT_PERMISSION'));
    next();
  };
}
