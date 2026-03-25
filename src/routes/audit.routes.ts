import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { computeHash } from '../services/audit/logger';

const router = Router();

/**
 * GET /audit
 * 
 * Lists audit logs for the current tenant using cursor-based pagination.
 * Filters: userId, action, resourceType, startDate, endDate.
 */
router.get('/', async (req: Request, res: Response) => {
  const { tenantId } = req.tenantContext!;
  const { 
    cursorId, 
    limit = '50', 
    userId, 
    action, 
    resourceType, 
    startDate, 
    endDate 
  } = req.query;

  const take = Math.min(Number(limit), 100);

  try {
    const logs = await prisma.auditLog.findMany({
      take,
      ...(cursorId ? { skip: 1, cursor: { id: String(cursorId) } } : {}),
      where: {
        tenantId,
        userId: userId ? String(userId) : undefined,
        action: action ? String(action) : undefined,
        resourceType: resourceType ? String(resourceType) : undefined,
        timestamp: {
          gte: startDate ? new Date(String(startDate)) : undefined,
          lte: endDate ? new Date(String(endDate)) : undefined,
        }
      },
      orderBy: { timestamp: 'desc' }
    });

    res.json({
      data: logs,
      nextCursor: logs.length === take ? logs[logs.length - 1].id : null
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

/**
 * GET /audit/verify
 * 
 * Verifies the integrity of the cryptographic chain for the current tenant.
 */
router.get('/verify', async (req: Request, res: Response) => {
  const { tenantId } = req.tenantContext!;

  try {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { timestamp: 'asc' }
    });

    let rollingHash: string | null = null;

    for (const log of logs) {
      // 1. Verify previous hash link
      if (log.previousHash !== rollingHash) {
        return res.json({
          intact: false,
          brokenEntryId: log.id,
          reason: 'Chain link broken: previousHash mismatch'
        });
      }

      // 2. Recompute current hash
      const expectedHash = computeHash({
        previousHash: log.previousHash,
        tenantId: log.tenantId,
        action: log.action,
        resourceId: log.resourceId,
        newValue: log.newValue,
        timestamp: log.timestamp
      });

      if (expectedHash !== log.hash) {
        return res.json({
          intact: false,
          brokenEntryId: log.id,
          reason: 'Hash mismatch: entry has been tampered with'
        });
      }

      rollingHash = log.hash;
    }

    res.json({ intact: true });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

export default router;
