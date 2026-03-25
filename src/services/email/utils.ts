import redis from '../../lib/redis';
import { enqueueEmail } from './queue';

/**
 * Throttle helper to prevent spamming rate limit warnings.
 * Ensures warnings are sent a maximum of once per hour per tenant.
 */
export const checkAndSendRateLimitWarning = async (
  tenantId: string, 
  tenantName: string, 
  recipientEmail: string,
  usageData: { current: number; limit: number }
) => {
  const throttleKey = `warning_sent:${tenantId}`;
  
  // Try to set key with 1-hour expiration. Only succeeds if key didn't exist (NX)
  const result = await redis.set(throttleKey, '1', 'EX', 3600, 'NX');

  if (result === 'OK') {
    console.log(`[EMAIL_THROTTLE_PASS] Enqueueing warning for tenant ${tenantId}`);
    
    await enqueueEmail(
      recipientEmail,
      'RATE_LIMIT_WARNING',
      {
        tenantName,
        currentUsage: usageData.current,
        limit: usageData.limit
      },
      tenantId
    );
  } else {
    // Already sent a warning in the last hour, skipping to avoid noise
    console.log(`[EMAIL_THROTTLE_HIT] Skipping warning for tenant ${tenantId} (Sent within last hour)`);
  }
};
