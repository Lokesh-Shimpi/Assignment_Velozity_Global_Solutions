import { Request, Response, NextFunction } from 'express';
import redis from '../lib/redis';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

/**
 * LUA script for Sliding Window Rate Limiting using Redis Sorted Sets (ZSET).
 * Atomically removes expired entries, counts current window, adds new entry, and calculates reset time.
 */
const SLIDING_WINDOW_LUA = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local requestId = ARGV[4]

  -- Clean up expired requests
  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  
  -- Check current count
  local currentCount = redis.call('ZCARD', key)
  local allowed = currentCount < limit
  
  if allowed then
    redis.call('ZADD', key, now, requestId)
    redis.call('PEXPIRE', key, window)
    currentCount = currentCount + 1
  end

  -- Calculate Reset Time (Oldest timestamp + window - now)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = oldest[2]
  local resetInSeconds = math.ceil((tonumber(oldestScore or now) + window - now) / 1000)
  if resetInSeconds < 0 then resetInSeconds = 0 end

  return { allowed and 1 or 0, currentCount, resetInSeconds }
`;

interface TierConfig {
  tier: 'global' | 'endpoint' | 'burst';
  limit: number;
  windowMs: number;
  identifier: string;
}

/**
 * Sliding Window Rate Limiter Middleware
 * Executes 3 tiers: Global (Tenant), Endpoint (Tenant + Path), and Burst (API Key Hash)
 */
export const rateLimiter = (options?: { endpointLimit?: number }) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const apiKey = req.header('x-api-key') || 'anonymous';
    
    // Hash key independently if context is missing (for Burst tier)
    const apiKeyHash = req.tenantContext?.apiKeyHash || 
                       crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const tenantId = req.tenantContext?.tenantId || 'anonymous';
    const path = req.baseUrl + req.path;

    const tiers: TierConfig[] = [
      { 
        tier: 'global', 
        limit: 1000, 
        windowMs: 60000, 
        identifier: `tenant:${tenantId}` 
      },
      { 
        tier: 'endpoint', 
        limit: options?.endpointLimit || 100, 
        windowMs: 60000, 
        identifier: `tenant:${tenantId}:path:${path}` 
      },
      { 
        tier: 'burst', 
        limit: 50, 
        windowMs: 5000, 
        identifier: `key:${apiKeyHash}` 
      }
    ];

    try {
      const pipeline = redis.pipeline();
      
      tiers.forEach(tier => {
        const key = `rate_limit:${tier.tier}:${tier.identifier}`;
        pipeline.eval(SLIDING_WINDOW_LUA, 1, key, now, tier.windowMs, tier.limit, uuidv4());
      });

      const responses = await pipeline.exec();
      if (!responses) throw new Error('Redis pipeline failed');

      let mostRestrictive: { limit: number; remaining: number; reset: number } | null = null;
      let violation: any = null;

      responses.forEach((response, index) => {
        const [err, result] = response as [Error | null, [number, number, number]];
        if (err) throw err;

        const [isAllowed, current, resetInSeconds] = result;
        const config = tiers[index];
        const remaining = Math.max(0, config.limit - current);

        // Track most restrictive metrics for headers (lowest remaining requests)
        if (!mostRestrictive || remaining < mostRestrictive.remaining) {
          mostRestrictive = {
            limit: config.limit,
            remaining,
            reset: resetInSeconds
          };
        }

        // Record the first violation found
        if (!isAllowed && !violation) {
          violation = {
            tier: config.tier,
            limit: config.limit,
            current,
            resetInSeconds
          };
        }
      });

      // Headers (based on most restrictive tier)
      if (mostRestrictive) {
        res.setHeader('X-RateLimit-Limit', mostRestrictive.limit);
        res.setHeader('X-RateLimit-Remaining', mostRestrictive.remaining);
        res.setHeader('X-RateLimit-Reset', mostRestrictive.reset);
      }

      if (violation) {
        // Track Rate Limit Breach
        await redis.incr(`metrics:tenant:${tenantId}:429_count`);
        
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            details: violation
          }
        });
      }

      // Track successful request for metrics
      const metricPath = path.replace(/\//g, '_');
      await redis.pipeline()
        .incr(`metrics:tenant:${tenantId}:total_requests`)
        .incr(`metrics:tenant:${tenantId}:endpoint:${metricPath}`)
        .exec();

      next();
    } catch (err) {
      console.error('[RATE_LIMITER_CRITICAL_FAILURE]', err);
      // In production, we might want to allow the request if the limiter is down (Fail-Open)
      // or block it (Fail-Closed). Defaulting to next() for availability.
      next();
    }
  };
};
