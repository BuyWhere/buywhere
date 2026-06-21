import * as Sentry from '@sentry/node';
import type { Request, Response, NextFunction } from 'express';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
  console.log('[sentry] Error tracking initialized (env=%s)', process.env.NODE_ENV || 'production');
}

export function sentryRequestHandler(req: Request, _res: Response, next: NextFunction) {
  Sentry.setUser({
    ip_address: req.ip,
    id: (req as any).sessionId || undefined,
  });
  Sentry.setExtra('country', (req.query.country as string) || (req.body?.country as string) || '');
  Sentry.setTag('method', req.method);
  Sentry.setTag('path', req.path);
  next();
}

export { Sentry };
