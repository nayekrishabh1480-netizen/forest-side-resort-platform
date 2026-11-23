import type { AdminRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      admin?: { id: string; email: string; role: AdminRole };
    }
  }
}

export {};
