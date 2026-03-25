import prisma from './prisma';

/**
 * Initializes the database with an append-only trigger for AuditLog.
 */
export const initAuditLogTrigger = async () => {
  try {
    console.log('[DB_INIT] Setting up append-only triggers for AuditLog...');

    // PostgreSQL specific logic
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'Audit logs are append-only. UPDATE and DELETE operations are forbidden.';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trg_prevent_audit_log_modification ON "AuditLog";
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_prevent_audit_log_modification
      BEFORE UPDATE OR DELETE ON "AuditLog"
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_log_modification();
    `);

    console.log('[DB_INIT] Append-only trigger successfully active.');
  } catch (err) {
    console.error('[DB_INIT_FAILED] Could not set up audit log triggers. Ensure PostgreSQL is active.', err);
  }
};
