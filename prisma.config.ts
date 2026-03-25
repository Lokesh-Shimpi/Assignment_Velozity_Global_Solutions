import dotenv from 'dotenv';
dotenv.config();

/**
 * Prisma 7 Configuration
 */
export default {
  datasource: {
    url: process.env.DATABASE_URL,
  },
};
