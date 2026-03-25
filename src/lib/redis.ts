import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Shared Redis Instance
 * Note: maxRetriesPerRequest must be null for BullMQ compatibility.
 */
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => {
  console.error('[REDIS_ERROR]', err);
});

export default redis;
