import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config();
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
dotenv.config({ path: resolve(process.cwd(), 'apps/api/.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://localhost:5432/forest_side?schema=public'),
  APP_ORIGINS: z.string().default('http://localhost:5173'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  WEATHER_API_KEY: z.string().optional().default(''),
  WEATHER_LOCATION_NAME: z.string().min(2).max(180).default('Guptkashi'),
  WEATHER_LATITUDE: z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.coerce.number().min(-90).max(90).optional()),
  WEATHER_LONGITUDE: z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.coerce.number().min(-180).max(180).optional()),
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default(''),
  OWNER_NOTIFICATION_EMAIL: z.string().email().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v22.0'),
  WHATSAPP_TEMPLATE_BOOKING_ACK: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_BOOKING_STATUS: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_PREARRIVAL: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid environment configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
}
if (result.data.NODE_ENV === 'production' && !process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL is required in production');
}

export const config = {
  ...result.data,
  appOrigins: result.data.APP_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  isProduction: result.data.NODE_ENV === 'production',
  hasSmtp: Boolean(result.data.SMTP_HOST && result.data.EMAIL_FROM),
  hasWhatsApp: Boolean(result.data.WHATSAPP_ACCESS_TOKEN && result.data.WHATSAPP_PHONE_NUMBER_ID),
};
