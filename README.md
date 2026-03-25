# B2B SaaS Backend API Architecture

A production-grade, multi-tenant API built with Node.js, TypeScript, Express, PostgreSQL (Prisma), and Redis.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Docker & Docker Compose (for PostgreSQL and Redis)

### Local Setup
1. **Clone & Install**:
   ```bash
   npm install
   ```
2. **Environment Setup**:
   Copy `.env` and fill in your credentials.
   - `INTERNAL_API_KEY`: Secret for health/metrics.
   - `DATABASE_URL`: PostgreSQL connection string.
   - `REDIS_URL`: Redis connection string.
3. **Database Spin-up**:
   ```bash
   docker-compose up -d postgres redis
   ```
4. **Prisma Setup**:
   ```bash
   npx prisma migrate dev --name init
   npx prisma db seed
   ```
5. **Run**:
   ```bash
   npm run dev
   ```

---

## 🏛 Architectural Decisions

### 1. Multi-Tenant Isolation
Isolation is enforced at the **query level**. Every request processed by the `authMiddleware` attaches a `tenantContext` to the Express Request. Subsequent Prisma calls MUST include the `tenantId` in the `where` clause. This provides a hard boundary between tenant data.

### 2. Intelligent Rate Limiting
Uses a **Redis-backed Sliding Window Algorithm** via Sorted Sets (ZSET). Unlike fixed-window limiting, this prevents "burst exhaustion" at window borders.
- **Tiers**: Global (Tenant), Endpoint (Tenant + Path), and Burst (API Key Hash).
- **Atomicity**: Implemented using **Lua scripts** to ensure multiple tiers are checked and updated in a single Redis operation, preventing race conditions.

### 3. Tamper-Evident Audit Trail
Every tenant has a unique **cryptographic chain**. 
- **Chaining**: Each entry contains the SHA-256 hash of the previous record, the current payload, and the timestamp.
- **Append-Only**: A PostgreSQL trigger blocks `UPDATE` and `DELETE` on the `AuditLog` table.
- **Verification**: The `/audit/verify` endpoint recomputes the entire chain for a tenant to detect any database-level tampering.

### 4. Queue-Based Emails
Uses **BullMQ** for asynchronous delivery.
- **Retries**: 3 attempts with exponential backoff.
- **Visibility**: Every attempt is logged in the `EmailDeliveryLog` table.
- **Throttling**: Rate-limit warnings are throttled to a maximum of 1 per hour per tenant using Redis `SET NX`.

### 5. Health & Metrics
Internal endpoints `/admin/health` and `/admin/metrics` provide real-time observability into:
- Database and Redis connectivity.
- Queue depth and worker health.
- Per-tenant request counts, rate limit breaches, and email delivery success rates.
- Rolling average response times for the last 60 seconds.

---

## ⚠️ Known Limitations
- The cryptographic chain resides in the same DB; for high-security environments, hashes should be periodically anchor-signed or sent to a separate immutable ledger.
- In-memory response time tracking is temporary per-process; for high-availability clusters, Redis-backed metrics aggregation would be more accurate.
- Tenant isolation is currently code-enforced; PostgreSQL Row Level Security (RLS) would be the next step for absolute safety.
