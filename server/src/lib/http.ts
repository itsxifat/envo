import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    res.status(400).json({ error: issues[0] ? `${issues[0].path || 'input'}: ${issues[0].message}` : 'Invalid input', issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if ((err as Error)?.name === 'MulterError') {
    const code = (err as { code?: string }).code;
    res.status(400).json({ error: code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 25 MB)' : 'Upload failed' });
    return;
  }
  const pgErr = err as { code?: string; detail?: string; constraint?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({ error: `Already exists${pgErr.detail ? `: ${pgErr.detail}` : ''}` });
    return;
  }
  if (pgErr?.code === '23503') {
    res.status(409).json({ error: 'This item is still referenced by something else' });
    return;
  }
  if (pgErr?.code === '23514') {
    res.status(400).json({ error: `Invalid value (${pgErr.constraint ?? 'constraint'})` });
    return;
  }
  const status = (err as { status?: number })?.status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: (err as Error).message });
    return;
  }
  console.error(`[http] ${req.method} ${req.originalUrl} failed:`, err);
  res.status(500).json({ error: 'Internal server error' });
}

export function intParam(value: unknown, name = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}
