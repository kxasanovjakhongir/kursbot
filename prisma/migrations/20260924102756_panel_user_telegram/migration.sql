-- AlterTable
ALTER TABLE "panel_users" ADD COLUMN     "telegram_id" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "panel_users_telegram_id_key" ON "panel_users"("telegram_id");

