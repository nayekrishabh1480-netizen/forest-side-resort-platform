import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message = code) {
    super(message);
    this.name = 'ApiError';
  }
}

export const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND'));

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const requestId = req.requestId ?? 'unknown';
  if ((error as { message?: string }).message === 'CORS_ORIGIN_DENIED') {
    res.status(403).json({ error: { code: 'CORS_ORIGIN_DENIED', message: 'Request origin is not allowed', requestId } });
    return;
  }
  if (error instanceof ApiError) {
    if (error.status >= 500) console.error(JSON.stringify({ requestId, code: error.code, status: error.status }));
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code })), requestId } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists', requestId } });
      return;
    }
    if (error.code === 'P2003' || error.code === 'P2025') {
      res.status(409).json({ error: { code: 'RELATED_RECORD_CONFLICT', message: 'The requested record could not be updated', requestId } });
      return;
    }
    if (error.code === 'P2004') {
      res.status(409).json({ error: { code: 'DATABASE_CONSTRAINT_CONFLICT', message: 'The requested change conflicts with resort data rules', requestId } });
      return;
    }
  }
  const status = (error as { status?: number }).status;
  if (status === 413) {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file or request is too large', requestId } });
    return;
  }
  if (status === 400) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'The request could not be parsed', requestId } });
    return;
  }
  if ((error as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Excel files must be 5 MB or smaller', requestId } });
    return;
  }
  console.error(JSON.stringify({ requestId, code: 'INTERNAL_ERROR' }));
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } });
};
