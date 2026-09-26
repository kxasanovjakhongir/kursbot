-- AlterTable
ALTER TABLE "campaign_links" ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "benefits" TEXT,
ADD COLUMN     "duration" TEXT,
ADD COLUMN     "lessons_count" INTEGER,
ADD COLUMN     "program" TEXT,
ADD COLUMN     "start_date" DATE,
ADD COLUMN     "teacher" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_link_id" INTEGER,
ADD COLUMN     "registered_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "link_clicks" (
    "id" BIGSERIAL NOT NULL,
    "link_id" INTEGER NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "link_clicks_link_id_created_at_idx" ON "link_clicks"("link_id", "created_at");

-- CreateIndex
CREATE INDEX "users_first_link_id_idx" ON "users"("first_link_id");

-- CreateIndex
CREATE INDEX "users_registered_at_idx" ON "users"("registered_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_first_link_id_fkey" FOREIGN KEY ("first_link_id") REFERENCES "campaign_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "campaign_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mavjud telefonli foydalanuvchilar ro'yxatdan o'tgan hisoblanadi (aniq vaqti noma'lum — yaratilgan vaqt)
UPDATE "users" SET "registered_at" = "created_at" WHERE "phone" IS NOT NULL AND "registered_at" IS NULL;

-- Mavjud link kontekstidan first-touch (bu migratsiyagacha faqat oxirgi link saqlangan)
UPDATE "users" SET "first_link_id" = "last_link_id" WHERE "first_link_id" IS NULL AND "last_link_id" IS NOT NULL;

-- Kurs bo'yicha analytics: hodisalar mahsulot kodi bo'yicha (start, product_view)
CREATE INDEX "events_product_name_created_idx" ON "events" (("payload"->>'product'), "name", "created_at");
