import { Worker, Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { getTemplate } from './templates';
import prisma from '../../lib/prisma';
import redis from '../../lib/redis';

// Dedicated connection for the worker
const connection = redis.duplicate ? redis.duplicate() : redis;

let transporter: nodemailer.Transporter;

// Initialize Nodemailer with Ethereal Test Account
async function initTransporter() {
  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: testAccount.user, // generated ethereal user
      pass: testAccount.pass, // generated ethereal password
    },
  });
  console.log('[EMAIL_WORKER] Transporter initialized with Ethereal account:', testAccount.user);
}

// Ensure transporter is ready before processing
initTransporter();

/**
 * Worker Logic:
 * 1. Process email jobs from BullMQ.
 * 2. Update Prisma logs on each event.
 */
export const emailWorker = new Worker(
  'email-queue',
  async (job: Job) => {
    const { recipient, templateName, context, tenantId } = job.data;
    const { subject, body } = getTemplate(templateName, context);

    // Ensure transporter is ready (lazy load)
    if (!transporter) await initTransporter();

    // 1. Transactional logging: Create PENDING or update attempts
    try {
      if (job.attemptsMade === 0) {
        await prisma.emailDeliveryLog.create({
          data: {
            id: job.id,
            tenantId,
            recipient,
            templateUsed: templateName,
            status: 'PENDING',
          },
        });
      } else {
        await prisma.emailDeliveryLog.update({
          where: { id: job.id },
          data: { attemptCount: job.attemptsMade },
        });
      }

      // 2. Attempt delivery
      const info = await transporter.sendMail({
        from: '"B2B SaaS Engine" <noreply@b2bsaas.com>',
        to: recipient,
        subject,
        text: body,
      });

      // 3. Mark as SENT
      console.log('[EMAIL_SUCCESS] Message URL:', nodemailer.getTestMessageUrl(info));
      await prisma.emailDeliveryLog.update({
        where: { id: job.id },
        data: { status: 'SENT' },
      });

    } catch (err: any) {
      console.error(`[EMAIL_ERROR] Job ${job.id} - ${err.message}`);
      // Throw to BullMQ to trigger retry
      throw err;
    }
  },
  { connection }
);

/**
 * Dead Letter Queue (DLQ) Logic:
 * Listen for final failures and update status to FAILED in DB.
 */
emailWorker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
    console.log(`[EMAIL_DLQ] Permanent failure for job ${job.id}`);
    try {
      await prisma.emailDeliveryLog.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMsg: err.message,
        },
      });
    } catch (dbErr) {
      console.error('[EMAIL_DLQ_DB_FAIL]', dbErr);
    }
  }
});
