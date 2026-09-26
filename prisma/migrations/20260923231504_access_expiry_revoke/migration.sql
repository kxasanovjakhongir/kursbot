-- CreateEnum
CREATE TYPE "GrantRevokeReason" AS ENUM ('expired', 'removed', 'banned');

-- AlterTable
ALTER TABLE "access_grants" ADD COLUMN     "expiry_reminded_at" TIMESTAMPTZ,
ADD COLUMN     "revoke_reason" "GrantRevokeReason";
