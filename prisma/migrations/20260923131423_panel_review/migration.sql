-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "reviewed_by_panel_user_id" INTEGER;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reviewed_by_panel_user_id_fkey" FOREIGN KEY ("reviewed_by_panel_user_id") REFERENCES "panel_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
