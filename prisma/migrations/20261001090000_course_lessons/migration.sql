-- CreateEnum
CREATE TYPE "LessonMediaType" AS ENUM ('video', 'document');

-- CreateTable
CREATE TABLE "lessons" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "caption" TEXT,
    "media_type" "LessonMediaType" NOT NULL DEFAULT 'video',
    "telegram_file_id" TEXT NOT NULL,
    "telegram_file_unique_id" TEXT NOT NULL,
    "telegram_chat_id" BIGINT,
    "telegram_message_id" BIGINT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" BIGINT,
    "duration" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lessons_product_id_sort_order_idx" ON "lessons"("product_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_product_id_telegram_file_unique_id_key" ON "lessons"("product_id", "telegram_file_unique_id");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

