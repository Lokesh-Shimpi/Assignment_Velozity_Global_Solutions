import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import Redis from 'ioredis';
import { computeHash } from '../src/services/audit/logger';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function main() {
  console.log('--- SEEDING STARTED ---');

  // 1. Create Tenants
  const t1 = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { name: 'Acme Corp' }
  });
  const t2 = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: { name: 'Globex Corporation' }
  });

  // 2. Create Users
  const users = [
    { email: 'owner@acme.com', role: 'OWNER', t: t1 },
    { email: 'dev1@acme.com', role: 'MEMBER', t: t1 },
    { email: 'dev2@acme.com', role: 'MEMBER', t: t1 },
    { email: 'owner@globex.com', role: 'OWNER', t: t2 },
    { email: 'dev1@globex.com', role: 'MEMBER', t: t2 },
    { email: 'dev2@globex.com', role: 'MEMBER', t: t2 },
  ];

  const dbUsers = [];
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { 
        email: u.email, 
        role: u.role as any, 
        tenantId: u.t.id 
      }
    });
    dbUsers.push(user);
  }

  // 3. Create API Keys (Using SHA-256 for deterministic, searchable hashing as per industry standards for keys)
  const acmeKey_Plain = 'sk_live_acme_prod_9999';
  const globexKey_Plain = 'sk_live_globex_prod_1111';

  await prisma.apiKey.create({
    data: {
      tenantId: t1.id,
      hashedKey: crypto.createHash('sha256').update(acmeKey_Plain).digest('hex'),
      createdById: dbUsers[0].id
    }
  });

  await prisma.apiKey.create({
    data: {
      tenantId: t2.id,
      hashedKey: crypto.createHash('sha256').update(globexKey_Plain).digest('hex'),
      createdById: dbUsers[3].id
    }
  });

  console.log('==============================================');
  console.log('ACME CORP API KEY:   ' + acmeKey_Plain);
  console.log('GLOBEX CORP API KEY: ' + globexKey_Plain);
  console.log('==============================================');

  // 4. Cryptographic Audit Log Chain (10 linked entries for Acme Corp)
  let lastHash: string | null = null;
  for (let i = 0; i < 10; i++) {
    const timestamp = new Date();
    const action = i === 0 ? 'SYSTEM_INIT' : 'RESOURCE_UPDATE';
    const resourceId = `res_${i}`;
    const newValue = { seq: i, msg: `Audit Entry ${i}` };
    
    const hash = computeHash({
      previousHash: lastHash,
      tenantId: t1.id,
      action,
      resourceId,
      newValue,
      timestamp
    });

    await prisma.auditLog.create({
      data: {
        tenantId: t1.id,
        userId: dbUsers[0].id,
        action,
        resourceType: 'CORE',
        resourceId,
        newValue,
        previousHash: lastHash,
        hash,
        timestamp
      }
    });
    lastHash = hash;
  }
  console.log('[SEED] Valid cryptographic audit chain of 10 entries created for Acme Corp.');

  // 5. Pre-population of Rate Limit Scenarios
  console.log('[SEED] Injecting dummy traffic into Redis for rate limit simulation...');
  const now = Date.now();
  for (let i = 0; i < 150; i++) {
    await redis.zadd(`rate_limit:global:tenant:${t1.id}`, now - (i * 1000), `request_${i}`);
  }

  console.log('--- SEEDING COMPLETED ---');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
