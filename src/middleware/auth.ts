import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';

/**
 * Authentication Middleware for B2B SaaS
 * 
 * Logic:
 * 1. Extract API key from x-api-key header.
 * 2. Hash incoming key with SHA-256 (standard for searchable hashed keys).
 * 3. Query the ApiKey table for a matching hashedKey with expiry check.
 * 4. Attach tenantContext to the request if valid.
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.header('x-api-key');

  if (!apiKey) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired API key',
        details: {}
      }
    });
  }

  // Generate hash for lookup (Industry standard for searchable keys)
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

  try {
    const now = new Date();
    
    // Find key with expiration support (null or greater than now for 15-min rotation overlap)
    const keyRecord = await prisma.apiKey.findFirst({
      where: {
        hashedKey,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      include: {
        createdBy: true
      }
    });

    if (!keyRecord) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired API key',
          details: {}
        }
      });
    }

    // Attach tenant context
    req.tenantContext = {
      tenantId: keyRecord.tenantId,
      role: keyRecord.createdBy.role,
      apiKeyHash: hashedKey
    };

    next();
  } catch (err) {
    console.error('[AUTH_MIDDLEWARE_ERROR]', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An internal error occurred during authentication',
        details: {}
      }
    });
  }
};
