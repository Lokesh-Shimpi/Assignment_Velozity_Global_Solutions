import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Middleware for internal/administrative endpoints.
 * Guards health and metrics reports.
 */
export const internalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const incomingKey = req.header('x-internal-key');
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!apiKey) {
    console.warn('[SECURITY_WARNING] INTERNAL_API_KEY is not set. Internal routes are locked.');
    return res.status(500).json({ error: 'Internal server configuration missing.' });
  }

  if (incomingKey !== apiKey) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid or missing internal access key'
      }
    });
  }

  next();
};
