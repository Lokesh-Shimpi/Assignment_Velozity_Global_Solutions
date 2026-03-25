import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';
import './services/email/worker';
import auditRoutes from './routes/audit.routes';
import { responseTimeTracker } from './middleware/responseTimeTracker';
import { internalAuthMiddleware } from './middleware/internalAuth';
import observabilityRoutes from './routes/observability.routes';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(responseTimeTracker); // Track all globally

// Public / Health Routes
app.use('/admin', internalAuthMiddleware, observabilityRoutes);

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/test-auth', authMiddleware, rateLimiter(), (req: Request, res: Response) => {
  res.json({
    message: 'Authenticated successfully!',
    tenantContext: req.tenantContext
  });
});

app.use('/api/audit', authMiddleware, rateLimiter(), auditRoutes);

// Standard Error Handling Middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[GLOBAL_ERROR]', err.stack);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong while processing your request',
      details: process.env.NODE_ENV === 'development' ? err.message : {}
    }
  });
});

app.listen(port, () => {
  console.log(`B2B SaaS API server listening at http://localhost:${port}`);
});
