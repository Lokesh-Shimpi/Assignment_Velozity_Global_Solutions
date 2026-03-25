import crypto from 'crypto';
import prisma from '../../lib/prisma';

interface AuditLogData {
  tenantId: string;
  userId?: string;
  apiKeyId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  previousValue?: any;
  newValue?: any;
  ipAddress?: string;
}

export const computeHash = (data: {
  previousHash: string | null;
  tenantId: string;
  action: string;
  resourceId: string;
  newValue: any;
  timestamp: Date;
}) => {
  const timestampStr = data.timestamp.toISOString();
  const content = [
    data.previousHash || 'GENESIS_BLOCK',
    data.tenantId,
    data.action,
    data.resourceId,
    JSON.stringify(data.newValue || {}),
    timestampStr
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex');
};

/**
 * Creates a tamper-evident audit log entry.
 */
export const createAuditLog = async (data: AuditLogData) => {
  const { 
    tenantId, userId, apiKeyId, action, 
    resourceType, resourceId, previousValue, newValue, ipAddress 
  } = data;

  const lastLog = await prisma.auditLog.findFirst({
    where: { tenantId },
    orderBy: { timestamp: 'desc' },
    select: { hash: true }
  });

  const previousHash = lastLog?.hash || null;
  const timestamp = new Date();

  const currentHash = computeHash({ 
    previousHash, tenantId, action, resourceId, newValue, timestamp 
  });

  // 3. Append to Database (Append-only enforcement handled by DB trigger)
  return await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      apiKeyId,
      action,
      resourceType,
      resourceId,
      previousValue,
      newValue,
      ipAddress,
      timestamp,
      previousHash,
      hash: currentHash
    }
  });
};
