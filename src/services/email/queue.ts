import { Queue } from 'bullmq';
import redis from '../../lib/redis';

// Note: BullMQ performs best with a dedicated connection instance
const connection = redis.duplicate ? redis.duplicate() : redis;

export const emailQueue = new Queue('email-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true, // Keep it lean
  },
});

/**
 * Helper to add email jobs to the queue.
 */
export const enqueueEmail = async (
  recipient: string, 
  templateName: string, 
  context: any, 
  tenantId?: string
) => {
  await emailQueue.add('send-email', {
    recipient,
    templateName,
    context,
    tenantId
  });
};
