import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import redis from '../lib/redis';
import { emailQueue } from '../services/email/queue';
import { getAverageResponseTime } from '../middleware/responseTimeTracker';

const router = Router();

/**
 * GET /health
 * System health-check endpoint.
 */
router.get('/health', async (req: Request, res: Response) => {
  const dbStatus = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const redisStatus = await redis.ping().then(() => true).catch(() => false);
  const queueCounts = await emailQueue.getJobCounts();

  res.json({
    status: dbStatus && redisStatus ? 'ok' : 'degraded',
    api: 'ok',
    database: dbStatus,
    redis: redisStatus,
    queueDepth: {
      pending: queueCounts.waiting + queueCounts.delayed,
      failed: queueCounts.failed,
      active: queueCounts.active
    },
    averageResponseTimeMs: getAverageResponseTime().toFixed(2)
  });
});

/**
 * GET /metrics
 * Per-tenant usage statistics for the internal teams.
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    
    const results = await Promise.all(tenants.map(async (tenant) => {
      const totalRequests = await redis.get(`metrics:tenant:${tenant.id}:total_requests`) || '0';
      const breachCount = await redis.get(`metrics:tenant:${tenant.id}:429_count`) || '0';
      
      // Email Success Rate
      const emailStats = await prisma.emailDeliveryLog.groupBy({
        by: ['status'],
        where: { tenantId: tenant.id },
        _count: { id: true }
      });

      const sentCount = emailStats.find(s => s.status === 'SENT')?._count.id || 0;
      const failedCount = emailStats.find(s => s.status === 'FAILED')?._count.id || 0;
      const totalEmails = sentCount + failedCount;
      const successRate = totalEmails > 0 ? (sentCount / totalEmails * 100).toFixed(1) + '%' : 'N/A';

      // Endpoint stats (Get all keys for this tenant's endpoints)
      const endpointKeys = await redis.keys(`metrics:tenant:${tenant.id}:endpoint:*`);
      const endpointStats: Record<string, string> = {};
      if (endpointKeys.length > 0) {
        const values = await redis.mget(endpointKeys);
        endpointKeys.forEach((key, i) => {
          const path = key.split(':').pop()?.replace(/_/g, '/') || 'unknown';
          endpointStats[path] = values[i] || '0';
        });
      }

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        usage: {
          totalRequests: parseInt(totalRequests),
          rateLimitBreaches: parseInt(breachCount),
          endpointBreakdown: endpointStats,
          emailDelivery: {
            sent: sentCount,
            failed: failedCount,
            successRate
          }
        }
      };
    }));

    res.json({
      timestamp: new Date().toISOString(),
      tenants: results
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
