-- CreateEnum
CREATE TYPE "LinkVisitVia" AS ENUM ('bot', 'webapp');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "link_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_link_at" TIMESTAMPTZ,
ADD COLUMN     "last_link_id" INTEGER;

-- CreateTable
CREATE TABLE "campaign_links" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "campaign" TEXT,
    "medium" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaign_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_visits" (
    "id" BIGSERIAL NOT NULL,
    "link_id" INTEGER NOT NULL,
    "user_id" BIGINT NOT NULL,
    "via" "LinkVisitVia" NOT NULL,
    "is_new_user" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_links_code_key" ON "campaign_links"("code");

-- CreateIndex
CREATE INDEX "campaign_links_product_id_idx" ON "campaign_links"("product_id");

-- CreateIndex
CREATE INDEX "link_visits_link_id_created_at_idx" ON "link_visits"("link_id", "created_at");

-- CreateIndex
CREATE INDEX "link_visits_user_id_link_id_created_at_idx" ON "link_visits"("user_id", "link_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_link_id_idx" ON "orders"("link_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_last_link_id_fkey" FOREIGN KEY ("last_link_id") REFERENCES "campaign_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "campaign_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "panel_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "campaign_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
