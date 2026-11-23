import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { createWeatherService } from './services/weather.js';
import { createNotificationService } from './services/notifications.js';

export type AppDependencies = {
  prisma: PrismaClient;
  weather?: ReturnType<typeof createWeatherService>;
  notifications?: ReturnType<typeof createNotificationService>;
};

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.appOrigins.includes(origin)) callback(null, true);
      else callback(new Error('CORS_ORIGIN_DENIED'));
    },
  }));
  app.use(express.json({ limit: '50kb', strict: true }));
  app.use(cookieParser());
  app.use(((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  }) as RequestHandler);
  app.use(((req, res, next) => {
    res.on('finish', () => console.info(JSON.stringify({ requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode })));
    next();
  }) as RequestHandler);

  app.get('/health', async (_req, res) => {
    try {
      await dependencies.prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'ok', timeZone: 'Asia/Kolkata' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  });
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await dependencies.prisma.$queryRaw`SELECT 1`;
      res.json({ data: { status: 'ok', database: 'ok', timeZone: 'Asia/Kolkata' } });
    } catch {
      res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Service is temporarily unavailable' } });
    }
  });

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } }) });
  const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } }) });
  const services = { prisma: dependencies.prisma, weather: dependencies.weather ?? createWeatherService(dependencies.prisma), notifications: dependencies.notifications ?? createNotificationService(dependencies.prisma) };
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1', publicRouter({ ...services, sensitiveLimiter }));
  app.use('/api/v1/admin/auth/login', sensitiveLimiter);
  app.use('/api/v1/admin/auth', authRouter(dependencies.prisma));
  app.use('/api/v1/admin', adminRouter(services));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
