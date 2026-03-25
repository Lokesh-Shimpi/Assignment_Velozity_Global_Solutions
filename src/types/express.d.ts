import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      tenantContext?: {
        tenantId: string;
        role: Role;
        apiKeyHash: string; // Store for rate limiting
      };
    }
  }
}
