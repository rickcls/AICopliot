-- Requirements run type.
--
-- This migration contains nothing but the enum extension, and that separation is
-- load-bearing: Postgres refuses to *use* a new enum value in the same
-- transaction that added it, and Prisma runs each migration file in one
-- transaction. The next migration's partial unique index references
-- 'requirements', so it cannot live here.

-- AlterEnum
ALTER TYPE "GenerationRunType" ADD VALUE 'requirements';
