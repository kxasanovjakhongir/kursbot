-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('info', 'success', 'warning', 'order', 'message');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BroadcastAudience" ADD VALUE 'buyers';
ALTER TYPE "BroadcastAudience" ADD VALUE 'non_buyers';
ALTER TYPE "BroadcastAudience" ADD VALUE 'admins';
ALTER TYPE "BroadcastAudience" ADD VALUE 'product';

-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "product_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "banned_at" TIMESTAMPTZ,
ADD COLUMN     "is_banned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "news_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "text" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
