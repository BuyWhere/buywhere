import { Request, Response, NextFunction } from 'express';
import { redis, ABUSE_LIMITS } from '../config';
import { sendError, sendRateLimitError, ErrorCode } from './errors';

export { ABUSE_LIMITS };

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

async function sendAbuseError(res: Response, retryAfter: number, message: string): Promise<void> {
  sendRateLimitError(res, retryAfter, 0, 0, message);
}

export function abuseDetection() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);
    const now = Date.now();
    const minuteWindow = Math.floor(now / 60000);

    try {
      const ipMinuteKey = `abuse:ip:${ip}:${minuteWindow}`;
      const [ipMinuteCount] = await redis.pipeline()
        .incr(ipMinuteKey)
        .expire(ipMinuteKey, 120)
        .exec();

      const emptyQuery =
        req.query.q === '' ||
        req.query.q === '*' ||
        (typeof req.query.q === 'string' && req.query.q.trim() === '');

      const invalidLimit = Number(req.query.limit) > 100;

      if (emptyQuery) {
        sendError(res, ErrorCode.INVALID_QUERY, 'Query parameter q cannot be empty or wildcard.');
        return;
      }

      if (invalidLimit) {
        sendError(res, ErrorCode.INVALID_PARAMETER, 'Limit cannot exceed 100.');
        return;
      }

      const rapidFireKey = `abuse:rapid:${ip}:${req.path}:${JSON.stringify(req.query)}:${minuteWindow}`;
      const [rapidFireCount] = await redis.pipeline()
        .incr(rapidFireKey)
        .expire(rapidFireKey, ABUSE_LIMITS.RAPID_FIRE_WINDOW_SEC)
        .exec();

      const rfCount = (rapidFireCount as number) || 0;
      if (rfCount > ABUSE_LIMITS.RAPID_FIRE_THRESHOLD) {
        await sendAbuseError(res, 60, 'Too many identical requests. Please slow down.');
        return;
      }

      // Check if IP is currently blocked (from invalid key attempts tracked by recordInvalidKeyAttempt)
      const blockKey = `abuse:blocked:${ip}`;
      const ttl = await redis.ttl(blockKey);
      if (ttl > 0) {
        sendAbuseError(res, ttl, 'Too many invalid API key attempts. IP temporarily blocked.');
        return;
      }

      next();
    } catch (_err) {
      console.warn('[abuse-detection] Redis error, skipping check:', (_err as Error).message);
      next();
    }
  };
}

export async function recordInvalidKeyAttempt(req: Request): Promise<void> {
  const ip = getClientIp(req);
  const fiveMinWindow = Math.floor(Date.now() / 300000);
  const key = `abuse:invkey:${ip}:${fiveMinWindow}`;
  const blockKey = `abuse:blocked:${ip}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ABUSE_LIMITS.INVALID_KEY_WINDOW_SEC);
    }
    if (count >= ABUSE_LIMITS.INVALID_KEY_MAX_ATTEMPTS) {
      await redis.setex(blockKey, ABUSE_LIMITS.INVALID_KEY_BLOCK_SEC, '1');
    }
  } catch (_err) {
    // non-critical
  }
}

export async function recordProductsReturned(req: Request, count: number): Promise<void> {
  if (count <= 0) return;
  const ip = getClientIp(req);
  const minuteWindow = Math.floor(Date.now() / 60000);
  const key = `abuse:products:${ip}:${minuteWindow}`;

  try {
    const newTotal = await redis.incrby(key, count);
    if (newTotal === count) {
      await redis.expire(key, 120);
    }
    if (newTotal > ABUSE_LIMITS.SCRAPE_PRODUCTS_PER_MIN_PER_IP) {
      const blockKey = `abuse:blocked:${ip}`;
      await redis.setex(blockKey, 60, '1');
    }
  } catch (_err) {
    // non-critical
  }
}